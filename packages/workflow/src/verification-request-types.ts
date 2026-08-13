export const creatorResolutionModes = [
  'use_existing_link',
  'create_new_creator',
  'claim_existing_creator',
] as const

export type CreatorResolutionMode = (typeof creatorResolutionModes)[number]
export type RequestedLinkRole = 'owner' | 'manager'

export interface NewCreatorProfileInput {
  readonly display_name: string
  readonly bio?: string
}

export interface ProvisionalLinkPolicy {
  readonly policy_version: 'creator_link.v1'
  readonly target_creator_aggregate_version: number | null
  readonly owner_link_set_version: number | null
  readonly allowed_link_roles: readonly RequestedLinkRole[]
  readonly default_link_role: RequestedLinkRole
  readonly allowed_permission_profile_refs: readonly Readonly<{
    profile_id: 'OWNER_V1' | 'MANAGER_V1'
    profile_version: 1
    config_hash: string
  }>[]
}

export interface VerificationRequestProjection {
  readonly verification_id: string
  readonly project_id: string
  readonly creator_resolution_mode: CreatorResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input: NewCreatorProfileInput | null
  readonly requested_link_role: RequestedLinkRole | null
  readonly provisional_link_policy: ProvisionalLinkPolicy
  readonly link_policy_snapshot: null
  readonly method: string | null
  readonly public_summary: string | null
  readonly material_summaries: readonly never[]
  readonly status: 'draft' | 'changes_requested'
  readonly status_history: readonly Readonly<{ readonly status: string; readonly at: string }>[]
  readonly latest_public_review_message: null
  readonly supersedes_verification_id: string | null
  readonly resulting_creator_id: null
  readonly resulting_link_id: null
  readonly resulting_author_relation_id: null
  readonly resulting_profile_version_id: null
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
