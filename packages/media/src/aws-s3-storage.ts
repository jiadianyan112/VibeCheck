import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash } from 'node:crypto'
import sharp, { type Metadata, type Sharp } from 'sharp'

import { MediaError, mediaError } from './errors.js'
import type { MediaScanStorage, MediaStorage, PublicMediaMime } from './types.js'

const maximumUploadBytes = 5_242_880
const maximumDimension = 12_000

export interface R2MediaConfig {
  readonly endpoint: string
  readonly region: 'auto'
  readonly bucket: string
  readonly objectPrefix: string
}

export type AwsS3MediaConfig = R2MediaConfig

export interface S3MediaClient { send(command: unknown): Promise<unknown> }

export class R2MediaStorage implements MediaStorage, MediaScanStorage {
  private readonly client: S3MediaClient

  constructor(
    private readonly config: R2MediaConfig,
    client?: S3MediaClient,
    private readonly presign: typeof getSignedUrl = getSignedUrl,
  ) {
    this.client = client ?? new S3Client({ region: config.region, endpoint: config.endpoint })
  }

  async issueUpload(input: Parameters<MediaStorage['issueUpload']>[0]) {
    const expiresIn = Math.max(1, Math.min(900, Math.floor((input.expiresAt.getTime() - Date.now()) / 1_000)))
    const checksum = Buffer.from(input.checksumSha256, 'hex').toString('base64')
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.key(input.storageKey),
      ContentType: input.declaredMime,
      IfNoneMatch: '*',
      ChecksumSHA256: checksum,
    })
    try {
      const uploadUrl = await this.presign(this.client as S3Client, command, {
        expiresIn,
        signableHeaders: new Set(['content-type', 'if-none-match']),
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      })
      return Object.freeze({
        uploadUrl,
        uploadHeaders: Object.freeze({
          'content-type': input.declaredMime,
          'if-none-match': '*',
          'x-amz-checksum-sha256': checksum,
        }),
      })
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_UPLOAD_SIGNING_FAILED', 503, true)
    }
  }

  async inspectUpload(input: Parameters<MediaStorage['inspectUpload']>[0]) {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(input.storageKey),
      })) as {
        ContentType?: string
        ContentLength?: number
        ChecksumSHA256?: string
        ETag?: string
      }
      const etag = result.ETag?.replace(/^"|"$/g, '')
      if (!etag || etag !== input.uploadReceipt.replace(/^"|"$/g, '')) {
        throw mediaError('MEDIA_UPLOAD_RECEIPT_MISMATCH', 422)
      }
      if (!result.ContentType || result.ContentLength === undefined) {
        throw mediaError('MEDIA_STORAGE_METADATA_INCOMPLETE', 503, true)
      }
      return Object.freeze({
        detectedMime: result.ContentType,
        byteSize: result.ContentLength,
        checksumSha256: decodeChecksum(result.ChecksumSHA256),
      })
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_INSPECTION_FAILED', 503, true)
    }
  }

  async issueRead(input: Parameters<MediaStorage['issueRead']>[0]) {
    const key = this.readyKey(input.storageKey)
    const expiresIn = Math.max(1, Math.min(60, Math.floor((input.expiresAt.getTime() - Date.now()) / 1_000)))
    try {
      const readUrl = await this.presign(
        this.client as S3Client,
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { expiresIn },
      )
      if (new URL(readUrl).protocol !== 'https:') throw new Error('MEDIA_READ_PROTOCOL_INVALID')
      return Object.freeze({ readUrl })
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_READ_SIGNING_FAILED', 503, true)
    }
  }

  async sanitizeImage(input: Parameters<MediaScanStorage['sanitizeImage']>[0]) {
    const quarantineKey = this.key(input.storageKey)
    const finalStorageKey = `ready/${input.ownerUserId}/${input.mediaResourceId}`
    const finalKey = this.readyKey(finalStorageKey)
    const body = await this.download(quarantineKey)

    if (body.byteLength !== input.byteSize || body.byteLength > maximumUploadBytes) {
      throw mediaError('MEDIA_BYTE_SIZE_MISMATCH', 422)
    }
    const expectedChecksum = input.checksumSha256.toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || createChecksum(body) !== expectedChecksum) {
      throw mediaError('MEDIA_CHECKSUM_MISMATCH', 422)
    }

    let image: Sharp
    let metadata: Metadata
    try {
      image = sharp(body, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
      metadata = await image.metadata()
    } catch {
      throw mediaError('MEDIA_DECODE_FAILED', 422)
    }
    const detectedMime = formatMime(metadata.format)
    if (detectedMime !== input.declaredMime) throw mediaError('MEDIA_MIME_MISMATCH', 415)
    validateDimensions(metadata)

    let sanitized: Buffer
    let outputMetadata: Metadata
    try {
      sanitized = await encode(image, detectedMime)
      outputMetadata = await sharp(sanitized, {
        failOn: 'error', limitInputPixels: 40_000_000,
      }).metadata()
      validateDimensions(outputMetadata)
      if (outputMetadata.exif !== undefined || outputMetadata.orientation !== undefined) {
        throw mediaError('MEDIA_DECODE_FAILED', 422)
      }
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_DECODE_FAILED', 422)
    }

    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: finalKey,
        Body: sanitized,
        ContentType: detectedMime,
        ChecksumSHA256: Buffer.from(createChecksum(sanitized), 'hex').toString('base64'),
      }))
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_READY_WRITE_FAILED', 503, true)
    }
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: quarantineKey,
      }))
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_QUARANTINE_DELETE_FAILED', 503, true)
    }

    return Object.freeze({
      finalStorageKey,
      detectedMime,
      width: outputMetadata.width!,
      height: outputMetadata.height!,
      exifRemoved: true as const,
    })
  }

  private async download(key: string): Promise<Buffer> {
    let source: { Body?: unknown }
    try {
      source = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket, Key: key,
      })) as { Body?: unknown }
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_DOWNLOAD_FAILED', 503, true)
    }
    if (source.Body === undefined || source.Body === null) {
      throw mediaError('MEDIA_STORAGE_DOWNLOAD_FAILED', 503, true)
    }
    try {
      return await materializeBody(source.Body)
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw mediaError('MEDIA_STORAGE_DOWNLOAD_FAILED', 503, true)
    }
  }

  private key(storageKey: string): string {
    if (!/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(storageKey)) {
      throw mediaError('MEDIA_STORAGE_KEY_INVALID', 503)
    }
    return `${this.config.objectPrefix}${storageKey}`
  }

  private readyKey(storageKey: string): string {
    if (!/^ready\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(storageKey)) {
      throw mediaError('MEDIA_STORAGE_KEY_INVALID', 503)
    }
    return `${this.config.objectPrefix}${storageKey}`
  }
}

