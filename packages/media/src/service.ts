import { createHash, randomUUID } from 'node:crypto'

import { mediaError } from './errors.js'
import type { MediaStore } from './store-port.js'
import {
  mediaTargetTypes,
  type CreateMediaReferenceCommand,
  type CompleteMediaResourceCommand,
  type CompleteMediaResourceProjection,
  type DeleteMediaReferenceCommand,
  type GetMediaResourceCommand,
  type ListMediaReferencesCommand,
  type MediaReferencePage,
  type MediaReferenceProjection,
  type MediaResourceProjection,
  type MediaTargetType,
  type PatchMediaReferenceCommand,
  type PrepareMediaResourceCommand,
  type PrepareMediaResourceProjection,
  type ReadMediaResourceContentCommand,
  type ReadMediaResourceContentProjection,
  type MediaStorage,
  type PublicMediaMime,
  publicMediaMimeTypes,
} from './types.js'

const editableTargetTypes = new Set<MediaTargetType>([
  'submission_draft',
  'admin_project_creation_draft',
  'admin_project_edit_draft',
  'project_update',
  'creator_profile_draft',
])

export class MediaService {
  private readonly now: () => Date
  private readonly storage: MediaStorage | undefined

  constructor(
    private readonly store: MediaStore,
    storageOrNow?: MediaStorage | (() => Date),
    now: () => Date = () => new Date(),
  ) {
    this.storage = typeof storageOrNow === 'function' ? undefined : storageOrNow
    this.now = typeof storageOrNow === 'function' ? storageOrNow : now
  }

  async prepareResource(command: PrepareMediaResourceCommand): Promise<PrepareMediaResourceProjection> {
    const storage = this.requiredStorage()
    const userId = this.uuid(command.userId, 'MEDIA_USER_INVALID')
    const purpose = this.purpose(command.purpose)
    const declaredMime = this.publicMime(command.declaredMime)
    const byteSize = this.byteSize(command.byteSize)
    const checksumSha256 = this.checksum(command.checksumSha256)
    const idempotencyKey = this.operationId(command.idempotencyKey)
    const now = this.now()
    const requestHash = this.hash(JSON.stringify({
      purpose, declared_mime: declaredMime, byte_size: byteSize, checksum_sha256: checksumSha256,
    }))
    const mediaResourceId = randomUUID()
    const row = await this.store.prepareResource({
      mediaResourceId, userId, purpose,
      storageKey: `quarantine/${userId}/${mediaResourceId}`,
      declaredMime, byteSize, checksumSha256, idempotencyKey, requestHash,
      requestId: this.requestId(command.requestId),
      uploadExpiresAt: new Date(now.getTime() + 15 * 60_000), now,
    })
    if (row.projection.status !== 'uploading') throw mediaError('MEDIA_RESOURCE_NOT_UPLOADABLE', 409)
    if (row.uploadExpiresAt <= now) throw mediaError('MEDIA_UPLOAD_EXPIRED', 410)
    const upload = await storage.issueUpload({
      storageKey: row.storageKey, declaredMime,
      checksumSha256: row.projection.checksum_sha256, expiresAt: row.uploadExpiresAt,
    })
    const parsed = new URL(upload.uploadUrl)
    if (parsed.protocol !== 'https:') throw mediaError('MEDIA_STORAGE_RESPONSE_INVALID', 503, true)
    return Object.freeze({
      media: row.projection,
      upload_url: upload.uploadUrl,
      upload_headers: this.uploadHeaders(upload.uploadHeaders, declaredMime, checksumSha256),
      upload_expires_at: row.uploadExpiresAt.toISOString(),
    })
  }

