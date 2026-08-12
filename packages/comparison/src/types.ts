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
