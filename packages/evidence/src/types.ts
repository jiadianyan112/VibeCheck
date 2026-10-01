export const evidenceParentTypes = [
  'submission_draft',
  'admin_project_creation_draft',
  'admin_project_edit_draft',
  'project_update',
  'relation_candidate',
] as const
export const evidenceFinalTargetKinds = ['project', 'version', 'event', 'asset', 'relation'] as const
export const evidenceTypes = [
  'platform_verified_fact',
  'verified_author_statement',
  'trusted_external_source',
  'system_inference',
] as const
export const evidenceSourceChannels = [
  'official_site',
  'repository',
  'release_note',
  'media_report',
  'author_statement',
  'platform_check',
] as const
export const evidenceVisibilities = ['public', 'reviewer_only', 'private'] as const

export type EvidenceParentType = (typeof evidenceParentTypes)[number]
export type EvidenceFinalTargetKind = (typeof evidenceFinalTargetKinds)[number]
export type EvidenceType = (typeof evidenceTypes)[number]
export type EvidenceSourceChannel = (typeof evidenceSourceChannels)[number]
export type EvidenceVisibility = (typeof evidenceVisibilities)[number]
export type EvidenceCollectorActorType = 'system' | 'platform_editor' | 'verified_author' | 'user'
export type EvidenceDraftStatus = 'editing' | 'ready' | 'withdrawn' | 'promoted' | 'expired'
export type EvidenceAttachmentRole = 'supporting_document' | 'supporting_image'
export type EvidenceAttachmentDraftStatus = 'active' | 'withdrawn' | 'promoted' | 'expired'

export interface EvidenceActor {
  readonly userId: string
  readonly roles: readonly ('user' | 'verified_author' | 'editor' | 'admin')[]
}

export interface EvidenceFinalFieldPreview {
  readonly source_summary: string
  readonly captured_at: string
  readonly collected_by: EvidenceCollectorActorType
  readonly confidence: 'high' | 'medium' | 'low'
  readonly source_channel: EvidenceSourceChannel
}

export interface EvidenceAttachmentDraftProjection {
  readonly attachment_draft_id: string
  readonly evidence_draft_id: string
  readonly media_resource_id: string
  readonly role: EvidenceAttachmentRole
  readonly requested_visibility: EvidenceVisibility
  readonly status: EvidenceAttachmentDraftStatus
  readonly version: number
  readonly evidence_draft_version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface EvidenceDraftProjection {
  readonly evidence_draft_id: string
  readonly collector_actor_type: EvidenceCollectorActorType
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly final_target_kind: EvidenceFinalTargetKind
  readonly target_asset_draft_key: string | null
  readonly evidence_type: EvidenceType
  readonly source_channel: EvidenceSourceChannel
  readonly field_path: string | null
  readonly requested_visibility: EvidenceVisibility
  readonly source_url: string | null
  readonly text_excerpt: string | null
  readonly attachment_drafts: readonly EvidenceAttachmentDraftProjection[]
  readonly status: EvidenceDraftStatus
  readonly bound: boolean
  readonly source_hash: string
  readonly final_field_preview: EvidenceFinalFieldPreview | null
  readonly completed_at: string | null
  readonly promoted_evidence_id: string | null
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface EvidenceBindingProjection {
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly evidence_draft_ids: readonly string[]
  readonly parent_version: number
  readonly evidence_draft_version: number
}

export interface CreateEvidenceDraftCommand {
  readonly actor: EvidenceActor
  readonly parentType: string
  readonly parentId: string
  readonly finalTargetKind: string
  readonly targetAssetDraftKey: string | null
  readonly fieldPath: string | null
  readonly requestedVisibility: string
  readonly evidenceType: string
  readonly sourceChannel: string
  readonly clientRequestId: string
  readonly requestId: string
}

export interface GetEvidenceDraftCommand {
  readonly actor: EvidenceActor
  readonly evidenceDraftId: string
  readonly requestId: string
}

export interface EvidenceDraftPatch {
  readonly sourceUrl?: string | null
  readonly internalRecordRef?: string | null
  readonly textExcerpt?: string | null
  readonly fieldPath?: string | null
  readonly requestedVisibility?: string
}

export interface PatchEvidenceDraftCommand {
  readonly actor: EvidenceActor
  readonly evidenceDraftId: string
  readonly expectedVersion: number
  readonly patch: EvidenceDraftPatch
  readonly operationId: string
  readonly requestId: string
}

export interface BindEvidenceDraftCommand {
  readonly actor: EvidenceActor
  readonly evidenceDraftId: string
  readonly parentType: string
  readonly parentId: string
  readonly expectedParentVersion: number
  readonly operationId: string
  readonly requestId: string
}

export interface CompleteEvidenceDraftCommand {
  readonly actor: EvidenceActor
  readonly evidenceDraftId: string
  readonly expectedVersion: number
  readonly operationId: string
  readonly requestId: string
}

export interface CreateEvidenceAttachmentCommand {
  readonly actor: EvidenceActor
  readonly evidenceDraftId: string
  readonly mediaResourceId: string
  readonly role: string
  readonly requestedVisibility: string
  readonly expectedDraftVersion: number
  readonly clientRequestId: string
  readonly requestId: string
}

export interface DeleteEvidenceAttachmentCommand {
  readonly actor: EvidenceActor
  readonly attachmentDraftId: string
  readonly expectedVersion: number
  readonly operationId: string
  readonly requestId: string
}

export interface WithdrawEvidenceDraftCommand {
  readonly actor: EvidenceActor
  readonly evidenceDraftId: string
  readonly expectedVersion: number
  readonly reasonCode: string
  readonly operationId: string
  readonly requestId: string
}
