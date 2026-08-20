import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'

import { privateMaterialError } from './errors.js'
import {
  PostgresPrivateMaterialStore,
  applicantSummary,
  type StoredMaterial,
} from './store.js'
import {
  verificationMaterialMimeTypes,
  type CompleteMaterialCommand,
  type CompleteMaterialProjection,
  type GetMaterialCommand,
  type ApplicantMaterialSummary,
  type PrepareMaterialCommand,
  type PrepareMaterialProjection,
  type PrivateMaterialStorage,
  type RevokeMaterialCommand,
  type RevokeMaterialProjection,
  type StorageKeyCiphertext,
  type VerificationMaterialMime,
} from './types.js'

export interface PrivateMaterialStorePort {
  findPrepareReplay: PostgresPrivateMaterialStore['findPrepareReplay']
  getOwned: PostgresPrivateMaterialStore['getOwned']
  create: PostgresPrivateMaterialStore['create']
  recordSelfRead: PostgresPrivateMaterialStore['recordSelfRead']
  getOperationReplay: PostgresPrivateMaterialStore['getOperationReplay']
  complete: PostgresPrivateMaterialStore['complete']
  revoke: PostgresPrivateMaterialStore['revoke']
}

export interface PrivateMaterialCryptoConfig {
  readonly encryptionKeyBase64: string
  readonly encryptionKeyVersion: string
}

export type PrivateMaterialStorageKeyResolver = (row: StoredMaterial) => string

export function createPrivateMaterialStorageKeyResolver(
  crypto: PrivateMaterialCryptoConfig,
): PrivateMaterialStorageKeyResolver {
  const key = Buffer.from(crypto.encryptionKeyBase64, 'base64')
  if (key.length!==32 || key.toString('base64')!==crypto.encryptionKeyBase64) {
    throw new Error('PRIVATE_MATERIAL_ENCRYPTION_KEY_INVALID')
  }
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(crypto.encryptionKeyVersion)) {
    throw new Error('PRIVATE_MATERIAL_ENCRYPTION_KEY_VERSION_INVALID')
  }
  return (row: StoredMaterial): string => {
    if (row.storage_key_version!==crypto.encryptionKeyVersion) {
      throw privateMaterialError('MATERIAL_KEY_VERSION_UNAVAILABLE', 503, true)
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, row.storage_key_nonce)
      decipher.setAAD(Buffer.from(`${row.owner_user_id}:${row.verification_id}:${row.material_id}`, 'utf8'))
      decipher.setAuthTag(row.storage_key_auth_tag)
      return Buffer.concat([decipher.update(row.storage_key_ciphertext), decipher.final()]).toString('utf8')
    } catch {
      throw privateMaterialError('MATERIAL_KEY_DECRYPT_FAILED', 503, false)
    }
  }
}

export class PrivateMaterialService {
  private readonly key: Buffer
  private readonly resolveStorageKey: PrivateMaterialStorageKeyResolver
  private readonly now: () => Date

