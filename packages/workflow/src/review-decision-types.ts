import type { ReviewActor } from './types.js'

export const submissionReviewDecisions = Object.freeze([
  'approve',
  'changes_requested',
  'reject',
] as const)
export type SubmissionReviewDecision = typeof submissionReviewDecisions[number]

export type ReviewDecisionWorkType = 'submission' | 'project_update' | 'verification'
export type ReviewDecisionTargetType = 'submission' | 'project_update' | 'verification_request'

export interface VerificationApprovePayload {
  readonly author_role: 'owner' | 'co_creator' | 'maintainer'
  readonly field_permissions: readonly string[]
  readonly policy_version: 'creator_link.v1'
  readonly expected_creator_aggregate_version: number | null
  readonly expected_owner_link_set_version: number | null
  readonly expected_reused_link_version: number | null
  readonly approved_link_role?: 'owner' | 'manager'
  readonly approved_permission_profile_ref?: Readonly<{
    readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
    readonly profile_version: 1
    readonly config_hash: string
  }>
}

export interface ReviewDecisionProjection {
  readonly review_decision_id: string
  readonly work_item_id: string
  readonly work_type: ReviewDecisionWorkType
  readonly target_type: ReviewDecisionTargetType
  readonly target_id: string
  readonly decision: SubmissionReviewDecision
  readonly project_id: string | null
  readonly base_version_id: string | null
  readonly resulting_status: 'approved' | 'changes_requested' | 'rejected' | 'verified' | 'failed'
  readonly work_item_status: 'decided'
  readonly work_item_decision_ref_type: 'review_decision'
  readonly transaction_id: string
  readonly committed_at: string
  readonly schema_version: 'review_decision.v1'
  readonly domain_status: 'approved' | 'changes_requested' | 'rejected' | 'verified' | 'failed'
  readonly outbox_status: 'pending'
  readonly resulting_creator_id: string | null
  readonly resulting_link_id: string | null
  readonly resulting_author_relation_id: string | null
  readonly resulting_profile_version_id: string | null
  readonly approved_link_role: 'owner' | 'manager' | null
  readonly approved_permission_profile_ref: Readonly<{
    readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
    readonly profile_version: 1
    readonly config_hash: string
  }> | null
  readonly effective_capabilities: readonly string[]
  readonly effective_field_permissions: readonly string[]
  readonly creator_aggregate_version: number | null
  readonly owner_link_set_version: number | null
}

export interface DecideReviewCommand {
  readonly actor: ReviewActor
  readonly sessionToken: string
  readonly workItemId: string
  readonly previewToken: string
  readonly claimToken: string
  readonly confirmToken: string
  readonly decision: string
  readonly reasonCode: string
  readonly fieldPaths: readonly string[]
  readonly decisionEvidenceRefs: readonly string[]
  readonly expectedVersion: number
  readonly decisionRequestId: string
  readonly decisionPayload: Readonly<Record<string, unknown>> | VerificationApprovePayload
  readonly requestId: string
}

export type DecideSubmissionReviewCommand = DecideReviewCommand

export interface StoredReviewDecisionInput {
  readonly actor: ReviewActor
  readonly primarySessionIdHash: Buffer
  readonly workItemId: string
  readonly previewTokenHash: Buffer
  readonly claimTokenHash: Buffer
  readonly confirmTokenHash: Buffer
  readonly decision: SubmissionReviewDecision
  readonly resultingStatus: 'approved' | 'changes_requested' | 'rejected'
  readonly reasonCode: string
  readonly fieldPaths: readonly string[]
  readonly decisionEvidenceRefs: readonly string[]
  readonly expectedVersion: number
  readonly decisionRequestId: string
  readonly decisionPayload: Readonly<Record<string, unknown>> | VerificationApprovePayload
  readonly decisionPayloadHash: string
  readonly now: Date
  readonly requestId: string
}

export type StoredSubmissionReviewDecisionInput = StoredReviewDecisionInput
