import type { ReviewActor } from './types.js'

export interface AdminOperationTarget {
  readonly target_type: string
  readonly target_id: string
}

export interface AdminOperationImpact {
  readonly target_count: number
  readonly expected_version_count: number
  readonly changed_top_level_fields: readonly string[]
}

export interface AdminOperationPreviewProjection {
  readonly preview_token: string
  readonly operation_type: string
  readonly targets: readonly AdminOperationTarget[]
  readonly expected_versions: Readonly<Record<string, number>>
  readonly diff: Readonly<Record<string, unknown>>
  readonly impact: AdminOperationImpact
  readonly confirmation_summary_hash: string
  readonly expires_at: string
  readonly conflict_principal_version: number | null
}

export interface AdminOperationConfirmProjection {
  readonly confirm_token: string
  readonly expires_at: string
  readonly binding_summary: Readonly<{
    operation_type: string
    target_count: number
    confirmation_summary_hash: string
  }>
  readonly assurance_source: 'recent_session' | 'step_up_grant'
  readonly conflict_principal_version: number | null
  readonly replayed: boolean
}

export interface PreviewAdminOperationCommand {
  readonly actor: ReviewActor
  readonly sessionToken: string
  readonly operationType: string
  readonly targets: readonly AdminOperationTarget[]
  readonly expectedVersions: Readonly<Record<string, number>>
  readonly proposedDiff: Readonly<Record<string, unknown>>
  readonly reasonCode: string
  readonly claimToken: string | null
  readonly expectedConflictPrincipalVersion: number | null
  readonly requestId: string
}

export interface ConfirmAdminOperationCommand {
  readonly actor: ReviewActor
  readonly sessionToken: string
  readonly previewToken: string
  readonly confirmationSummaryHash: string
  readonly confirmRequestId: string
  readonly reauthGrantId: string | null
  readonly expectedConflictPrincipalVersion: number | null
  readonly requestId: string
}

export interface StoredAdminOperationPreview {
  readonly previewId: string
  readonly operationType: string
  readonly targetCount: number
  readonly confirmationSummaryHash: string
  readonly expectedConflictPrincipalVersion: number | null
  readonly expiresAt: Date
}

export type ConfirmAdminOperationStoreResult =
  | {
      readonly kind: 'issued' | 'replayed'
      readonly confirmGrantId: string
      readonly preview: StoredAdminOperationPreview
      readonly assuranceSource: 'recent_session' | 'step_up_grant'
      readonly expiresAt: Date
    }
  | {
      readonly kind: 'reauth_required'
      readonly preview: StoredAdminOperationPreview
    }
  | {
      readonly kind: 'error'
      readonly code: string
      readonly httpStatus: number
    }