  constructor(private readonly dependencies: Readonly<{
    store: PrivateMaterialStorePort
    storage: PrivateMaterialStorage
    crypto: PrivateMaterialCryptoConfig
    now?: () => Date
  }>) {
    this.key = Buffer.from(dependencies.crypto.encryptionKeyBase64, 'base64')
    if (this.key.length!==32 || this.key.toString('base64')!==dependencies.crypto.encryptionKeyBase64) {
      throw new Error('PRIVATE_MATERIAL_ENCRYPTION_KEY_INVALID')
    }
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(dependencies.crypto.encryptionKeyVersion)) {
      throw new Error('PRIVATE_MATERIAL_ENCRYPTION_KEY_VERSION_INVALID')
    }
    this.resolveStorageKey = createPrivateMaterialStorageKeyResolver(dependencies.crypto)
    this.now = dependencies.now ?? (() => new Date())
  }

  async prepare(command: PrepareMaterialCommand): Promise<PrepareMaterialProjection> {
    const userId = uuid(command.userId, 'MATERIAL_USER_INVALID')
    const verificationId = uuid(command.verificationId, 'VERIFICATION_ID_INVALID')
    const declaredMime = mime(command.declaredMime)
    const byteSize = bytes(command.byteSize)
    const checksum = sha256(command.checksum, 'MATERIAL_CHECKSUM_INVALID')
    const idempotencyKey = operationId(command.idempotencyKey)
    const requestId = requestIdValue(command.requestId)
    const requestHash = hashJson({
      verification_id: verificationId,
      declared_mime: declaredMime,
      byte_size: byteSize,
      checksum_sha256: checksum,
    })
    let row = await this.dependencies.store.findPrepareReplay(userId, idempotencyKey)
    if (row && row.request_hash!==requestHash) throw privateMaterialError('MATERIAL_IDEMPOTENCY_KEY_REUSED', 409)
    if (!row) {
      const materialId = randomUUID()
      const storageKey = `verification/${verificationId}/${materialId}`
      row = await this.dependencies.store.create({
        materialId, verificationId, userId,
        storageKey: this.encryptStorageKey(storageKey, userId, verificationId, materialId),
        declaredMime, byteSize, checksum, idempotencyKey, requestHash,
        now: this.now(), requestId,
      })
    }
    if (row.status!=='prepared') throw privateMaterialError('VERIFICATION_MATERIAL_NOT_UPLOADABLE', 409)
    const now = this.now()
    if (row.upload_expires_at<=now) throw privateMaterialError('VERIFICATION_MATERIAL_UPLOAD_EXPIRED', 410)
    const storageKey = this.resolveStorageKey(row)
    const upload = await this.dependencies.storage.issueUpload({
      storageKey,
      declaredMime: row.declared_mime,
      byteSize: row.byte_size,
      checksumSha256: row.checksum_sha256,
      expiresAt: row.upload_expires_at,
    })
    const parsed = new URL(upload.uploadUrl)
    if (parsed.protocol!=='https:') throw privateMaterialError('MATERIAL_STORAGE_RESPONSE_INVALID', 503, true)
    const uploadHeaders = validateUploadHeaders(upload.uploadHeaders, row)
    return Object.freeze({
      material: applicantSummary(row),
      upload_url: upload.uploadUrl,
      upload_headers: uploadHeaders,
      upload_expires_at: row.upload_expires_at.toISOString(),
    })
  }

  async get(command: GetMaterialCommand): Promise<ApplicantMaterialSummary> {
    const userId = uuid(command.userId, 'MATERIAL_USER_INVALID')
    const materialId = uuid(command.materialId, 'MATERIAL_ID_INVALID')
    const row = await this.dependencies.store.getOwned(userId, materialId)
    if (!row) throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND', 404)
    if (row.status==='deleted') throw privateMaterialError('VERIFICATION_MATERIAL_DELETED', 410)
    await this.dependencies.store.recordSelfRead(userId, materialId, requestIdValue(command.requestId), this.now())
    return applicantSummary(row)
  }

  async complete(command: CompleteMaterialCommand): Promise<CompleteMaterialProjection> {
    const userId = uuid(command.userId, 'MATERIAL_USER_INVALID')
    const materialId = uuid(command.materialId, 'MATERIAL_ID_INVALID')
    const checksum = sha256(command.checksum, 'MATERIAL_CHECKSUM_INVALID')
    const uploadReceipt = boundedOpaque(command.uploadReceipt, 'MATERIAL_UPLOAD_RECEIPT_INVALID', 4_096)
    const operation = operationId(command.operationId)
    const requestId = requestIdValue(command.requestId)
    const requestHash = hashJson({ checksum_sha256: checksum, upload_receipt_hash: hash(uploadReceipt) })
    const replay = await this.dependencies.store.getOperationReplay({ materialId, userId, operationId: operation })
    if (replay && replay.requestHash!==requestHash) throw privateMaterialError('MATERIAL_OPERATION_REUSED', 409)
    if (replay) {
      return this.completeReplay(replay.response)
    }
    const current = await this.requiredOwned(userId, materialId)
    if (current.status!=='prepared') throw privateMaterialError('VERIFICATION_MATERIAL_NOT_COMPLETABLE', 409)
    if (current.upload_expires_at<=this.now()) throw privateMaterialError('VERIFICATION_MATERIAL_UPLOAD_EXPIRED', 410)
    if (checksum!==current.checksum_sha256) throw privateMaterialError('MATERIAL_CHECKSUM_INPUT_MISMATCH', 422)
    const inspection = await this.dependencies.storage.inspectUpload({
      storageKey: this.resolveStorageKey(current), uploadReceipt,
    })
    const detectedChecksum = sha256(inspection.checksumSha256, 'MATERIAL_STORAGE_RESPONSE_INVALID')
    const mimeMatches = inspection.detectedMime===current.declared_mime
    const checksumMatches = detectedChecksum===current.checksum_sha256 && inspection.byteSize===current.byte_size
    const rejectionReason = !mimeMatches ? 'MIME_MISMATCH' : !checksumMatches ? 'CHECKSUM_MISMATCH' : null
    const accepted = rejectionReason===null
    const result = await this.dependencies.store.complete({
      materialId, userId, checksum, uploadReceiptHash: hash(uploadReceipt),
      detectedMime: inspection.detectedMime, detectedByteSize: inspection.byteSize,
      detectedChecksum, operationId: operation, requestHash,
      accepted, rejectionReason,
      now: this.now(), requestId,
    })
    return this.completeReplay(result.operationResponse)
  }

  async revoke(command: RevokeMaterialCommand): Promise<RevokeMaterialProjection> {
    const userId = uuid(command.userId, 'MATERIAL_USER_INVALID')
    const materialId = uuid(command.materialId, 'MATERIAL_ID_INVALID')
    const expectedVersion = version(command.expectedVersion)
    const reasonCode = reason(command.reasonCode)
    const operation = operationId(command.operationId)
    const requestHash = hashJson({ expected_version: expectedVersion, reason_code: reasonCode })
    const before = await this.requiredOwned(userId, materialId)
    const row = await this.dependencies.store.revoke({
      materialId, userId, expectedVersion, operationId: operation, requestHash, reasonCode,
      now: this.now(), requestId: requestIdValue(command.requestId),
    })
    try {
      await this.dependencies.storage.denyReads({ storageKey: this.resolveStorageKey(before) })
    } catch {
      throw privateMaterialError('MATERIAL_STORAGE_REVOKE_PENDING', 503, true)
    }
    return Object.freeze({
      material: applicantSummary(row),
      revoked_at: row.revoked_at!.toISOString(),
    })
  }

  private async requiredOwned(userId: string, materialId: string): Promise<StoredMaterial> {
    const row = await this.dependencies.store.getOwned(userId, materialId)
    if (!row) throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND', 404)
    return row
  }

  private encryptStorageKey(storageKey: string, userId: string, verificationId: string, materialId: string): StorageKeyCiphertext {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from(`${userId}:${verificationId}:${materialId}`, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(storageKey, 'utf8'), cipher.final()])
    return Object.freeze({
      ciphertext, nonce, authTag: cipher.getAuthTag(),
      keyVersion: this.dependencies.crypto.encryptionKeyVersion,
    })
  }

  private completeReplay(value: unknown): CompleteMaterialProjection {
    if (!value || typeof value!=='object' || Array.isArray(value)) {
      throw privateMaterialError('MATERIAL_OPERATION_RECEIPT_INVALID', 503, false)
    }
    const receipt = value as Record<string, unknown>
    if (receipt.error_code==='MIME_MISMATCH') throw privateMaterialError('MATERIAL_MIME_MISMATCH', 415)
    if (receipt.error_code==='CHECKSUM_MISMATCH') throw privateMaterialError('MATERIAL_CHECKSUM_MISMATCH', 422)
    if (receipt.scan_queued!==true || !receipt.material || typeof receipt.material!=='object') {
      throw privateMaterialError('MATERIAL_OPERATION_RECEIPT_INVALID', 503, false)
    }
    return Object.freeze({
      material: Object.freeze({ ...(receipt.material as ApplicantMaterialSummary) }),
      scan_queued: true,
    })
  }
}