  async completeResource(command: CompleteMediaResourceCommand): Promise<CompleteMediaResourceProjection> {
    const storage = this.requiredStorage()
    const userId = this.uuid(command.userId, 'MEDIA_USER_INVALID')
    const mediaResourceId = this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID')
    const checksumSha256 = this.checksum(command.checksumSha256)
    const uploadReceipt = this.opaque(command.uploadReceipt, 'MEDIA_UPLOAD_RECEIPT_INVALID', 4_096)
    const operationId = this.operationId(command.operationId)
    const requestId = this.requestId(command.requestId)
    const requestHash = this.hash(JSON.stringify({
      checksum_sha256: checksumSha256,
      upload_receipt_hash: this.hash(uploadReceipt),
    }))
    const replay = await this.store.getCompletionReceipt({ userId, mediaResourceId, operationId })
    if (replay) {
      if (replay.requestHash !== requestHash) throw mediaError('OPERATION_ID_REUSED', 409)
      return this.completionReceipt(replay.response)
    }
    const row = await this.store.getUploadResource({ userId, mediaResourceId })
    if (row.projection.status !== 'uploading') throw mediaError('MEDIA_RESOURCE_NOT_COMPLETABLE', 409)
    const now = this.now()
    if (row.uploadExpiresAt <= now) throw mediaError('MEDIA_UPLOAD_EXPIRED', 410)
    if (row.projection.checksum_sha256 !== checksumSha256) {
      throw mediaError('MEDIA_CHECKSUM_INPUT_MISMATCH', 422)
    }
    const inspected = await storage.inspectUpload({ storageKey: row.storageKey, uploadReceipt })
    const detectedChecksum = this.checksum(inspected.checksumSha256)
    const mimeMatches = inspected.detectedMime === row.projection.declared_mime
    const checksumMatches = inspected.byteSize === row.projection.byte_size &&
      detectedChecksum === row.projection.checksum_sha256
    const rejectionReason = !mimeMatches ? 'MIME_MISMATCH' : !checksumMatches ? 'CHECKSUM_MISMATCH' : null
    const result = await this.store.completeResource({
      userId, mediaResourceId, operationId, requestHash,
      uploadReceiptHash: this.hash(uploadReceipt), detectedMime: inspected.detectedMime,
      detectedByteSize: inspected.byteSize, detectedChecksumSha256: detectedChecksum,
      accepted: rejectionReason === null, rejectionReason,
      processingDeadlineAt: new Date(now.getTime() + 30 * 60_000), requestId, now,
    })
    if (result.errorCode === 'MIME_MISMATCH') throw mediaError('MEDIA_MIME_MISMATCH', 415)
    if (result.errorCode === 'CHECKSUM_MISMATCH') throw mediaError('MEDIA_CHECKSUM_MISMATCH', 422)
    return Object.freeze({ media: result.projection, scan_queued: true })
  }

  getResource(command: GetMediaResourceCommand): Promise<MediaResourceProjection> {
    return this.store.getResource({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaResourceId: this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID'),
    })
  }

  async readResourceContent(
    command: ReadMediaResourceContentCommand,
  ): Promise<ReadMediaResourceContentProjection> {
    const storage = this.requiredStorage()
    const row = await this.store.getContentResource({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaResourceId: this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID'),
    })
    this.requestId(command.requestId)
    if (row.projection.status !== 'ready' || row.projection.scan_result !== 'clean') {
      throw mediaError('MEDIA_RESOURCE_NOT_READY', 409)
    }
    const signed = await storage.issueRead({
      storageKey: row.storageKey, expiresAt: new Date(this.now().getTime() + 60_000),
    })
    if (new URL(signed.readUrl).protocol !== 'https:') {
      throw mediaError('MEDIA_STORAGE_RESPONSE_INVALID', 503, true)
    }
    return Object.freeze({ redirect_url: signed.readUrl })
  }

  createReference(command: CreateMediaReferenceCommand): Promise<MediaReferenceProjection> {
    const targetType = this.targetType(command.targetType)
    if (!editableTargetTypes.has(targetType)) throw mediaError('MEDIA_REFERENCE_TARGET_READ_ONLY', 403)
    const normalized = Object.freeze({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaResourceId: this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID'),
      targetType,
      targetId: this.uuid(command.targetId, 'MEDIA_TARGET_ID_INVALID'),
      role: this.role(command.role),
      altText: this.alt(command.altText),
      sortOrder: this.sortOrder(command.sortOrder),
      cropFocus: this.cropFocus(command.cropFocus),
      variant: this.variant(command.variant),
      operationId: this.operationId(command.clientRequestId),
      requestId: this.requestId(command.requestId),
    })
    return this.store.createReference({
      ...normalized,
      requestHash: this.hash(JSON.stringify({
        media_resource_id: normalized.mediaResourceId,
        target_type: normalized.targetType,
        target_id: normalized.targetId,
        role: normalized.role,
        alt_text: normalized.altText,
        sort_order: normalized.sortOrder,
        crop_focus: normalized.cropFocus,
        variant: normalized.variant,
      })),
      now: this.now(),
    })
  }

  listReferences(command: ListMediaReferencesCommand): Promise<MediaReferencePage> {
    return this.store.listReferences({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      targetType: this.targetType(command.targetType),
      targetId: this.uuid(command.targetId, 'MEDIA_TARGET_ID_INVALID'),
      role: command.role === null ? null : this.role(command.role),
      now: this.now(),
    })
  }

