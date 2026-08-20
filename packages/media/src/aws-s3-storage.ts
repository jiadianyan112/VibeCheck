import {
  GetObjectCommand, GetObjectTaggingCommand,
  HeadObjectCommand, PutObjectCommand, S3Client, type Tag,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash } from 'node:crypto'
import sharp, { type Sharp } from 'sharp'

import { mediaError } from './errors.js'
import type { MediaScanStorage, MediaStorage, PublicMediaMime } from './types.js'

export interface AwsS3MediaConfig {
  readonly region: string
  readonly bucket: string
  readonly objectPrefix: string
}

export interface S3MediaClient { send(command: unknown): Promise<unknown> }

export class AwsS3MediaStorage implements MediaStorage, MediaScanStorage {
  private readonly client: S3MediaClient

  constructor(
    private readonly config: AwsS3MediaConfig,
    client?: S3MediaClient,
    private readonly presign: typeof getSignedUrl = getSignedUrl,
  ) {
    this.client = client ?? new S3Client({ region: config.region })
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
      ServerSideEncryption: 'AES256',
      Tagging: 'VibeCheckAccess=quarantined',
    })
    try {
      const uploadUrl = await this.presign(this.client as S3Client, command, {
        expiresIn,
        signableHeaders: new Set(['content-type', 'if-none-match']),
        unhoistableHeaders: new Set([
          'x-amz-checksum-sha256', 'x-amz-server-side-encryption', 'x-amz-tagging',
        ]),
      })
      return Object.freeze({
        uploadUrl,
        uploadHeaders: Object.freeze({
          'content-type': input.declaredMime,
          'if-none-match': '*',
          'x-amz-checksum-sha256': checksum,
          'x-amz-server-side-encryption': 'AES256',
          'x-amz-tagging': 'VibeCheckAccess=quarantined',
        }),
      })
    } catch {
      throw mediaError('MEDIA_STORAGE_UPLOAD_SIGNING_FAILED', 503, true)
    }
  }

  async inspectUpload(input: Parameters<MediaStorage['inspectUpload']>[0]) {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket, Key: this.key(input.storageKey), ChecksumMode: 'ENABLED',
      })) as { ContentType?: string; ContentLength?: number; ChecksumSHA256?: string; ETag?: string }
      const etag = result.ETag?.replace(/^"|"$/g, '')
      if (!etag || etag !== input.uploadReceipt.replace(/^"|"$/g, '')) {
        throw mediaError('MEDIA_UPLOAD_RECEIPT_MISMATCH', 422)
      }
      if (!result.ContentType || result.ContentLength === undefined || !result.ChecksumSHA256) {
        throw mediaError('MEDIA_STORAGE_METADATA_INCOMPLETE', 503, true)
      }
      return Object.freeze({
        detectedMime: result.ContentType,
        byteSize: result.ContentLength,
        checksumSha256: Buffer.from(result.ChecksumSHA256, 'base64').toString('hex'),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'MediaError') throw error
      throw mediaError('MEDIA_STORAGE_INSPECTION_FAILED', 503, true)
    }
  }

  async issueRead(input: Parameters<MediaStorage['issueRead']>[0]) {
    if (!/^ready\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(input.storageKey)) {
      throw mediaError('MEDIA_STORAGE_KEY_INVALID', 503)
    }
    const expiresIn = Math.max(1, Math.min(60, Math.floor((input.expiresAt.getTime() - Date.now()) / 1_000)))
    try {
      const readUrl = await this.presign(
        this.client as S3Client,
        new GetObjectCommand({ Bucket: this.config.bucket, Key: this.readyKey(input.storageKey) }),
        { expiresIn },
      )
      if (new URL(readUrl).protocol !== 'https:') throw new Error('MEDIA_READ_PROTOCOL_INVALID')
      return Object.freeze({ readUrl })
    } catch {
      throw mediaError('MEDIA_STORAGE_READ_SIGNING_FAILED', 503, true)
    }
  }

  async getScanResult(input: Parameters<MediaScanStorage['getScanResult']>[0]) {
    try {
      const result = await this.client.send(new GetObjectTaggingCommand({
        Bucket: this.config.bucket, Key: this.key(input.storageKey),
      })) as { TagSet?: Tag[] }
      const status = result.TagSet?.find((tag) => tag.Key === 'GuardDutyMalwareScanStatus')?.Value
      if (status === undefined) return 'pending' as const
      if (status === 'NO_THREATS_FOUND') return 'clean' as const
      if (status === 'THREATS_FOUND') return 'malicious' as const
      if (status === 'UNSUPPORTED') return 'unscannable' as const
      return 'retryable_failure' as const
    } catch {
      return 'retryable_failure' as const
    }
  }

  async sanitizeImage(input: Parameters<MediaScanStorage['sanitizeImage']>[0]) {
    const quarantineKey = this.key(input.storageKey)
    const finalStorageKey = `ready/${input.ownerUserId}/${input.mediaResourceId}`
    const finalKey = this.readyKey(finalStorageKey)
    try {
      const source = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket, Key: quarantineKey,
      })) as { Body?: { transformToByteArray(): Promise<Uint8Array> } }
      if (!source.Body) throw new Error('MEDIA_SOURCE_BODY_MISSING')
      const body = Buffer.from(await source.Body.transformToByteArray())
      const image = sharp(body, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
      const metadata = await image.metadata()
      const detectedMime = formatMime(metadata.format)
      if (detectedMime !== input.declaredMime || !metadata.width || !metadata.height) {
        throw mediaError('MEDIA_DECODE_MIME_MISMATCH', 422)
      }
      if (metadata.width > 12_000 || metadata.height > 12_000) {
        throw mediaError('MEDIA_DIMENSIONS_INVALID', 422)
      }
      const sanitized = await encode(image, detectedMime)
      const checksum = createChecksum(sanitized)
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket, Key: finalKey, Body: sanitized,
        ContentType: detectedMime,
        ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
        ServerSideEncryption: 'AES256', Tagging: 'VibeCheckAccess=ready',
      }))
      const dimensions = orientedDimensions(metadata.width, metadata.height, metadata.orientation)
      return Object.freeze({
        finalStorageKey, detectedMime,
        width: dimensions.width, height: dimensions.height, exifRemoved: true as const,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'MediaError') throw error
      throw mediaError('MEDIA_IMAGE_PROCESSING_FAILED', 503, true)
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

function formatMime(format: string | undefined): PublicMediaMime {
  const mapping: Record<string, PublicMediaMime> = {
    jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heif: 'image/avif', avif: 'image/avif',
  }
  const mime = format ? mapping[format] : undefined
  if (!mime) throw mediaError('MEDIA_DECODE_UNSUPPORTED', 415)
  return mime
}

function encode(image: Sharp, mime: PublicMediaMime): Promise<Buffer> {
  if (mime === 'image/jpeg') return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  if (mime === 'image/png') return image.png({ compressionLevel: 9 }).toBuffer()
  if (mime === 'image/webp') return image.webp({ quality: 90 }).toBuffer()
  return image.avif({ quality: 60 }).toBuffer()
}

function createChecksum(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function orientedDimensions(width: number, height: number, orientation: number | undefined) {
  return orientation && orientation >= 5 && orientation <= 8
    ? Object.freeze({ width: height, height: width })
    : Object.freeze({ width, height })
}