function uuid(value: string, code: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw privateMaterialError(code, 422)
  }
  return value.toLowerCase()
}

function mime(value: string): VerificationMaterialMime {
  if (!verificationMaterialMimeTypes.includes(value as VerificationMaterialMime)) {
    throw privateMaterialError('MATERIAL_MIME_UNSUPPORTED', 415)
  }
  return value as VerificationMaterialMime
}

function bytes(value: number): number {
  if (!Number.isSafeInteger(value) || value<1 || value>10_485_760) throw privateMaterialError('MATERIAL_SIZE_INVALID', 413)
  return value
}

function sha256(value: string, code: string): string {
  const normalized = value.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw privateMaterialError(code, 422)
  return normalized
}

function operationId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw privateMaterialError('MATERIAL_OPERATION_ID_INVALID', 422)
  return value
}

function requestIdValue(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw privateMaterialError('MATERIAL_REQUEST_ID_INVALID', 422)
  return value
}

function boundedOpaque(value: string, code: string, maximum: number): string {
  const containsControl = typeof value==='string' && Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint<32 || codePoint===127
  })
  if (typeof value!=='string' || value.length<8 || value.length>maximum || containsControl) {
    throw privateMaterialError(code, 422)
  }
  return value
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value<1) throw privateMaterialError('MATERIAL_VERSION_INVALID', 422)
  return value
}

function reason(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) throw privateMaterialError('MATERIAL_REASON_INVALID', 422)
  return normalized
}

function hashJson(value: unknown): string { return hash(JSON.stringify(value)) }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

function validateUploadHeaders(
  value: Readonly<Record<string, string>>,
  row: StoredMaterial,
): Readonly<Record<string, string>> {
  const expected = Object.freeze({
    'content-type': row.declared_mime,
    'if-none-match': '*',
    'x-amz-checksum-sha256': Buffer.from(row.checksum_sha256, 'hex').toString('base64'),
    'x-amz-server-side-encryption': 'AES256',
    'x-amz-tagging': 'VibeCheckAccess=quarantined',
  })
  if (
    Object.keys(value).length!==Object.keys(expected).length ||
    Object.entries(expected).some(([key, expectedValue]) => value[key]!==expectedValue)
  ) throw privateMaterialError('MATERIAL_STORAGE_RESPONSE_INVALID', 503, true)
  return expected
}
