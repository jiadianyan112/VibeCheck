import type { LinkPermissionCapability } from './link-permission-profile.js'

export const projectUpdateTypes = ['version', 'address', 'status', 'asset', 'description'] as const
export type ProjectUpdateType = (typeof projectUpdateTypes)[number]

export interface ProjectUpdateDiffInput {
  readonly field_path: string
  readonly after_value: unknown
}

export interface ProjectUpdateBeforeAfter {
  readonly field_path: string
  readonly before_value: unknown
  readonly after_value: unknown
}

export interface ProjectUpdateAuthorizationSnapshot {
  readonly creator_account_link_id: string
  readonly creator_id: string
  readonly author_relation_id: string
  readonly permission_profile_id: 'OWNER_V1' | 'MANAGER_V1'
  readonly permission_profile_version: 1
  readonly permission_profile_config_hash: string
  readonly link_version: number
  readonly author_relation_version: number
  readonly capabilities: readonly LinkPermissionCapability[]
  readonly field_paths: readonly string[]
}

export interface ProjectUpdateProjection {
  readonly update_id: string
  readonly project_id: string
  readonly owner_user_id: string
  readonly origin_review_status: string
  readonly base_version_id: string
  readonly current_version_id: string
  readonly update_type: ProjectUpdateType
  readonly category_change_type: string | null
  readonly payload_diff: readonly ProjectUpdateDiffInput[]
  readonly before_after: readonly ProjectUpdateBeforeAfter[]
  readonly evidence_draft_ids: readonly string[]
  readonly media_reference_ids: readonly string[]
  readonly authorization_snapshot: ProjectUpdateAuthorizationSnapshot
  readonly effective_capabilities: readonly LinkPermissionCapability[]
  readonly effective_field_paths: readonly string[]
  readonly authorization_state: 'active' | 'revoked'
  readonly status: 'editing' | 'update_pending' | 'changes_requested' | 'approved' |
    'applying' | 'apply_failed' | 'rejected' | 'withdrawn' | 'applied'
  readonly review_work_item_id: string | null
  readonly apply_attempt_count: number
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface CreateProjectUpdateCommand {
  readonly userId: string
  readonly projectId: string
  readonly updateType: string
  readonly baseVersionId: string
  readonly clientRequestId: string
}

export interface GetProjectUpdateCommand {
  readonly userId: string
  readonly updateId: string
}

export interface PatchProjectUpdateCommand {
  readonly userId: string
  readonly updateId: string
  readonly expectedVersion: number
  readonly diff: readonly ProjectUpdateDiffInput[]
  readonly evidenceDraftIds: readonly string[]
  readonly mediaReferenceIds: readonly string[]
  readonly operationId: string
}

export interface PreviewProjectUpdateCommand {
  readonly userId: string
  readonly updateId: string
  readonly expectedVersion: number
}

export interface ProjectUpdatePreviewProjection {
  readonly update_id: string
  readonly version: number
  readonly preview_hash: string
  readonly base_version_id: string
  readonly current_version_id: string
  readonly before_after: readonly ProjectUpdateBeforeAfter[]
  readonly authorization_snapshot: ProjectUpdateAuthorizationSnapshot
  readonly validation: Readonly<{
    readonly ready_for_submit: true
    readonly changed_field_count: number
    readonly evidence_draft_count: number
    readonly media_reference_count: number
  }>
}
