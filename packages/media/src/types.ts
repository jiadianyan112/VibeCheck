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
