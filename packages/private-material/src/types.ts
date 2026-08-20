export const verificationMaterialMimeTypes = [
  'application/pdf', 'image/jpeg', 'image/png',
] as const

export type VerificationMaterialMime = (typeof verificationMaterialMimeTypes)[number]
export type ApplicantScanState = 'pending' | 'accepted' | 'rejected'
export type ApplicantNextAction = 'complete_upload' | 'wait' | 'continue_submission' | 'upload_new_material' | 'none'

export interface ApplicantMaterialSummary {
  readonly material_id: string
  readonly verification_id: string
  readonly applicant_scan_state: ApplicantScanState
  readonly reason_key: 'upload_expired' | 'file_rejected' | 'processing_unavailable' | null
  readonly next_action: ApplicantNextAction
  readonly upload_expires_at: string | null
  readonly version: number
}

export interface PrepareMaterialProjection {
  readonly material: ApplicantMaterialSummary
  readonly upload_url: string
  readonly upload_headers: Readonly<Record<string, string>>
  readonly upload_expires_at: string
}

export interface CompleteMaterialProjection {
  readonly material: ApplicantMaterialSummary
  readonly scan_queued: true
}

export interface RevokeMaterialProjection {
  readonly material: ApplicantMaterialSummary
  readonly revoked_at: string
}

export interface PrepareMaterialCommand {
  readonly userId: string
  readonly verificationId: string
  readonly declaredMime: string
  readonly byteSize: number
  readonly checksum: string
  readonly idempotencyKey: string
  readonly requestId: string
}

export interface GetMaterialCommand {
  readonly userId: string
  readonly materialId: string
  readonly requestId: string
}

export interface CompleteMaterialCommand {
  readonly userId: string
  readonly materialId: string
  readonly checksum: string
  readonly uploadReceipt: string
  readonly operationId: string
  readonly requestId: string
}

export interface RevokeMaterialCommand {
  readonly userId: string
  readonly materialId: string
  readonly expectedVersion: number
  readonly reasonCode: string
  readonly operationId: string
  readonly requestId: string
}

export interface StorageKeyCiphertext {
  readonly ciphertext: Buffer
  readonly nonce: Buffer
  readonly authTag: Buffer
  readonly keyVersion: string
}

export interface MaterialUploadInspection {
  readonly detectedMime: string
  readonly byteSize: number
  readonly checksumSha256: string
}

export interface PrivateMaterialStorage {
  issueUpload(input: Readonly<{
    storageKey: string
    declaredMime: VerificationMaterialMime
    byteSize: number
    checksumSha256: string
    expiresAt: Date
  }>): Promise<Readonly<{
    uploadUrl: string
    uploadHeaders: Readonly<Record<string, string>>
  }>>
  inspectUpload(input: Readonly<{
    storageKey: string
    uploadReceipt: string
  }>): Promise<MaterialUploadInspection>
  allowReads(input: Readonly<{ storageKey: string }>): Promise<void>
  denyReads(input: Readonly<{ storageKey: string }>): Promise<void>
}

export type PrivateMaterialScanResult = 'pending' | 'clean' | 'malicious' | 'unscannable' | 'retryable_failure'

export interface PrivateMaterialScanSource {
  getScanResult(input: Readonly<{ storageKey: string }>): Promise<PrivateMaterialScanResult>
}
