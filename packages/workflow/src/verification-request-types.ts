export const creatorResolutionModes = [
  'use_existing_link',
  'create_new_creator',
  'claim_existing_creator',
] as const

export type CreatorResolutionMode = (typeof creatorResolutionModes)[number]
export type RequestedLinkRole = 'owner' | 'manager'
export type VerificationRequestStatus =
  | 'draft' | 'pending' | 'changes_requested' | 'verified' | 'failed' | 'withdrawn'

export interface NewCreatorProfileInput {
  readonly display_name: string
  readonly bio?: string
}

export interface PermissionProfileExactRef {
  readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
  readonly profile_version: 1
  readonly config_hash: string
}

export interface ProvisionalLinkPolicy {
  readonly policy_version: 'creator_link.v1'
  readonly target_creator_aggregate_version: number | null
  readonly owner_link_set_version: number | null
  readonly allowed_link_roles: readonly RequestedLinkRole[]
  readonly default_link_role: RequestedLinkRole
  readonly allowed_permission_profile_refs: readonly PermissionProfileExactRef[]
}

export interface LinkPolicySnapshot extends ProvisionalLinkPolicy {
  readonly observed_owner_link_id: string | null
  readonly observed_owner_link_version: number | null
  readonly reused_link_id: string | null
  readonly reused_link_version: number | null
}

export interface VerificationApplicantMaterialSummary {
  readonly material_id: string
  readonly verification_id: string
  readonly applicant_scan_state: 'pending' | 'accepted' | 'rejected'
  readonly reason_key: 'upload_expired' | 'file_rejected' | 'processing_unavailable' | null
  readonly next_action: 'complete_upload' | 'wait' | 'continue_submission' | 'upload_new_material' | 'none'
  readonly upload_expires_at: string | null
  readonly version: number
}

export interface VerificationPublicReviewMessage {
  readonly message_key: 'verification_changes_requested' | 'verification_rejected'
  readonly field_paths: readonly string[]
  readonly created_at: string
}

export interface VerificationRequestProjection {
  readonly verification_id: string
  readonly project_id: string
  readonly creator_resolution_mode: CreatorResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input: NewCreatorProfileInput | null
  readonly requested_link_role: RequestedLinkRole | null
  readonly provisional_link_policy: ProvisionalLinkPolicy | null
  readonly link_policy_snapshot: LinkPolicySnapshot | null
  readonly method: string | null
  readonly public_summary: string | null
  readonly material_summaries: readonly VerificationApplicantMaterialSummary[]
  readonly status: VerificationRequestStatus
  readonly status_history: readonly Readonly<{ readonly status: VerificationRequestStatus; readonly at: string }>[]
  readonly latest_public_review_message: VerificationPublicReviewMessage | null
  readonly supersedes_verification_id: string | null
  readonly resulting_creator_id: string | null
  readonly resulting_link_id: string | null
  readonly resulting_author_relation_id: string | null
  readonly resulting_profile_version_id: string | null
  readonly approved_link_role: RequestedLinkRole | null
  readonly approved_permission_profile_ref: PermissionProfileExactRef | null
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface CreateVerificationRequestCommand {
  readonly userId: string
  readonly projectId: string
  readonly supersedesVerificationId: string | null
  readonly creatorResolutionMode: string
  readonly creatorAccountLinkId: string | null
  readonly targetCreatorId: string | null
  readonly newCreatorProfileInput: unknown
  readonly requestedLinkRole: string | null
  readonly idempotencyKey: string
}

export interface GetVerificationRequestCommand {
  readonly userId: string
  readonly verificationId: string
}

export interface PatchVerificationRequestCommand {
  readonly userId: string
  readonly verificationId: string
  readonly expectedVersion: number
  readonly creatorResolutionMode: string
  readonly creatorAccountLinkId: string | null
  readonly targetCreatorId: string | null
  readonly newCreatorProfileInput: unknown
  readonly requestedLinkRole: string | null
  readonly method: string | null
  readonly publicSummary: string | null
  readonly operationId: string
}

export interface SubmitVerificationRequestCommand {
  readonly userId: string
  readonly verificationId: string
  readonly expectedVersion: number
  readonly materialIds: readonly string[]
  readonly submissionKey: string
  readonly requestId?: string
}

export interface SupplementVerificationRequestCommand {
  readonly userId: string
  readonly verificationId: string
  readonly expectedVersion: number
  readonly materialIds: readonly string[]
  readonly evidenceRefs: readonly string[]
  readonly operationId: string
  readonly requestId?: string
}

export interface WithdrawVerificationRequestCommand {
  readonly userId: string
  readonly verificationId: string
  readonly expectedVersion: number
  readonly operationId: string
  readonly reasonCode: string | null
  readonly requestId?: string
}

export interface ReviewVerificationRequestCommand {
  readonly reviewerUserId: string
  readonly roles: readonly string[]
  readonly permissions: readonly string[]
  readonly sessionToken: string
  readonly verificationId: string
  readonly claimToken: string
}

export interface VerificationRequestReviewerProjection {
  readonly viewer_schema: 'reviewer'
  readonly verification_id: string
  readonly project_id: string
  readonly creator_resolution_mode: CreatorResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input: NewCreatorProfileInput | null
  readonly requested_link_role: RequestedLinkRole | null
  readonly link_policy_snapshot: LinkPolicySnapshot
  readonly method: string
  readonly public_summary: string
  readonly material_ids: readonly string[]
  readonly evidence_refs: readonly string[]
  readonly submission_revision: number
  readonly status: 'pending'
  readonly review_work_item_id: string
  readonly version: number
}
