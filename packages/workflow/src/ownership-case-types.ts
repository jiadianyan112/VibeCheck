import type { ReviewActor } from './types.js'

export const ownershipCaseStatuses = Object.freeze([
  'open','investigating','resolved_upheld','resolved_revoked','withdrawn',
] as const)
export type OwnershipCaseStatus = typeof ownershipCaseStatuses[number]

export const ownershipWithdrawalStatuses = Object.freeze([
  'requested','rejected','accepted','closed_by_case_decision',
] as const)
export type OwnershipWithdrawalStatus = typeof ownershipWithdrawalStatuses[number]

export type OwnershipPartyRole =
  | 'opened_by'
  | 'appealed_account'
  | 'relation_principal'
  | 'evidence_submitter'

export interface OwnershipPartyCaseProjection {
  readonly viewer_schema: 'party'
  readonly case_id: string
  readonly project_id: string
  readonly author_relation_id: string
  readonly status: OwnershipCaseStatus
  readonly reason_code: string
  readonly party_roles: readonly OwnershipPartyRole[]
  readonly my_evidence_submissions: readonly Readonly<{
    evidence_id: string
    submitted_at: string
  }>[]
  readonly my_withdrawal_requests: readonly Readonly<{
    withdrawal_request_id: string
    status: OwnershipWithdrawalStatus
    reason_code: string
    created_at: string
    decided_at?: string
    decision_reason_key?: string
  }>[]
  readonly decision_summary?: Readonly<{
    case_status: 'resolved_upheld' | 'resolved_revoked' | 'withdrawn'
    decision: 'uphold' | 'revoke' | 'withdraw'
    resulting_author_relation_status: 'active' | 'terminated'
    resulting_project_status: string
    reason_key?: string
    decided_at: string
  }>
  readonly allowed_actions: readonly ('add_evidence' | 'request_withdrawal')[]
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface OwnershipReviewerCaseProjection {
  readonly viewer_schema: 'reviewer'
  readonly case_id: string
  readonly project_id: string
  readonly author_relation_id: string
  readonly opened_by_user_id: string
  readonly appealed_user_id?: string
  readonly reason_code: string
  readonly status: OwnershipCaseStatus
  readonly evidence_submissions: readonly Readonly<{
    evidence_id: string
    submitted_by_user_id: string
    submitted_at: string
    summary: string
  }>[]
  readonly withdrawal_requests: readonly Readonly<{
    withdrawal_request_id: string
    requested_by_user_id: string
    status: OwnershipWithdrawalStatus
    reason_code: string
    evidence_ids: readonly string[]
    created_at: string
    decided_at?: string
    decision_reason_code?: string
  }>[]
  readonly review_work_item_summary: Readonly<{
    work_item_id: string
    status: 'queued' | 'claimed' | 'decided' | 'cancelled'
    assignee_user_id?: string
    lease_expires_at?: string
    version: number
  }>
  readonly conflict_principal_version: number
  readonly decision?: 'uphold' | 'revoke' | 'withdraw'
  readonly decided_by_user_id?: string
  readonly resulting_author_relation_status?: 'active' | 'terminated'
  readonly resulting_project_status?: string
  readonly allowed_actions: readonly ('preview' | 'request_more_evidence' | 'decide' | 'release')[]
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface CreateOwnershipCaseCommand {
  readonly actor: ReviewActor
  readonly authorRelationId: string
  readonly appealedUserId: string | null
  readonly reasonCode: string
  readonly evidenceIds: readonly string[]
  readonly clientRequestId: string
  readonly requestId: string
}

export interface GetOwnershipPartyCaseCommand {
  readonly userId: string
  readonly caseId: string
}

export interface GetOwnershipReviewerCaseCommand {
  readonly actor: ReviewActor
  readonly caseId: string
  readonly claimToken: string
}

export interface AddOwnershipEvidenceCommand {
  readonly actor: ReviewActor
  readonly caseId: string
  readonly expectedCaseVersion: number
  readonly evidenceIds: readonly string[]
  readonly reasonCode: string
  readonly clientRequestId: string
  readonly requestId: string
}

export interface RequestOwnershipWithdrawalCommand {
  readonly actor: ReviewActor
  readonly caseId: string
  readonly expectedVersion: number
  readonly reasonCode: string
  readonly evidenceIds: readonly string[]
  readonly supersedesRequestId: string | null
  readonly clientRequestId: string
  readonly requestId: string
}

export interface RejectOwnershipWithdrawalCommand {
  readonly actor: ReviewActor
  readonly caseId: string
  readonly withdrawalRequestId: string
  readonly claimToken: string
  readonly expectedCaseVersion: number
  readonly expectedRequestVersion: number
  readonly reasonCode: string
  readonly decisionId: string
  readonly requestId: string
}

export interface OwnershipMutationProjection {
  readonly case_id: string
  readonly status: OwnershipCaseStatus
  readonly review_work_item_id: string
  readonly work_item_status: 'queued' | 'claimed'
  readonly resulting_author_relation_status: 'suspended' | 'active' | 'terminated'
  readonly resulting_project_status: string
  readonly conflict_principal_version: number
  readonly version: number
  readonly withdrawal_request_id?: string
  readonly withdrawal_request_status?: OwnershipWithdrawalStatus
}
