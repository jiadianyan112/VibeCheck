export const submissionCategoryIds = [
  'ai_learning_quiz',
  'personal_site_portfolio',
] as const

export type SubmissionCategoryId = (typeof submissionCategoryIds)[number]
export type SubmissionSchemaVersion = 'learning.v1' | 'portfolio.v1'
export type UrlCheckRiskResult = 'allowed' | 'blocked' | 'uncertain'
export type UrlCheckAccessResult = 'accessible' | 'unavailable' | 'uncertain' | 'not_checked'
export type UrlCheckDuplicateResult = 'none' | 'exact' | 'candidate'
export type SubmissionDraftStatus = 'editing' | 'submitted' | 'closed' | 'expired'
export type SubmissionReviewStatus = 'pending_review' | 'changes_requested' | 'rejected' | 'withdrawn' | 'approved' | 'publishing' | 'publish_failed' | 'published'

export interface SubmissionDuplicateCandidate {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: SubmissionCategoryId
  readonly reason: 'canonical_url_exact'
}

export interface SubmissionUrlCheckProjection {
  readonly check_id: string
  readonly category_id: SubmissionCategoryId
  readonly category_schema_version: SubmissionSchemaVersion
  readonly input_hash: string
  readonly canonical_url: string | null
  readonly redirect_chain: readonly string[]
  readonly risk_result: UrlCheckRiskResult
  readonly access_result: UrlCheckAccessResult
  readonly category_result: 'matched' | 'mismatched' | 'unconfirmed'
  readonly duplicate_result: UrlCheckDuplicateResult
  readonly duplicate_candidates: readonly SubmissionDuplicateCandidate[]
  readonly risk_reasons: readonly string[]
  readonly can_create_draft: boolean
  readonly checked_at: string
  readonly expires_at: string
}

export interface SubmissionDraftProjection {
  readonly draft_id: string
  readonly submission_chain_id: string
  readonly category_id: SubmissionCategoryId
  readonly category_schema_version: SubmissionSchemaVersion
  readonly check_id: string
  readonly draft_revision: number
  readonly supersedes_draft_id: string | null
  readonly base_submission_id: string | null
  readonly payload_snapshot: Readonly<Record<string, unknown>>
  readonly media_reference_ids: readonly string[]
  readonly evidence_draft_ids: readonly string[]
  readonly asset_drafts: readonly Readonly<Record<string, unknown>>[]
  readonly status: SubmissionDraftStatus
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
  readonly saved_at: string
  readonly expires_at: string
}

export interface CheckSubmissionUrlCommand {
  readonly userId: string
  readonly rawUrl: string
  readonly categoryHint: string
  readonly clientRequestId: string
  readonly requestId: string
}

export interface CreateSubmissionDraftCommand {
  readonly userId: string
  readonly checkId: string
  readonly categoryId: string
  readonly clientRequestId: string
  readonly requestId: string
}

export interface GetSubmissionDraftCommand {
  readonly userId: string
  readonly draftId: string
  readonly requestId: string
}

export interface PatchSubmissionDraftCommand {
  readonly userId: string
  readonly draftId: string
  readonly expectedVersion: number
  readonly patch: Readonly<Record<string, unknown>>
  readonly operationId: string
  readonly requestId: string
}

export interface PreviewSubmissionDraftCommand {
  readonly userId: string
  readonly draftId: string
  readonly expectedVersion: number
  readonly checkId: string
  readonly requestId: string
}

export interface SubmitSubmissionDraftCommand {
  readonly userId: string
  readonly draftId: string
  readonly draftVersion: number
  readonly checkId: string
  readonly previewHash: string
  readonly submissionKey: string
  readonly requestId: string
}

export interface WithdrawSubmissionCommand {
  readonly userId: string
  readonly submissionId: string
  readonly expectedVersion: number
  readonly operationId: string
  readonly reasonCode: string | null
  readonly requestId: string
}

export interface SubmissionPreviewProjection {
  readonly draft_id: string
  readonly draft_version: number
  readonly check_id: string
  readonly preview_hash: string
  readonly payload_snapshot: Readonly<Record<string, unknown>>
  readonly media_reference_ids: readonly string[]
  readonly evidence_draft_ids: readonly string[]
  readonly validation: Readonly<{
    readonly valid: true
    readonly issue_count: 0
  }>
  readonly generated_at: string
}

export interface SubmissionProjection {
  readonly submission_id: string
  readonly submission_chain_id: string
  readonly draft_id: string
  readonly snapshot_version: number
  readonly review_status: SubmissionReviewStatus
  readonly review_work_item_id: string
  readonly media_reference_ids: readonly string[]
  readonly evidence_draft_ids: readonly string[]
  readonly preview_hash: string
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface SubmissionWithdrawalProjection {
  readonly submission_id: string
  readonly review_status: 'withdrawn'
  readonly submission_version: number
  readonly review_work_item_id: string
  readonly work_item_status: 'cancelled'
  readonly work_item_version: number
  readonly withdrawn_at: string
}