  patchReference(command: PatchMediaReferenceCommand): Promise<MediaReferenceProjection> {
    const expectedVersion = this.version(command.expectedVersion)
    const altText = this.alt(command.altText)
    const sortOrder = this.sortOrder(command.sortOrder)
    const cropFocus = this.cropFocus(command.cropFocus)
    const variant = this.variant(command.variant)
    const operationId = this.operationId(command.operationId)
    return this.store.patchReference({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaReferenceId: this.uuid(command.mediaReferenceId, 'MEDIA_REFERENCE_ID_INVALID'),
      expectedVersion,
      altText,
      sortOrder,
      cropFocus,
      variant,
      operationId,
      requestHash: this.hash(JSON.stringify({
        expected_version: expectedVersion,
        alt_text: altText,
        sort_order: sortOrder,
        crop_focus: cropFocus,
        variant,
      })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  deleteReference(command: DeleteMediaReferenceCommand): Promise<void> {
    const expectedVersion = this.version(command.expectedVersion)
    const operationId = this.operationId(command.operationId)
    return this.store.deleteReference({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaReferenceId: this.uuid(command.mediaReferenceId, 'MEDIA_REFERENCE_ID_INVALID'),
      expectedVersion,
      operationId,
      requestHash: this.hash(JSON.stringify({ expected_version: expectedVersion })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw mediaError(code, 422)
    }
    return value.toLowerCase()
  }

  private requiredStorage(): MediaStorage {
    if (!this.storage) throw mediaError('MEDIA_STORAGE_UNAVAILABLE', 503, true)
    return this.storage
  }

  private purpose(value: string): 'project_cover' {
    if (value !== 'project_cover') throw mediaError('MEDIA_PURPOSE_INVALID', 422)
    return value
  }

  private publicMime(value: string): PublicMediaMime {
    if (!publicMediaMimeTypes.includes(value as PublicMediaMime)) {
      throw mediaError('MEDIA_MIME_UNSUPPORTED', 415)
    }
    return value as PublicMediaMime
  }

  private byteSize(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 5_242_880) {
      throw mediaError('MEDIA_SIZE_INVALID', 413)
    }
    return value
  }

  private checksum(value: string): string {
    const normalized = value.toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(normalized)) throw mediaError('MEDIA_CHECKSUM_INVALID', 422)
    return normalized
  }

  private opaque(value: string, code: string, maximum: number): string {
    const containsControl = typeof value === 'string' && Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 32 || codePoint === 127
    })
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum || containsControl) {
      throw mediaError(code, 422)
    }
    return value
  }

  private uploadHeaders(
    value: Readonly<Record<string, string>>,
    mime: PublicMediaMime,
    checksum: string,
  ): Readonly<Record<string, string>> {
    const expected = Object.freeze({
      'content-type': mime,
      'if-none-match': '*',
      'x-amz-checksum-sha256': Buffer.from(checksum, 'hex').toString('base64'),
      'x-amz-server-side-encryption': 'AES256',
      'x-amz-tagging': 'VibeCheckAccess=quarantined',
    })
    if (Object.keys(value).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)) {
      throw mediaError('MEDIA_STORAGE_RESPONSE_INVALID', 503, true)
    }
    return expected
  }

  private completionReceipt(value: unknown): CompleteMediaResourceProjection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw mediaError('MEDIA_OPERATION_RECEIPT_INVALID', 500, true)
    }
    const receipt = value as Record<string, unknown>
    if (receipt.error_code === 'MIME_MISMATCH') throw mediaError('MEDIA_MIME_MISMATCH', 415)
    if (receipt.error_code === 'CHECKSUM_MISMATCH') throw mediaError('MEDIA_CHECKSUM_MISMATCH', 422)
    if (receipt.scan_queued !== true || !receipt.media || typeof receipt.media !== 'object') {
      throw mediaError('MEDIA_OPERATION_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze({ media: Object.freeze(receipt.media) as MediaResourceProjection, scan_queued: true })
  }

  private targetType(value: string): MediaTargetType {
    if (!mediaTargetTypes.includes(value as MediaTargetType)) {
      throw mediaError('MEDIA_TARGET_TYPE_INVALID', 422)
    }
    return value as MediaTargetType
  }

  private role(value: string): string {
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) throw mediaError('MEDIA_ROLE_INVALID', 422)
    return normalized
  }

  private alt(value: string): string {
    const normalized = Array.from(value)
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint < 32 || codePoint === 127 ? ' ' : character
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length < 1 || normalized.length > 200) throw mediaError('MEDIA_ALT_TEXT_INVALID', 422)
    return normalized
  }

  private sortOrder(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999) {
      throw mediaError('MEDIA_SORT_ORDER_INVALID', 422)
    }
    return value
  }

  private cropFocus(value: Readonly<Record<string, unknown>> | null): Readonly<Record<string, unknown>> | null {
    if (value === null) return null
    const encoded = JSON.stringify(value)
    if (encoded.length > 2_048) throw mediaError('MEDIA_CROP_FOCUS_INVALID', 422)
    const x = value.x
    const y = value.y
    if (
      Object.keys(value).some((key) => !['x', 'y'].includes(key)) ||
      typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 ||
      typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1
    ) throw mediaError('MEDIA_CROP_FOCUS_INVALID', 422)
    return Object.freeze({ x, y })
  }

  private variant(value: string | null): string | null {
    if (value === null) return null
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized)) {
      throw mediaError('MEDIA_VARIANT_INVALID', 422)
    }
    return normalized
  }

  private version(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw mediaError('MEDIA_VERSION_INVALID', 422)
    return value
  }

  private operationId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw mediaError('OPERATION_ID_INVALID', 422)
    return value
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw mediaError('REQUEST_ID_INVALID', 422)
    return value
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
