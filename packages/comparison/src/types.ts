import type { CategoryId } from '@vibecheck/catalog'

export interface ComparisonSubject {
  readonly kind: 'anonymous' | 'user'
  readonly id: string
}

export interface ComparisonProjectSummary {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly access_status: string
  readonly freshness_status: string
  readonly last_verified_at: string
  readonly current_version_id: string
  readonly comparison_values: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export interface ComparisonItemProjection {
  readonly project_id: string
  readonly position: number
  readonly validity_status: 'valid' | 'invalid'
  readonly invalid_reason: string | null
  readonly canonical_project_id: string | null
  readonly project: ComparisonProjectSummary | null
}

export interface ComparisonProjection {
  readonly comparison_id: string
  readonly comparison_version: number
  readonly category_id: CategoryId
  readonly category_schema_version: string
  readonly ordered_project_ids: readonly string[]
  readonly items: readonly ComparisonItemProjection[]
  readonly valid_count: number
  readonly invalid_count: number
  readonly dimension_groups: readonly string[]
  readonly dimension_groups_viewed: readonly string[]
  readonly visible_duration_ms: number
  readonly saved_at: string | null
  readonly completed_at: string | null
  readonly expires_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface ComparisonMutationProjection extends ComparisonProjection {
  readonly mutation_result: 'created' | 'changed' | 'no_change'
}

export interface PutComparisonCommand {
  readonly comparisonId: string
  readonly orderedProjectIds: readonly string[]
  readonly expectedVersion: number
  readonly clientRequestId: string
  readonly subject: ComparisonSubject
}

export interface SetComparisonSavedCommand {
  readonly comparisonId: string
  readonly comparisonVersion: number
  readonly state: boolean
  readonly subject: ComparisonSubject
  readonly requestId: string
}

export interface RecordComparisonDimensionCommand {
  readonly eventId: string
  readonly comparisonId: string
  readonly comparisonVersion: number
  readonly dimensionGroup: string
  readonly visibleMs: number
  readonly viewSequence: number
  readonly occurredAt: string
  readonly subject: ComparisonSubject
}

export interface ComparisonProgressProjection {
  readonly comparison_id: string
  readonly comparison_version: number
  readonly dimension_groups_viewed: readonly string[]
  readonly visible_duration_ms: number
  readonly completed_at: string | null
  readonly completed_now: boolean
  readonly deduplicated: boolean
}

export type ComparisonLoginMergeResult =
  | 'not_required'
  | 'adopted'
  | 'merged'
  | 'conflict'

export interface ComparisonLoginMergeProjection {
  readonly result: ComparisonLoginMergeResult
  readonly comparison_id: string | null
  readonly comparison_version: number | null
  readonly conflict_id: string | null
  readonly conflict_version: number | null
  readonly expires_at: string | null
}

export interface PrepareComparisonLoginMergeCommand {
  readonly userId: string
  readonly anonymousSubjectId: string
  readonly identityLinkId: string
  readonly operationId: string
  readonly pendingActionId: string | null
}

export interface ComparisonMergeProjectSummary {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly access_status: string
  readonly freshness_status: string
  readonly last_verified_at: string
}

export interface ComparisonMergeConflictProjection {
  readonly conflict_id: string
  readonly identity_link_id: string
  readonly account_comparison_id: string
  readonly account_comparison_version: number
  readonly anonymous_comparison_id: string
  readonly anonymous_comparison_version: number
  readonly candidate_project_ids: readonly string[]
  readonly candidate_projects: readonly ComparisonMergeProjectSummary[]
  readonly selected_project_ids: readonly string[] | null
  readonly status: 'pending' | 'resolved' | 'cancelled'
  readonly pending_action_id: string | null
  readonly version: number
  readonly expires_at: string
  readonly resolved_at: string | null
  readonly cancelled_at: string | null
}

export interface GetComparisonMergeConflictCommand {
  readonly conflictId: string
  readonly subject: ComparisonSubject
}

export interface ResolveComparisonMergeConflictCommand {
  readonly conflictId: string
  readonly selectedProjectIds: readonly string[]
  readonly accountVersion: number
  readonly anonymousVersion: number
  readonly expectedConflictVersion: number
  readonly operationId: string
  readonly subject: ComparisonSubject
}

export interface ComparisonMergeResolutionProjection {
  readonly conflict_id: string
  readonly status: 'resolved'
  readonly conflict_version: number
  readonly comparison_id: string
  readonly comparison_version: number
  readonly selected_project_ids: readonly string[]
  readonly resolved_at: string
}

export interface CancelComparisonMergeConflictCommand {
  readonly conflictId: string
  readonly cancelReason: string
  readonly expectedConflictVersion: number
  readonly operationId: string
  readonly subject: ComparisonSubject
}

export interface ComparisonMergeCancellationProjection {
  readonly conflict_id: string
  readonly status: 'cancelled'
  readonly conflict_version: number
  readonly cancelled_at: string
  readonly pending_action_status: 'cancelled' | null
}
