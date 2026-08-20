export const mediaTargetTypes = [
  'submission_draft',
  'admin_project_creation_draft',
  'admin_project_edit_draft',
  'project_update',
  'creator_profile_draft',
  'project_version',
  'creator_profile_version',
] as const

export type MediaTargetType = (typeof mediaTargetTypes)[number]
export type MediaResourceStatus =
  | 'created' | 'uploading' | 'uploaded' | 'scanning'
  | 'processing' | 'ready' | 'rejected' | 'deleted'
export type MediaScanResult = 'not_scanned' | 'clean' | 'malicious' | 'unscannable'
export const publicMediaMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
export type PublicMediaMime = (typeof publicMediaMimeTypes)[number]
export type PublicMediaPurpose = 'project_cover'

export interface MediaResourceProjection {
  readonly media_resource_id: string
  readonly declared_mime: string
  readonly detected_mime: string | null
  readonly byte_size: number
  readonly width: number | null
  readonly height: number | null
  readonly duration_ms: number | null
  readonly checksum_sha256: string
  readonly source: 'upload' | 'migration'
  readonly status: MediaResourceStatus
  readonly scan_result: MediaScanResult
  readonly rejection_reason_code: string | null
  readonly scan_attempt_count: number
  readonly next_scan_at: string | null
  readonly exif_removed: boolean
  readonly deletion_guard_active: boolean
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface MediaReferenceProjection {
  readonly media_reference_id: string
  readonly media_resource_id: string
  readonly target_type: MediaTargetType
  readonly target_id: string
  readonly role: string
  readonly alt_text: string
  readonly sort_order: number
  readonly crop_focus: Readonly<Record<string, unknown>> | null
  readonly variant: string | null
  readonly source_media_reference_id: string | null
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface MediaReferencePage {
  readonly items: readonly MediaReferenceProjection[]
  readonly total_count: number
}

export interface GetMediaResourceCommand {
  readonly userId: string
  readonly mediaResourceId: string
  readonly requestId: string
}

export interface ReadMediaResourceContentCommand {
  readonly userId: string
  readonly mediaResourceId: string
  readonly requestId: string
}

export interface ReadMediaResourceContentProjection {
  readonly redirect_url: string
}

export interface PrepareMediaResourceCommand {
  readonly userId: string
  readonly purpose: string
  readonly declaredMime: string
  readonly byteSize: number
  readonly checksumSha256: string
  readonly idempotencyKey: string
  readonly requestId: string
}

export interface PrepareMediaResourceProjection {
  readonly media: MediaResourceProjection
  readonly upload_url: string
  readonly upload_headers: Readonly<Record<string, string>>
  readonly upload_expires_at: string
}

export interface CompleteMediaResourceCommand {
  readonly userId: string
  readonly mediaResourceId: string
  readonly checksumSha256: string
  readonly uploadReceipt: string
  readonly operationId: string
  readonly requestId: string
}

export interface CompleteMediaResourceProjection {
  readonly media: MediaResourceProjection
  readonly scan_queued: true
}

export interface MediaStorage {
  issueUpload(input: Readonly<{
    storageKey: string
    declaredMime: PublicMediaMime
    checksumSha256: string
    expiresAt: Date
  }>): Promise<Readonly<{
    uploadUrl: string
    uploadHeaders: Readonly<Record<string, string>>
  }>>
  inspectUpload(input: Readonly<{
    storageKey: string
    uploadReceipt: string
  }>): Promise<Readonly<{
    detectedMime: string
    byteSize: number
    checksumSha256: string
  }>>
  issueRead(input: Readonly<{
    storageKey: string
    expiresAt: Date
  }>): Promise<Readonly<{ readUrl: string }>>
}

export type MediaProviderScanResult =
  | 'pending' | 'clean' | 'malicious' | 'unscannable' | 'retryable_failure'

export interface MediaScanStorage {
  getScanResult(input: Readonly<{ storageKey: string }>): Promise<MediaProviderScanResult>
  sanitizeImage(input: Readonly<{
    storageKey: string
    mediaResourceId: string
    ownerUserId: string
    declaredMime: PublicMediaMime
  }>): Promise<Readonly<{
    finalStorageKey: string
    detectedMime: PublicMediaMime
    width: number
    height: number
    exifRemoved: true
  }>>
}

export interface CreateMediaReferenceCommand {
  readonly userId: string
  readonly mediaResourceId: string
  readonly targetType: string
  readonly targetId: string
  readonly role: string
  readonly altText: string
  readonly sortOrder: number
  readonly cropFocus: Readonly<Record<string, unknown>> | null
  readonly variant: string | null
  readonly clientRequestId: string
  readonly requestId: string
}

export interface ListMediaReferencesCommand {
  readonly userId: string
  readonly targetType: string
  readonly targetId: string
  readonly role: string | null
  readonly requestId: string
}

export interface PatchMediaReferenceCommand {
  readonly userId: string
  readonly mediaReferenceId: string
  readonly expectedVersion: number
  readonly altText: string
  readonly sortOrder: number
  readonly cropFocus: Readonly<Record<string, unknown>> | null
  readonly variant: string | null
  readonly operationId: string
  readonly requestId: string
}

export interface DeleteMediaReferenceCommand {
  readonly userId: string
  readonly mediaReferenceId: string
  readonly expectedVersion: number
  readonly operationId: string
  readonly requestId: string
}
