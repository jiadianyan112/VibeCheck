export const reviewWorkTypes = Object.freeze([
  'submission',
  'project_update',
  'verification',
  'ownership_case',
  'evidence',
  'recheck',
  'relation',
  'community',
  'creator_profile',
] as const)
export type ReviewWorkType = typeof reviewWorkTypes[number]

export const reviewTargetTypes = Object.freeze([
  'submission',
  'project_update',
  'verification_request',
  'ownership_case',
  'evidence',
  'recheck_task',
  'relation_candidate',
  'comment',
  'report',
  'creator_profile_draft',
] as const)
export type ReviewTargetType = typeof reviewTargetTypes[number]

export const reviewWorkItemStatuses = Object.freeze([
  'queued',
  'claimed',
  'decided',
  'cancelled',
] as const)
export type ReviewWorkItemStatus = typeof reviewWorkItemStatuses[number]

export type ReviewRole = 'user' | 'verified_author' | 'editor' | 'admin'
export type ReviewPermission =
  | 'admin:review'
  | 'admin:identity_review'
  | 'admin:system_config'
  | string

export interface ReviewActor {
  readonly userId: string
  readonly roles: readonly ReviewRole[]
  readonly permissions: readonly ReviewPermission[]
}

export interface ReviewDomainSummary {
  readonly status: string
}

export interface ReviewWorkItemProjection {
  readonly work_item_id: string
  readonly work_type: ReviewWorkType
  readonly target_type: ReviewTargetType
  readonly target_id: string
  readonly work_item_status: ReviewWorkItemStatus
  readonly version: number
  readonly assignee_user_id: string | null
  readonly lease_expires_at: string | null
  readonly domain_summary: ReviewDomainSummary
  readonly created_at: string
  readonly updated_at: string
}

export interface ReviewWorkItemPage {
  readonly items: readonly ReviewWorkItemProjection[]
  readonly total_count: number
  readonly next_cursor: string | null
}

export interface ReviewClaimProjection extends ReviewWorkItemProjection {
  readonly claim_token: string
}

export interface ListReviewWorkItemsCommand {
  readonly actor: ReviewActor
  readonly workType: string
  readonly targetType: string | null
  readonly status: string | null
  readonly cursor: string | null
  readonly requestId: string
}

export interface ClaimReviewWorkItemCommand {
  readonly actor: ReviewActor
  readonly workItemId: string
  readonly expectedVersion: number
  readonly expectedConflictPrincipalVersion: number | null
  readonly requestId: string
}

export interface HeartbeatReviewWorkItemCommand {
  readonly actor: ReviewActor
  readonly workItemId: string
  readonly claimToken: string
  readonly requestId: string
}

export interface ReleaseReviewWorkItemCommand {
  readonly actor: ReviewActor
  readonly workItemId: string
  readonly claimToken: string
  readonly reasonCode: string
  readonly requestId: string
}
