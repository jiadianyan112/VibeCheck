import type { ReviewActor } from './types.js'

export const submissionReviewDecisions = Object.freeze([
  'approve',
  'changes_requested',
  'reject',
] as const)
export type SubmissionReviewDecision = typeof submissionReviewDecisions[number]

export interface ReviewDecisionProjection {
  readonly review_decision_id: string
  readonly work_item_id: string
  readonly work_type: 'submission'
  readonly target_type: 'submission'
  readonly target_id: string
  readonly decision: SubmissionReviewDecision
  readonly project_id: null
  readonly base_version_id: null
  readonly resulting_status: 'approved' | 'changes_requested' | 'rejected'
  readonly work_item_status: 'decided'
  readonly work_item_decision_ref_type: 'review_decision'
  readonly transaction_id: string
  readonly committed_at: string
  readonly schema_version: 'review_decision.v1'
  readonly domain_status: 'approved' | 'changes_requested' | 'rejected'
  readonly outbox_status: 'pending'
}

export interface DecideSubmissionReviewCommand {
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
  readonly decisionPayload: Readonly<Record<string, unknown>>
  readonly requestId: string
}

export interface StoredSubmissionReviewDecisionInput {
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
  readonly decisionPayload: Readonly<Record<string, unknown>>
  readonly decisionPayloadHash: string
  readonly now: Date
  readonly requestId: string
}
