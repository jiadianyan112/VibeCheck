import {
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  type Tag,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { PrivateMaterialError, privateMaterialError } from './errors.js'
import type {
  PrivateMaterialScanResult,
  PrivateMaterialScanSource,
  PrivateMaterialStorage,
} from './types.js'

export interface AwsS3PrivateMaterialConfig {
  readonly region: string
  readonly bucket: string
  readonly objectPrefix: string
}

export interface S3PrivateMaterialClient {
  send(command: unknown): Promise<unknown>
}

export type S3PrivateMaterialPresigner = (
  command: PutObjectCommand,
  options: Readonly<{
    expiresIn: number
    signableHeaders: ReadonlySet<string>
    unhoistableHeaders: ReadonlySet<string>
  }>,
) => Promise<string>

export class AwsS3PrivateMaterialStorage implements PrivateMaterialStorage, PrivateMaterialScanSource {
  private readonly client: S3PrivateMaterialClient
  private readonly presign: S3PrivateMaterialPresigner

  constructor(
    private readonly config: AwsS3PrivateMaterialConfig,
    client?: S3PrivateMaterialClient,
    presign?: S3PrivateMaterialPresigner,
  ) {
    this.client = client ?? new S3Client({ region: config.region })
    this.presign = presign ?? ((command, options) => getSignedUrl(
      this.client as S3Client,
      command,
      {
        expiresIn: options.expiresIn,
        signableHeaders: new Set(options.signableHeaders),
        unhoistableHeaders: new Set(options.unhoistableHeaders),
      },
    ))
  }

  async issueUpload(input: Parameters<PrivateMaterialStorage['issueUpload']>[0]) {
    const expiresIn = Math.max(1, Math.min(1_800, Math.floor((input.expiresAt.getTime()-Date.now())/1_000)))
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.key(input.storageKey),
      ContentType: input.declaredMime,
      IfNoneMatch: '*',
      ChecksumSHA256: Buffer.from(input.checksumSha256, 'hex').toString('base64'),
      ServerSideEncryption: 'AES256',
      Tagging: 'VibeCheckAccess=quarantined',
    })
    try {
      const uploadUrl = await this.presign(command, {
        expiresIn,
        signableHeaders: new Set(['content-type', 'if-none-match']),
        unhoistableHeaders: new Set([
          'x-amz-checksum-sha256',
          'x-amz-server-side-encryption',
          'x-amz-tagging',
        ]),
      })
      return Object.freeze({
        uploadUrl,
        uploadHeaders: Object.freeze({
          'content-type': input.declaredMime,
          'if-none-match': '*',
          'x-amz-checksum-sha256': Buffer.from(input.checksumSha256, 'hex').toString('base64'),
          'x-amz-server-side-encryption': 'AES256',
          'x-amz-tagging': 'VibeCheckAccess=quarantined',
        }),
      })
    } catch {
      throw privateMaterialError('MATERIAL_STORAGE_UPLOAD_SIGNING_FAILED', 503, true)
    }
  }

  async inspectUpload(input: Parameters<PrivateMaterialStorage['inspectUpload']>[0]) {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(input.storageKey),
        ChecksumMode: 'ENABLED',
      })) as {
        ContentType?: string
        ContentLength?: number
        ChecksumSHA256?: string
        ETag?: string
      }
      const etag = result.ETag?.replace(/^"|"$/g, '')
      const uploadReceipt = input.uploadReceipt.replace(/^"|"$/g, '')
      if (!etag || etag!==uploadReceipt) {
        throw privateMaterialError('MATERIAL_UPLOAD_RECEIPT_MISMATCH', 422)
      }
      if (!result.ContentType || result.ContentLength===undefined || !result.ChecksumSHA256) {
        throw privateMaterialError('MATERIAL_STORAGE_METADATA_INCOMPLETE', 503, true)
      }
      return Object.freeze({
        detectedMime: result.ContentType,
        byteSize: result.ContentLength,
        checksumSha256: Buffer.from(result.ChecksumSHA256, 'base64').toString('hex'),
      })
    } catch (error) {
      if (error instanceof Error && error.name==='PrivateMaterialError') throw error
      throw privateMaterialError('MATERIAL_STORAGE_INSPECTION_FAILED', 503, true)
    }
  }

  async allowReads(input: Parameters<PrivateMaterialStorage['allowReads']>[0]): Promise<void> {
    await this.setAccess(input.storageKey, 'ready', 'MATERIAL_STORAGE_ALLOW_READ_FAILED')
  }

  async denyReads(input: Parameters<PrivateMaterialStorage['denyReads']>[0]): Promise<void> {
    await this.setAccess(input.storageKey, 'revoked', 'MATERIAL_STORAGE_REVOKE_FAILED')
  }

  private async setAccess(
    storageKey: string,
    access: 'ready' | 'revoked',
    errorCode: string,
  ): Promise<void> {
    try {
      const current = await this.tags(storageKey)
      if (
        access==='ready' &&
        current.find((tag) => tag.Key==='GuardDutyMalwareScanStatus')?.Value!=='NO_THREATS_FOUND'
      ) throw privateMaterialError('MATERIAL_STORAGE_SCAN_TAG_NOT_CLEAN', 409, true)
      const tags = current.filter((tag) => tag.Key!=='VibeCheckAccess')
      tags.push({ Key: 'VibeCheckAccess', Value: access })
      await this.client.send(new PutObjectTaggingCommand({
        Bucket: this.config.bucket,
        Key: this.key(storageKey),
        Tagging: { TagSet: tags },
      }))
    } catch (error) {
      if (error instanceof PrivateMaterialError) throw error
      throw privateMaterialError(errorCode, 503, true)
    }
  }

  async getScanResult(input: Readonly<{ storageKey: string }>): Promise<PrivateMaterialScanResult> {
    let tags: Tag[]
    try {
      tags = await this.tags(input.storageKey)
    } catch {
      return 'retryable_failure'
    }
    const status = tags.find((tag) => tag.Key==='GuardDutyMalwareScanStatus')?.Value
    if (status===undefined) return 'pending'
    if (status==='NO_THREATS_FOUND') return 'clean'
    if (status==='THREATS_FOUND') return 'malicious'
    if (status==='UNSUPPORTED') return 'unscannable'
    if (status==='ACCESS_DENIED' || status==='FAILED') return 'retryable_failure'
    return 'retryable_failure'
  }

  private async tags(storageKey: string): Promise<Tag[]> {
    const result = await this.client.send(new GetObjectTaggingCommand({
      Bucket: this.config.bucket,
      Key: this.key(storageKey),
    })) as { TagSet?: Tag[] }
    return [...(result.TagSet ?? [])]
  }

  private key(storageKey: string): string {
    const match = /^verification\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(storageKey)
    if (!match) {
      throw privateMaterialError('MATERIAL_STORAGE_KEY_INVALID', 503, false)
    }
    return `${this.config.objectPrefix}${match[1]}/${match[2]}`
  }
}
