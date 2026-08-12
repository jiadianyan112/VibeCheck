import type { CategoryId, ProjectAccessStatus } from '@vibecheck/catalog'

export const searchModes = ['search', 'discover'] as const
export type SearchMode = (typeof searchModes)[number]
export const searchSorts = ['relevance'] as const
export type SearchSort = (typeof searchSorts)[number]

export interface SearchSubject {
  readonly kind: 'anonymous' | 'user'
  readonly id: string
}

export interface SearchFilters {
  readonly access_status: readonly ProjectAccessStatus[]
  readonly has_available_asset: boolean | null
  readonly verified_since: string | null
  readonly category_fields: Readonly<Record<string, readonly string[]>>
  readonly exclude_category_fields: Readonly<Record<string, readonly string[]>>
}

export interface SearchCommand {
  readonly query: string | null
  readonly queryId: string | null
  readonly mode: SearchMode
  readonly categoryId: CategoryId | null
  readonly filters: unknown
  readonly sort: SearchSort
  readonly cursor: string | null
  readonly locale: string
  readonly rateLimitKey: string
}

export interface SearchMatchReason {
  readonly matched_fields: readonly string[]
  readonly unmatched_soft_fields: readonly string[]
  readonly relaxed_fields: readonly string[]
  readonly evidence_freshness: 'valid' | 'expiring' | 'expired'
  readonly reason_template_key: 'search.match.exact' | 'search.match.adjacent'
}

export interface SearchResultItem {
  readonly project_id: string
  readonly category_id: CategoryId
  readonly result_item_id: string
  readonly position: number
  readonly result_item_token: string
  readonly match_reason: SearchMatchReason
}

export interface SearchResultGroup {
  readonly group_id: 'exact' | 'adjacent'
  readonly channel: 'search_exact' | 'search_adjacent'
  readonly default_collapsed: boolean
  readonly items: readonly SearchResultItem[]
}

export interface SearchProjection {
  readonly query_id: string
  readonly intent_version: number
  readonly parser_version: 'keyword.v1'
  readonly result_version: string
  readonly ranking_version: 'search.keyword.v1'
  readonly mode: 'search'
  readonly category_id: CategoryId | null
  readonly filters: SearchFilters
  readonly sort: SearchSort
  readonly semantic_degraded: true
  readonly exact_count: number
  readonly adjacent_count: number
  readonly groups: readonly SearchResultGroup[]
  readonly next_cursor: string | null
  readonly expires_at: string
}

export interface QuerySnapshotProjection {
  readonly query_id: string
  readonly mode: SearchMode
  readonly category_id: CategoryId | null
  readonly intent: Readonly<Record<string, unknown>>
  readonly confidence: Readonly<Record<string, unknown>>
  readonly intent_version: number
  readonly parser_version: string
  readonly result_version: string
  readonly ranking_version: string
  readonly filters: SearchFilters
  readonly sort: SearchSort
  readonly semantic_degraded: boolean
  readonly exact_count: number
  readonly adjacent_count: number
  readonly version: number
  readonly expires_at: string
  readonly input_state: 'not_restored'
  readonly notice_key: 'search.conditions_restored'
}

export interface QueryLinkCommand {
  readonly identityLinkId: string
  readonly expectedVersion: number
  readonly operationId: string
}

export interface QueryMutationCommand {
  readonly expectedVersion: number
  readonly operationId: string
}

export interface QueryInvalidationCommand {
  readonly operationId: string
}

export interface QueryLinkProjection {
  readonly authorized: true
  readonly version: number
  readonly expires_at: string
}

export interface SearchServiceConfig {
  readonly encryptionMasterKey: string
  readonly encryptionKeyVersion: string
  readonly subjectHashPepper: string
  readonly resultTokenSecret: string
  readonly snapshotTtlSeconds: number
  readonly pageSize: number
  readonly maximumStoredResults: number
  readonly rawQueryLimit: number
  readonly rawQueryRateWindowSeconds: number
}