export const AwsS3MediaStorage = R2MediaStorage

export function createMediaStorage(
  config: R2MediaConfig,
  client?: S3MediaClient,
  presign: typeof getSignedUrl = getSignedUrl,
): R2MediaStorage {
  return new R2MediaStorage(config, client, presign)
}

function formatMime(format: string | undefined): PublicMediaMime {
  const mapping: Record<string, PublicMediaMime> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heif: 'image/avif',
    avif: 'image/avif',
  }
  const mime = format ? mapping[format.toLowerCase()] : undefined
  if (!mime) throw mediaError('MEDIA_DECODE_UNSUPPORTED', 415)
  return mime
}

function encode(image: Sharp, mime: PublicMediaMime): Promise<Buffer> {
  if (mime === 'image/jpeg') return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  if (mime === 'image/png') return image.png({ compressionLevel: 9 }).toBuffer()
  if (mime === 'image/webp') return image.webp({ quality: 90 }).toBuffer()
  return image.avif({ quality: 60 }).toBuffer()
}

function createChecksum(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeChecksum(value: string | undefined): string | null {
  if (value === undefined) return null
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw mediaError('MEDIA_STORAGE_METADATA_INCOMPLETE', 503, true)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength !== 32 || decoded.toString('base64') !== value) {
    throw mediaError('MEDIA_STORAGE_METADATA_INCOMPLETE', 503, true)
  }
  return decoded.toString('hex')
}

function validateDimensions(metadata: Metadata): { width: number; height: number } {
  const width = metadata.width
  const height = metadata.height
  if (
    width === undefined || height === undefined ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width < 1 || height < 1 || width > maximumDimension || height > maximumDimension
  ) {
    throw mediaError('MEDIA_DIMENSIONS_INVALID', 422)
  }
  return { width, height }
}

async function materializeBody(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > maximumUploadBytes) throw mediaError('MEDIA_BYTE_SIZE_MISMATCH', 422)
    return Buffer.from(body)
  }
  if (body instanceof ArrayBuffer) {
    if (body.byteLength > maximumUploadBytes) throw mediaError('MEDIA_BYTE_SIZE_MISMATCH', 422)
    return Buffer.from(new Uint8Array(body))
  }
  if (typeof body === 'object' && body !== null &&
    'transformToByteArray' in body && typeof body.transformToByteArray === 'function') {
    const bytes = await (body.transformToByteArray as () => Promise<Uint8Array>)()
    if (!(bytes instanceof Uint8Array)) throw new Error('MEDIA_BODY_INVALID')
    if (bytes.byteLength > maximumUploadBytes) throw mediaError('MEDIA_BYTE_SIZE_MISMATCH', 422)
    return Buffer.from(bytes)
  }
  if (typeof body === 'object' && body !== null && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (!(chunk instanceof Uint8Array)) throw new Error('MEDIA_BODY_INVALID')
      total += chunk.byteLength
      if (total > maximumUploadBytes) throw mediaError('MEDIA_BYTE_SIZE_MISMATCH', 422)
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks, total)
  }
  throw new Error('MEDIA_BODY_INVALID')
}
