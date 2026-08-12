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
