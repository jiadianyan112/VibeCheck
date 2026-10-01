import { createHash, randomUUID } from 'node:crypto'

import type { CategoryId } from '@vibecheck/catalog'
import type { Pool, PoolClient } from 'pg'

import type { EncryptedQuery } from './crypto.js'
import { searchError } from './errors.js'
import type {
  SearchFilters,
  SearchMatchReason,
  SearchMode,
  SearchSort,
  SearchAttributionContext,
  SearchNavigationProjection,
} from './types.js'

export interface StoredQuerySnapshot {
  readonly query_id: string
  readonly owner_subject_kind: 'anonymous' | 'user'
  readonly owner_subject_hash: Buffer
  readonly encrypted_data_key: Buffer
  readonly data_key_iv: Buffer
  readonly data_key_auth_tag: Buffer
  readonly raw_query_ciphertext: Buffer
  readonly raw_query_iv: Buffer
  readonly raw_query_auth_tag: Buffer
  readonly encryption_key_version: string
  readonly mode: SearchMode
  readonly category_id: CategoryId | null
  readonly active_intent_version: number
  readonly status: 'active' | 'invalidated'
  readonly expires_at: Date
  readonly active_filter_snapshot: SearchFilters | null
}

export interface StoredResultItem {
  readonly project_id: string
  readonly category_id: CategoryId
  readonly result_item_id: string
  readonly group_id: 'exact' | 'adjacent'
  readonly group_position: number
  readonly global_position: number
  readonly channel: 'search_exact' | 'search_adjacent'
  readonly reason_json: SearchMatchReason
}

export interface StoredSearchExecution {
  readonly queryId: string
  readonly intentVersion: number
  readonly parserVersion: 'keyword.v1'
  readonly resultVersion: string
  readonly rankingVersion: 'search.keyword.v1'
  readonly categoryId: CategoryId | null
  readonly filters: SearchFilters
  readonly sort: SearchSort
  readonly semanticDegraded: true
  readonly exactCount: number
  readonly adjacentCount: number
  readonly expiresAt: Date
  readonly items: readonly StoredResultItem[]
  readonly nextOffset: number | null
}

interface CandidateRow {
  readonly project_id: string
  readonly category_id: CategoryId
  readonly group_id: 'exact' | 'adjacent'
  readonly matched_fields: string[]
  readonly freshness_status: 'valid' | 'expiring' | 'expired'
}

interface ResultVersionRow {
  readonly result_version: string
  readonly query_id: string
  readonly intent_version: number
  readonly ranking_version: 'search.keyword.v1'
  readonly parser_version: 'keyword.v1'
  readonly filter_snapshot_json: SearchFilters
  readonly sort: SearchSort
  readonly semantic_degraded: true
  readonly exact_count: number
  readonly adjacent_count: number
  readonly expires_at: Date
}

interface ResultItemRow extends StoredResultItem {
  readonly total_count: number
}

export interface CreateStoredSearchInput {
  readonly queryId: string
  readonly subjectKind: 'anonymous' | 'user'
  readonly subjectHash: Buffer
  readonly encryptedQuery: EncryptedQuery
  readonly encryptionKeyVersion: string
  readonly queryHash: Buffer
  readonly queryLengthBucket: string
  readonly rawQuery: string
  readonly mode: 'search'
  readonly categoryId: CategoryId | null
  readonly locale: string
  readonly expiresAt: Date
  readonly requestFingerprint: Buffer
  readonly filters: SearchFilters
  readonly sort: SearchSort
  readonly maximumStoredResults: number
  readonly pageSize: number
}

export interface ExistingStoredSearchInput {
  readonly snapshot: StoredQuerySnapshot
  readonly subjectHash: Buffer
  readonly rawQuery: string
  readonly categoryId: CategoryId | null
  readonly requestFingerprint: Buffer
  readonly filters: SearchFilters
  readonly sort: SearchSort
  readonly maximumStoredResults: number
  readonly pageSize: number
  readonly offset: number
  readonly expectedResultVersion: string | null
  readonly now: Date
}

export interface QueryAccessResult {
  readonly kind: 'missing' | 'forbidden' | 'gone' | 'active'
  readonly snapshot?: StoredQuerySnapshot
}

export interface StoredIdentityLink {
  readonly identityLinkId: string
  readonly anonymousSubjectId: string
  readonly userId: string
  readonly purpose: 'pending_action_replay' | 'query_continuation' | 'comparison_merge'
  readonly status: 'active' | 'consumed' | 'revoked' | 'expired'
  readonly expiresAt: Date
}

export interface StoredQueryProjection {
  readonly queryId: string
  readonly mode: SearchMode
  readonly categoryId: CategoryId | null
  readonly intent: Readonly<Record<string, unknown>>
  readonly confidence: Readonly<Record<string, unknown>>
  readonly intentVersion: number
  readonly parserVersion: string
  readonly resultVersion: string
  readonly rankingVersion: string
  readonly filters: SearchFilters
  readonly sort: SearchSort
  readonly semanticDegraded: boolean
  readonly exactCount: number
  readonly adjacentCount: number
  readonly version: number
  readonly expiresAt: Date
}

export interface QueryLinkStoreInput {
  readonly queryId: string
  readonly identityLinkId: string
  readonly anonymousSubjectId: string
  readonly anonymousSubjectHash: Buffer
  readonly userId: string
  readonly userSubjectHash: Buffer
  readonly expectedVersion: number
  readonly operationId: string
  readonly requestHash: Buffer
  readonly requestId: string
  readonly now: Date
}

export interface QueryMutationStoreInput {
  readonly queryId: string
  readonly subjectKind: 'anonymous' | 'user'
  readonly subjectHash: Buffer
  readonly expectedVersion: number
  readonly operationId: string
  readonly requestHash: Buffer
  readonly requestId: string
  readonly now: Date
}

export interface QueryInvalidationStoreInput {
  readonly queryId: string
  readonly subjectKind: 'anonymous' | 'user'
  readonly subjectHash: Buffer
  readonly operationId: string
  readonly requestHash: Buffer
  readonly requestId: string
  readonly now: Date
}

export interface CreateNavigationContextStoreInput {
  readonly token: Readonly<{
    queryId: string
    resultVersion: string
    projectId: string
    resultItemId: string
    position: number
    channel: 'search_exact' | 'search_adjacent'
    groupId: 'exact' | 'adjacent'
    rankingVersion: string
    pageCursorHash: string
    expiresAt: Date
  }>
  readonly sourcePage: 'P05' | 'P07'
  readonly clickRequestId: string
  readonly subjectKind: 'anonymous' | 'user'
  readonly subjectHash: Buffer
  readonly metricSubjectId: string
  readonly metricSubjectRefHash: Buffer
  readonly bridgeVersion: number
  readonly requestHash: string
  readonly now: Date
}

export interface ConsumeNavigationContextStoreInput {
  readonly navigationContextId: string
  readonly projectId: string
  readonly subjectHash: Buffer
  readonly now: Date
}

export interface SearchStore {
  consumeRawQueryRateLimit(input: {
    readonly bucketKeyHash: Buffer
    readonly windowStartedAt: Date
    readonly windowEndsAt: Date
    readonly limit: number
  }): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }>
  createSearch(input: CreateStoredSearchInput): Promise<StoredSearchExecution>
  getAuthorizedQuery(queryId: string, subjectHash: Buffer, now: Date): Promise<QueryAccessResult>
  searchExisting(input: ExistingStoredSearchInput): Promise<StoredSearchExecution>
  readQuerySnapshot(input: {
    readonly queryId: string
    readonly subjectKind: 'anonymous' | 'user'
    readonly subjectHash: Buffer
    readonly requestId: string
    readonly now: Date
  }): Promise<StoredQueryProjection>
  getIdentityLink(identityLinkId: string): Promise<StoredIdentityLink | null>
  linkQuery(input: QueryLinkStoreInput): Promise<{
    readonly authorized: true
    readonly version: number
    readonly expiresAt: Date
  }>
  unlinkQuery(input: QueryMutationStoreInput): Promise<void>
  invalidateQuery(input: QueryInvalidationStoreInput): Promise<void>
  createNavigationContext(input: CreateNavigationContextStoreInput): Promise<SearchNavigationProjection>
  consumeNavigationContext(input: ConsumeNavigationContextStoreInput): Promise<SearchAttributionContext | null>
}

const candidateSql = `
  WITH search_input AS (
    SELECT lower($1::text) AS normalized_query, plainto_tsquery('simple', $1::text) AS ts_query
  ), eligible AS (
    SELECT document.project_id,project.category_id,project.current_name,project.canonical_public_url,
      project.last_verified_at,project.freshness_status,
      concat_ws(E'\n', document.search_text, history.search_text, creator.search_text,
        event.search_text, asset.search_text) AS combined_search_text,
      document.search_vector || to_tsvector('simple', concat_ws(E'\n',
        history.search_text, creator.search_text, event.search_text, asset.search_text))
        AS combined_search_vector,
      document.structured_json,input.normalized_query,input.ts_query,
      lower(project.current_name) = input.normalized_query AS name_exact,
      lower(project.canonical_public_url) = input.normalized_query AS url_exact,
      lower(project.current_name) LIKE input.normalized_query || '%' AS name_prefix,
      (document.search_vector || to_tsvector('simple', concat_ws(E'\n',
        history.search_text, creator.search_text, event.search_text, asset.search_text)))
        @@ input.ts_query AS fts_match,
      lower(COALESCE(history.search_text, '')) LIKE '%' || input.normalized_query || '%'
        AS historical_name_match,
      lower(COALESCE(creator.search_text, '')) LIKE '%' || input.normalized_query || '%'
        AS creator_match,
      lower(COALESCE(event.search_text, '')) LIKE '%' || input.normalized_query || '%'
        AS event_match,
      lower(COALESCE(asset.search_text, '')) LIKE '%' || input.normalized_query || '%'
        AS asset_match,
      lower(document.structured_json->'project_core'->>'one_line_definition')
        LIKE '%' || input.normalized_query || '%' AS definition_match,
      lower((document.structured_json->'category_data')::text)
        LIKE '%' || input.normalized_query || '%' AS category_data_match,
      word_similarity(input.normalized_query, lower(concat_ws(E'\n', document.search_text,
        history.search_text, creator.search_text, event.search_text, asset.search_text)))
        AS adjacent_score,
      COALESCE((
        SELECT count(*)
        FROM catalog.evidence evidence
        WHERE evidence.project_id = project.project_id
          AND evidence.visibility = 'public'
          AND evidence.validity_status = 'valid'
          AND evidence.freshness_status <> 'expired'
      ), 0) AS evidence_count
    FROM search.project_documents document
    JOIN catalog.projects project ON project.project_id = document.project_id
      AND project.current_version_id = document.version_id
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT version.snapshot_json#>>'{project_core,current_name}', E'\n') AS search_text
      FROM catalog.project_versions version
      WHERE version.project_id=project.project_id
    ) history ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT profile.profile_snapshot_json->>'display_name', E'\n') AS search_text
      FROM catalog.author_relations relation
      JOIN catalog.creators linked_creator ON linked_creator.creator_id=relation.creator_id
        AND linked_creator.merge_status='canonical'
      JOIN catalog.creator_profile_versions profile
        ON profile.creator_profile_version_id=linked_creator.current_profile_version_id
      WHERE relation.project_id=project.project_id AND relation.status='active'
    ) creator ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(concat_ws(' ', current_event.event_type, current_event.event_summary), E'\n') AS search_text
      FROM catalog.events current_event
      WHERE current_event.project_id=project.project_id
        AND NOT EXISTS (
          SELECT 1 FROM catalog.events replacement
          WHERE replacement.supersedes_event_id=current_event.event_id
        )
    ) event ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(concat_ws(' ', public_asset.asset_type, public_asset.name,
        public_asset.description, public_asset.component_role), E'\n') AS search_text
      FROM catalog.assets public_asset
      WHERE public_asset.project_id=project.project_id
        AND public_asset.visibility='public'
        AND public_asset.availability_status NOT IN ('removed', 'link_abnormal')
    ) asset ON true
    CROSS JOIN search_input input
    WHERE document.visibility = 'public'
      AND project.review_status IN ('published_platform', 'published_author')
      AND ($2::text IS NULL OR project.category_id = $2::text)
      AND (cardinality($3::text[]) = 0 OR project.access_status = ANY($3::text[]))
      AND ($4::boolean IS NULL OR $4::boolean = EXISTS (
        SELECT 1 FROM catalog.assets asset
        WHERE asset.project_id = project.project_id
          AND asset.visibility = 'public'
          AND asset.availability_status = 'available'
      ))
      AND ($5::timestamptz IS NULL OR project.last_verified_at >= $5::timestamptz)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_each($6::jsonb) requested
        WHERE NOT CASE jsonb_typeof(document.structured_json->'category_data'->requested.key)
          WHEN 'array' THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(requested.value) wanted(value)
            WHERE document.structured_json->'category_data'->requested.key ? wanted.value
          )
          WHEN 'string' THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(requested.value) wanted(value)
            WHERE document.structured_json->'category_data'->>requested.key = wanted.value
          )
          ELSE false
        END
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_each($7::jsonb) excluded
        WHERE CASE jsonb_typeof(document.structured_json->'category_data'->excluded.key)
          WHEN 'array' THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(excluded.value) unwanted(value)
            WHERE document.structured_json->'category_data'->excluded.key ? unwanted.value
          )
          WHEN 'string' THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(excluded.value) unwanted(value)
            WHERE document.structured_json->'category_data'->>excluded.key = unwanted.value
          )
          ELSE false
        END
      )
  ), scored AS (
    SELECT *,
      CASE WHEN name_exact OR url_exact OR name_prefix OR fts_match THEN 'exact' ELSE 'adjacent' END AS group_id,
      array_remove(ARRAY[
        CASE WHEN name_exact OR name_prefix THEN 'project_core.current_name'::text END,
        CASE WHEN url_exact THEN 'project_core.public_url'::text END,
        CASE WHEN historical_name_match THEN 'project_history.current_name'::text END,
        CASE WHEN creator_match THEN 'creator.display_name'::text END,
        CASE WHEN event_match THEN 'event.public_summary'::text END,
        CASE WHEN asset_match THEN 'asset.public_fields'::text END,
        CASE WHEN definition_match THEN 'project_core.one_line_definition'::text END,
        CASE WHEN category_data_match THEN 'category_data'::text END,
        CASE WHEN fts_match THEN 'full_text'::text END,
        CASE WHEN adjacent_score >= 0.25 THEN 'full_text_similarity'::text END
      ], NULL) AS matched_fields,
      ts_rank_cd(combined_search_vector, ts_query) AS fts_rank,
      (definition_match::integer + category_data_match::integer) AS structured_match_count
    FROM eligible
    WHERE name_exact OR url_exact OR name_prefix OR fts_match OR historical_name_match
       OR creator_match OR event_match OR asset_match OR definition_match OR category_data_match
       OR adjacent_score >= 0.25
  )
  SELECT project_id,category_id,group_id,matched_fields,freshness_status
  FROM scored
  ORDER BY
    CASE group_id WHEN 'exact' THEN 0 ELSE 1 END,
    CASE WHEN url_exact OR name_exact THEN 0 WHEN name_prefix THEN 1 ELSE 2 END,
    structured_match_count DESC,
    fts_rank DESC,
    adjacent_score DESC,
    evidence_count DESC,
    last_verified_at DESC,
    project_id
  LIMIT $8`

async function candidates(
  client: PoolClient,
  input: Pick<CreateStoredSearchInput, 'rawQuery' | 'categoryId' | 'filters' | 'maximumStoredResults'>,
): Promise<readonly CandidateRow[]> {
  const result = await client.query<CandidateRow>(candidateSql, [
    input.rawQuery,
    input.categoryId,
    [...input.filters.access_status],
    input.filters.has_available_asset,
    input.filters.verified_since,
    JSON.stringify(input.filters.category_fields),
    JSON.stringify(input.filters.exclude_category_fields),
    input.maximumStoredResults,
  ])
  return Object.freeze(result.rows)
}

function reason(candidate: CandidateRow): SearchMatchReason {
  return Object.freeze({
    matched_fields: Object.freeze(candidate.matched_fields),
    unmatched_soft_fields: Object.freeze([]),
    relaxed_fields: Object.freeze([]),
    evidence_freshness: candidate.freshness_status,
    reason_template_key: candidate.group_id === 'exact'
      ? 'search.match.exact'
      : 'search.match.adjacent',
  })
}

async function insertResult(
  client: PoolClient,
  input: {
    readonly queryId: string
    readonly intentVersion: number
    readonly requestFingerprint: Buffer
    readonly filters: SearchFilters
    readonly sort: SearchSort
    readonly expiresAt: Date
    readonly candidates: readonly CandidateRow[]
  },
): Promise<string> {
  const resultVersion = randomUUID()
  const exactCount = input.candidates.filter((item) => item.group_id === 'exact').length
  const adjacentCount = input.candidates.length - exactCount
  const digest = createHash('sha256').update(JSON.stringify(input.candidates.map((item) => ({
    project_id: item.project_id,
    group_id: item.group_id,
    matched_fields: item.matched_fields,
  })))).digest()
  await client.query(
    `INSERT INTO search.result_versions (
       result_version,query_id,intent_version,request_fingerprint,ranking_version,parser_version,
       filter_snapshot_json,sort,semantic_degraded,result_digest,exact_count,adjacent_count,expires_at
     ) VALUES ($1,$2,$3,$4,'search.keyword.v1','keyword.v1',$5::jsonb,$6,true,$7,$8,$9,$10)`,
    [
      resultVersion, input.queryId, input.intentVersion, input.requestFingerprint,
      JSON.stringify(input.filters), input.sort, digest, exactCount, adjacentCount, input.expiresAt,
    ],
  )
  const groupPositions = { exact: 0, adjacent: 0 }
  for (const [index, candidate] of input.candidates.entries()) {
    const resultItemId = randomUUID()
    const position = ++groupPositions[candidate.group_id]
    const channel = candidate.group_id === 'exact' ? 'search_exact' : 'search_adjacent'
    const matchReason = reason(candidate)
    const bindingHash = createHash('sha256').update(JSON.stringify({
      query_id: input.queryId,
      result_version: resultVersion,
      result_item_id: resultItemId,
      project_id: candidate.project_id,
      position,
      channel,
      group_id: candidate.group_id,
      ranking_version: 'search.keyword.v1',
    })).digest()
    await client.query(
      `INSERT INTO search.result_items (
         result_version,group_id,result_item_id,project_id,group_position,global_position,
         channel,reason_json,token_binding_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        resultVersion, candidate.group_id, resultItemId, candidate.project_id, position,
        index + 1, channel, JSON.stringify(matchReason), bindingHash,
      ],
    )
  }
  return resultVersion
}

async function page(
  client: PoolClient,
  resultVersion: string,
  offset: number,
  pageSize: number,
): Promise<StoredSearchExecution> {
  const versionResult = await client.query<ResultVersionRow>(
    `SELECT result_version,query_id,intent_version,ranking_version,parser_version,
       filter_snapshot_json,sort,semantic_degraded,exact_count,adjacent_count,expires_at
     FROM search.result_versions WHERE result_version=$1`,
    [resultVersion],
  )
  const version = versionResult.rows[0]
  if (!version) throw searchError('SEARCH_RESULT_NOT_FOUND', 404)
  const itemResult = await client.query<ResultItemRow>(
    `SELECT item.project_id,project.category_id,item.result_item_id,item.group_id,
       item.group_position,item.global_position,item.channel,item.reason_json,
       count(*) OVER()::integer AS total_count
     FROM search.result_items item
     JOIN catalog.projects project ON project.project_id=item.project_id
     WHERE item.result_version=$1 AND item.global_position>$2
     ORDER BY item.global_position
     LIMIT $3`,
    [resultVersion, offset, pageSize],
  )
  const totalCount = version.exact_count + version.adjacent_count
  const nextOffset = offset + itemResult.rows.length < totalCount
    ? offset + itemResult.rows.length
    : null
  return Object.freeze({
    queryId: version.query_id,
    intentVersion: version.intent_version,
    parserVersion: version.parser_version,
    resultVersion: version.result_version,
    rankingVersion: version.ranking_version,
    categoryId: null,
    filters: version.filter_snapshot_json,
    sort: version.sort,
    semanticDegraded: version.semantic_degraded,
    exactCount: version.exact_count,
    adjacentCount: version.adjacent_count,
    expiresAt: version.expires_at,
    items: Object.freeze(itemResult.rows.map((item) => Object.freeze({
      project_id: item.project_id,
      category_id: item.category_id,
      result_item_id: item.result_item_id,
      group_id: item.group_id,
      group_position: item.group_position,
      global_position: item.global_position,
      channel: item.channel,
      reason_json: item.reason_json,
    }))),
    nextOffset,
  })
}

async function begin<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await action(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

interface QueryProjectionRow {
  readonly query_id: string
  readonly mode: SearchMode
  readonly category_id: CategoryId | null
  readonly snapshot_version: string
  readonly status: 'active' | 'invalidated'
  readonly expires_at: Date
  readonly authorized: boolean
  readonly intent_version: number
  readonly intent_json: Record<string, unknown>
  readonly confidence_json: Record<string, unknown>
  readonly intent_parser_version: string
  readonly result_version: string
  readonly ranking_version: string
  readonly filter_snapshot_json: SearchFilters
  readonly sort: SearchSort
  readonly semantic_degraded: boolean
  readonly exact_count: number
  readonly adjacent_count: number
}

interface IdentityLinkRow {
  readonly identity_link_id: string
  readonly anonymous_subject_id: string
  readonly user_id: string
  readonly purpose: StoredIdentityLink['purpose']
  readonly status: StoredIdentityLink['status']
  readonly expires_at: Date
}

interface QueryOperationReceiptRow {
  readonly operation_type: 'link' | 'unlink' | 'invalidate'
  readonly request_hash: Buffer
  readonly response_json: Record<string, unknown>
}

function queryTargetHash(queryId: string): Buffer {
  return createHash('sha256').update(queryId, 'utf8').digest()
}

async function auditQueryOperation(
  client: PoolClient,
  input: {
    readonly eventType: string
    readonly queryId: string
    readonly requestId: string
    readonly subjectKind: 'anonymous' | 'user'
    readonly subjectHash: Buffer
    readonly result: string
    readonly version?: number
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit.security_events (
       event_type,severity,actor_user_id_hash,target_type,target_id_hash,
       metadata_json,request_id
     ) VALUES ($1,$2,$3,'query_snapshot',$4,$5::jsonb,$6)`,
    [
      input.eventType,
      input.result === 'forbidden' ? 'warning' : 'info',
      input.subjectKind === 'user' ? input.subjectHash : null,
      queryTargetHash(input.queryId),
      JSON.stringify({ result: input.result, version: input.version ?? null }),
      input.requestId,
    ],
  )
}

async function operationReceipt(
  client: PoolClient,
  queryId: string,
  operationId: string,
  operationType: 'link' | 'unlink' | 'invalidate',
  subjectHash: Buffer,
  requestHash: Buffer,
): Promise<Record<string, unknown> | null> {
  const receipt = await client.query<QueryOperationReceiptRow>(
    `SELECT operation_type,request_hash,response_json
     FROM search.query_operation_receipts
     WHERE query_id=$1 AND operation_id=$2 AND subject_hash=$3`,
    [queryId, operationId, subjectHash],
  )
  const row = receipt.rows[0]
  if (!row) return null
  if (row.operation_type !== operationType || !row.request_hash.equals(requestHash)) {
    throw searchError('QUERY_OPERATION_ID_REUSED', 409)
  }
  return row.response_json
}

async function saveOperationReceipt(
  client: PoolClient,
  input: {
    readonly queryId: string
    readonly operationId: string
    readonly operationType: 'link' | 'unlink' | 'invalidate'
    readonly subjectHash: Buffer
    readonly requestHash: Buffer
    readonly response: Readonly<Record<string, unknown>>
    readonly now: Date
  },
): Promise<void> {
  await client.query(
    `INSERT INTO search.query_operation_receipts (
       query_id,operation_id,operation_type,subject_hash,request_hash,response_json,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      input.queryId,
      input.operationId,
      input.operationType,
      input.subjectHash,
      input.requestHash,
      JSON.stringify(input.response),
      input.now,
    ],
  )
}

function storedQueryProjection(row: QueryProjectionRow): StoredQueryProjection {
  return Object.freeze({
    queryId: row.query_id,
    mode: row.mode,
    categoryId: row.category_id,
    intent: Object.freeze(row.intent_json),
    confidence: Object.freeze(row.confidence_json),
    intentVersion: row.intent_version,
    parserVersion: row.intent_parser_version,
    resultVersion: row.result_version,
    rankingVersion: row.ranking_version,
    filters: Object.freeze(row.filter_snapshot_json),
    sort: row.sort,
    semanticDegraded: row.semantic_degraded,
    exactCount: row.exact_count,
    adjacentCount: row.adjacent_count,
    version: Number(row.snapshot_version),
    expiresAt: row.expires_at,
  })
}

export class PostgresSearchStore implements SearchStore {
  constructor(private readonly pool: Pool) {}

  async consumeRawQueryRateLimit(input: {
    readonly bucketKeyHash: Buffer
    readonly windowStartedAt: Date
    readonly windowEndsAt: Date
    readonly limit: number
  }): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }> {
    const result = await this.pool.query<{ hit_count: number }>(
      `INSERT INTO search.rate_limit_buckets (
         bucket_key_hash,scope,window_started_at,hit_count,blocked_until,updated_at
       ) VALUES ($1,'raw_query',$2,1,NULL,now())
       ON CONFLICT (bucket_key_hash,scope,window_started_at) DO UPDATE SET
         hit_count=search.rate_limit_buckets.hit_count+1,
         blocked_until=CASE
           WHEN search.rate_limit_buckets.hit_count+1>$3 THEN $4::timestamptz
           ELSE search.rate_limit_buckets.blocked_until
         END,
         updated_at=now()
       RETURNING hit_count`,
      [input.bucketKeyHash, input.windowStartedAt, input.limit, input.windowEndsAt],
    )
    return Object.freeze({
      allowed: result.rows[0]!.hit_count <= input.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((input.windowEndsAt.getTime() - Date.now()) / 1_000)),
    })
  }

  async createSearch(input: CreateStoredSearchInput): Promise<StoredSearchExecution> {
    return begin(this.pool, async (client) => {
      await client.query(
        `INSERT INTO search.query_snapshots (
           query_id,owner_subject_kind,owner_subject_hash,encrypted_data_key,data_key_iv,
           data_key_auth_tag,raw_query_ciphertext,raw_query_iv,raw_query_auth_tag,
           encryption_key_version,query_hash,query_length_bucket,mode,category_id,locale,expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          input.queryId, input.subjectKind, input.subjectHash, input.encryptedQuery.encryptedDataKey,
          input.encryptedQuery.dataKeyIv, input.encryptedQuery.dataKeyAuthTag,
          input.encryptedQuery.ciphertext, input.encryptedQuery.iv, input.encryptedQuery.authTag,
          input.encryptionKeyVersion, input.queryHash, input.queryLengthBucket, input.mode,
          input.categoryId, input.locale, input.expiresAt,
        ],
      )
      await client.query(
        `INSERT INTO search.intent_versions (
           query_id,intent_version,intent_json,confidence_json,parser_version
         ) VALUES ($1,1,$2::jsonb,$3::jsonb,'keyword.v1')`,
        [
          input.queryId,
          JSON.stringify({
            mode: input.mode,
            category_id: input.categoryId,
            hard_filters: input.filters,
            soft_preferences: [],
            excluded_terms: [],
          }),
          JSON.stringify({ overall: 'not_applicable', field_confidence: {}, low_confidence_fields: [] }),
        ],
      )
      const found = await candidates(client, input)
      const resultVersion = await insertResult(client, {
        queryId: input.queryId,
        intentVersion: 1,
        requestFingerprint: input.requestFingerprint,
        filters: input.filters,
        sort: input.sort,
        expiresAt: input.expiresAt,
        candidates: found,
      })
      const execution = await page(client, resultVersion, 0, input.pageSize)
      return Object.freeze({ ...execution, categoryId: input.categoryId })
    })
  }

  async getAuthorizedQuery(queryId: string, subjectHash: Buffer, now: Date): Promise<QueryAccessResult> {
    const result = await this.pool.query<StoredQuerySnapshot & { authorized: boolean }>(
      `SELECT snapshot.*,active_result.active_filter_snapshot,
         (snapshot.owner_subject_hash=$2 OR EXISTS (
           SELECT 1 FROM search.query_authorized_subjects authorized
           WHERE authorized.query_id=snapshot.query_id
             AND authorized.subject_hash=$2
             AND authorized.revoked_at IS NULL
         )) AS authorized
       FROM search.query_snapshots snapshot
       LEFT JOIN LATERAL (
         SELECT result.filter_snapshot_json AS active_filter_snapshot
         FROM search.result_versions result
         WHERE result.query_id=snapshot.query_id
         ORDER BY result.created_at DESC,result.result_version DESC
         LIMIT 1
       ) active_result ON true
       WHERE snapshot.query_id=$1`,
      [queryId, subjectHash],
    )
    const row = result.rows[0]
    if (!row) return Object.freeze({ kind: 'missing' })
    if (!row.authorized) return Object.freeze({ kind: 'forbidden' })
    if (row.status !== 'active' || row.expires_at.getTime() <= now.getTime()) {
      return Object.freeze({ kind: 'gone' })
    }
    const snapshot: StoredQuerySnapshot = Object.freeze({
      query_id: row.query_id,
      owner_subject_kind: row.owner_subject_kind,
      owner_subject_hash: row.owner_subject_hash,
      encrypted_data_key: row.encrypted_data_key,
      data_key_iv: row.data_key_iv,
      data_key_auth_tag: row.data_key_auth_tag,
      raw_query_ciphertext: row.raw_query_ciphertext,
      raw_query_iv: row.raw_query_iv,
      raw_query_auth_tag: row.raw_query_auth_tag,
      encryption_key_version: row.encryption_key_version,
      mode: row.mode,
      category_id: row.category_id,
      active_intent_version: row.active_intent_version,
      status: row.status,
      expires_at: row.expires_at,
      active_filter_snapshot: row.active_filter_snapshot,
    })
    return Object.freeze({ kind: 'active', snapshot })
  }

  async searchExisting(input: ExistingStoredSearchInput): Promise<StoredSearchExecution> {
    return begin(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.snapshot.query_id])
      const access = await client.query<{ authorized: boolean; active: boolean }>(
        `SELECT
           (owner_subject_hash=$2 OR EXISTS (
             SELECT 1 FROM search.query_authorized_subjects authorized
             WHERE authorized.query_id=snapshot.query_id AND authorized.subject_hash=$2
               AND authorized.revoked_at IS NULL
           )) AS authorized,
           (status='active' AND expires_at>$3) AS active
         FROM search.query_snapshots snapshot WHERE query_id=$1 FOR UPDATE`,
        [input.snapshot.query_id, input.subjectHash, input.now],
      )
      if (!access.rows[0]?.authorized) throw searchError('QUERY_FORBIDDEN', 403)
      if (!access.rows[0].active) throw searchError('QUERY_GONE', 410)
      const existing = await client.query<{ result_version: string }>(
        `SELECT result_version FROM search.result_versions
         WHERE query_id=$1 AND intent_version=$2 AND request_fingerprint=$3`,
        [input.snapshot.query_id, input.snapshot.active_intent_version, input.requestFingerprint],
      )
      let resultVersion = existing.rows[0]?.result_version ?? null
      if (resultVersion === null) {
        const found = await candidates(client, {
          rawQuery: input.rawQuery,
          categoryId: input.categoryId,
          filters: input.filters,
          maximumStoredResults: input.maximumStoredResults,
        })
        resultVersion = await insertResult(client, {
          queryId: input.snapshot.query_id,
          intentVersion: input.snapshot.active_intent_version,
          requestFingerprint: input.requestFingerprint,
          filters: input.filters,
          sort: input.sort,
          expiresAt: input.snapshot.expires_at,
          candidates: found,
        })
      }
      if (input.expectedResultVersion !== null && input.expectedResultVersion !== resultVersion) {
        throw searchError('SEARCH_CURSOR_INVALID', 400)
      }
      const execution = await page(client, resultVersion, input.offset, input.pageSize)
      return Object.freeze({ ...execution, categoryId: input.categoryId })
    })
  }

  async readQuerySnapshot(input: {
    readonly queryId: string
    readonly subjectKind: 'anonymous' | 'user'
    readonly subjectHash: Buffer
    readonly requestId: string
    readonly now: Date
  }): Promise<StoredQueryProjection> {
    const outcome = await begin(this.pool, async (client) => {
      const result = await client.query<QueryProjectionRow>(
        `SELECT snapshot.query_id,snapshot.mode,snapshot.category_id,snapshot.snapshot_version,
           snapshot.status,snapshot.expires_at,
           (snapshot.owner_subject_hash=$2 OR EXISTS (
             SELECT 1 FROM search.query_authorized_subjects authorized
             WHERE authorized.query_id=snapshot.query_id
               AND authorized.subject_hash=$2
               AND authorized.revoked_at IS NULL
           )) AS authorized,
           intent.intent_version,intent.intent_json,intent.confidence_json,
           intent.parser_version AS intent_parser_version,
           result.result_version,result.ranking_version,result.filter_snapshot_json,
           result.sort,result.semantic_degraded,result.exact_count,result.adjacent_count
         FROM search.query_snapshots snapshot
         JOIN search.intent_versions intent
           ON intent.query_id=snapshot.query_id
          AND intent.intent_version=snapshot.active_intent_version
         JOIN LATERAL (
           SELECT current_result.result_version,current_result.ranking_version,
             current_result.filter_snapshot_json,current_result.sort,
             current_result.semantic_degraded,current_result.exact_count,current_result.adjacent_count
           FROM search.result_versions current_result
           WHERE current_result.query_id=snapshot.query_id
             AND current_result.intent_version=snapshot.active_intent_version
           ORDER BY current_result.created_at DESC,current_result.result_version DESC
           LIMIT 1
         ) result ON true
         WHERE snapshot.query_id=$1`,
        [input.queryId, input.subjectHash],
      )
      const row = result.rows[0]
      const auditResult = !row
        ? 'missing'
        : !row.authorized
          ? 'forbidden'
          : row.status !== 'active' || row.expires_at.getTime() <= input.now.getTime()
            ? 'gone'
            : 'allowed'
      await auditQueryOperation(client, {
        eventType: 'query_snapshot_read',
        queryId: input.queryId,
        requestId: input.requestId,
        subjectKind: input.subjectKind,
        subjectHash: input.subjectHash,
        result: auditResult,
        ...(row ? { version: Number(row.snapshot_version) } : {}),
      })
      if (!row) return Object.freeze({ kind: 'missing' as const })
      if (!row.authorized) return Object.freeze({ kind: 'forbidden' as const })
      if (row.status !== 'active' || row.expires_at.getTime() <= input.now.getTime()) {
        return Object.freeze({ kind: 'gone' as const })
      }
      return Object.freeze({ kind: 'active' as const, projection: storedQueryProjection(row) })
    })
    if (outcome.kind === 'missing') throw searchError('QUERY_NOT_FOUND', 404)
    if (outcome.kind === 'forbidden') throw searchError('QUERY_FORBIDDEN', 403)
    if (outcome.kind === 'gone') throw searchError('QUERY_GONE', 410)
    return outcome.projection
  }

  async getIdentityLink(identityLinkId: string): Promise<StoredIdentityLink | null> {
    const result = await this.pool.query<IdentityLinkRow>(
      `SELECT identity_link_id,anonymous_subject_id,user_id,purpose,status,expires_at
       FROM iam.identity_links WHERE identity_link_id=$1`,
      [identityLinkId],
    )
    const row = result.rows[0]
    if (!row) return null
    return Object.freeze({
      identityLinkId: row.identity_link_id,
      anonymousSubjectId: row.anonymous_subject_id,
      userId: row.user_id,
      purpose: row.purpose,
      status: row.status,
      expiresAt: row.expires_at,
    })
  }

  async linkQuery(input: QueryLinkStoreInput): Promise<{
    readonly authorized: true
    readonly version: number
    readonly expiresAt: Date
  }> {
    return begin(this.pool, async (client) => {
      const replay = await operationReceipt(
        client,
        input.queryId,
        input.operationId,
        'link',
        input.userSubjectHash,
        input.requestHash,
      )
      if (replay) {
        return Object.freeze({
          authorized: true,
          version: Number(replay.version),
          expiresAt: new Date(String(replay.expires_at)),
        })
      }

      const linkResult = await client.query<IdentityLinkRow>(
        `SELECT identity_link_id,anonymous_subject_id,user_id,purpose,status,expires_at
         FROM iam.identity_links WHERE identity_link_id=$1 FOR UPDATE`,
        [input.identityLinkId],
      )
      const link = linkResult.rows[0]
      if (!link) throw searchError('IDENTITY_LINK_NOT_FOUND', 404)
      if (
        link.purpose !== 'query_continuation' || link.user_id !== input.userId ||
        link.anonymous_subject_id !== input.anonymousSubjectId
      ) throw searchError('IDENTITY_LINK_FORBIDDEN', 403)
      if (link.status !== 'active' || link.expires_at.getTime() <= input.now.getTime()) {
        if (link.status === 'active') {
          await client.query(
            `UPDATE iam.identity_links SET status='expired'
             WHERE identity_link_id=$1 AND status='active'`,
            [input.identityLinkId],
          )
        }
        throw searchError('IDENTITY_LINK_GONE', 410)
      }

      const queryResult = await client.query<{
        snapshot_version: string
        status: 'active' | 'invalidated'
        expires_at: Date
        owner_subject_kind: 'anonymous' | 'user'
        owner_subject_hash: Buffer
      }>(
        `SELECT snapshot_version,status,expires_at,owner_subject_kind,owner_subject_hash
         FROM search.query_snapshots WHERE query_id=$1 FOR UPDATE`,
        [input.queryId],
      )
      const query = queryResult.rows[0]
      if (!query) throw searchError('QUERY_NOT_FOUND', 404)
      if (
        query.owner_subject_kind !== 'anonymous' ||
        !query.owner_subject_hash.equals(input.anonymousSubjectHash)
      ) throw searchError('IDENTITY_LINK_FORBIDDEN', 403)
      if (query.status !== 'active' || query.expires_at.getTime() <= input.now.getTime()) {
        throw searchError('QUERY_GONE', 410)
      }
      if (Number(query.snapshot_version) !== input.expectedVersion) {
        throw searchError('QUERY_VERSION_CONFLICT', 409)
      }

      await client.query(
        `INSERT INTO search.query_authorized_subjects (
           query_id,subject_kind,subject_hash,identity_link_id,authorized_at,revoked_at
         ) VALUES ($1,'user',$2,$3,$4,NULL)
         ON CONFLICT (query_id,subject_hash) DO UPDATE SET
           subject_kind='user',identity_link_id=EXCLUDED.identity_link_id,
           authorized_at=EXCLUDED.authorized_at,revoked_at=NULL`,
        [input.queryId, input.userSubjectHash, input.identityLinkId, input.now],
      )
      await client.query(
        `UPDATE iam.identity_links SET status='consumed',consumed_at=$2
         WHERE identity_link_id=$1`,
        [input.identityLinkId, input.now],
      )
      const updated = await client.query<{ snapshot_version: string }>(
        `UPDATE search.query_snapshots
         SET snapshot_version=snapshot_version+1
         WHERE query_id=$1 RETURNING snapshot_version`,
        [input.queryId],
      )
      const version = Number(updated.rows[0]!.snapshot_version)
      const response = Object.freeze({
        authorized: true,
        version,
        expires_at: query.expires_at.toISOString(),
      })
      await saveOperationReceipt(client, {
        queryId: input.queryId,
        operationId: input.operationId,
        operationType: 'link',
        subjectHash: input.userSubjectHash,
        requestHash: input.requestHash,
        response,
        now: input.now,
      })
      await auditQueryOperation(client, {
        eventType: 'query_snapshot_linked',
        queryId: input.queryId,
        requestId: input.requestId,
        subjectKind: 'user',
        subjectHash: input.userSubjectHash,
        result: 'authorized',
        version,
      })
      return Object.freeze({ authorized: true, version, expiresAt: query.expires_at })
    })
  }

  async unlinkQuery(input: QueryMutationStoreInput): Promise<void> {
    await begin(this.pool, async (client) => {
      const replay = await operationReceipt(
        client,
        input.queryId,
        input.operationId,
        'unlink',
        input.subjectHash,
        input.requestHash,
      )
      if (replay) return
      if (input.subjectKind !== 'user') throw searchError('QUERY_LINK_FORBIDDEN', 403)

      const result = await client.query<{
        snapshot_version: string
        status: 'active' | 'invalidated'
        expires_at: Date
        linked: boolean
        ever_linked: boolean
      }>(
        `SELECT snapshot.snapshot_version,snapshot.status,snapshot.expires_at,
           EXISTS (
             SELECT 1 FROM search.query_authorized_subjects authorized
             WHERE authorized.query_id=snapshot.query_id
               AND authorized.subject_hash=$2 AND authorized.revoked_at IS NULL
           ) AS linked,
           EXISTS (
             SELECT 1 FROM search.query_authorized_subjects authorized
             WHERE authorized.query_id=snapshot.query_id AND authorized.subject_hash=$2
           ) AS ever_linked
         FROM search.query_snapshots snapshot WHERE snapshot.query_id=$1 FOR UPDATE`,
        [input.queryId, input.subjectHash],
      )
      const query = result.rows[0]
      if (!query) throw searchError('QUERY_NOT_FOUND', 404)
      if (!query.ever_linked) throw searchError('QUERY_LINK_FORBIDDEN', 403)
      if (!query.linked) {
        await saveOperationReceipt(client, {
          queryId: input.queryId,
          operationId: input.operationId,
          operationType: 'unlink',
          subjectHash: input.subjectHash,
          requestHash: input.requestHash,
          response: Object.freeze({}),
          now: input.now,
        })
        await auditQueryOperation(client, {
          eventType: 'query_snapshot_unlinked',
          queryId: input.queryId,
          requestId: input.requestId,
          subjectKind: 'user',
          subjectHash: input.subjectHash,
          result: 'no_change',
          version: Number(query.snapshot_version),
        })
        return
      }
      if (query.status !== 'active' || query.expires_at.getTime() <= input.now.getTime()) {
        throw searchError('QUERY_GONE', 410)
      }
      if (Number(query.snapshot_version) !== input.expectedVersion) {
        throw searchError('QUERY_VERSION_CONFLICT', 409)
      }
      await client.query(
        `UPDATE search.query_authorized_subjects SET revoked_at=$3
         WHERE query_id=$1 AND subject_hash=$2 AND revoked_at IS NULL`,
        [input.queryId, input.subjectHash, input.now],
      )
      const updated = await client.query<{ snapshot_version: string }>(
        `UPDATE search.query_snapshots SET snapshot_version=snapshot_version+1
         WHERE query_id=$1 RETURNING snapshot_version`,
        [input.queryId],
      )
      const version = Number(updated.rows[0]!.snapshot_version)
      await saveOperationReceipt(client, {
        queryId: input.queryId,
        operationId: input.operationId,
        operationType: 'unlink',
        subjectHash: input.subjectHash,
        requestHash: input.requestHash,
        response: Object.freeze({}),
        now: input.now,
      })
      await auditQueryOperation(client, {
        eventType: 'query_snapshot_unlinked',
        queryId: input.queryId,
        requestId: input.requestId,
        subjectKind: 'user',
        subjectHash: input.subjectHash,
        result: 'revoked',
        version,
      })
    })
  }

  async invalidateQuery(input: QueryInvalidationStoreInput): Promise<void> {
    await begin(this.pool, async (client) => {
      const replay = await operationReceipt(
        client,
        input.queryId,
        input.operationId,
        'invalidate',
        input.subjectHash,
        input.requestHash,
      )
      if (replay) return
      const result = await client.query<{
        snapshot_version: string
        status: 'active' | 'invalidated'
        authorized: boolean
      }>(
        `SELECT snapshot.snapshot_version,snapshot.status,
           (snapshot.owner_subject_hash=$2 OR EXISTS (
             SELECT 1 FROM search.query_authorized_subjects authorized
             WHERE authorized.query_id=snapshot.query_id
               AND authorized.subject_hash=$2 AND authorized.revoked_at IS NULL
           )) AS authorized
         FROM search.query_snapshots snapshot WHERE snapshot.query_id=$1 FOR UPDATE`,
        [input.queryId, input.subjectHash],
      )
      const query = result.rows[0]
      if (!query) throw searchError('QUERY_NOT_FOUND', 404)
      if (!query.authorized) throw searchError('QUERY_FORBIDDEN', 403)
      let version = Number(query.snapshot_version)
      let resultKey = 'no_change'
      if (query.status === 'active') {
        const updated = await client.query<{ snapshot_version: string }>(
          `UPDATE search.query_snapshots SET
             status='invalidated',invalidated_at=$2,snapshot_version=snapshot_version+1,
             encrypted_data_key=NULL,data_key_iv=NULL,data_key_auth_tag=NULL,
             raw_query_ciphertext=NULL,raw_query_iv=NULL,raw_query_auth_tag=NULL
           WHERE query_id=$1 RETURNING snapshot_version`,
          [input.queryId, input.now],
        )
        version = Number(updated.rows[0]!.snapshot_version)
        resultKey = 'invalidated'
      }
      await saveOperationReceipt(client, {
        queryId: input.queryId,
        operationId: input.operationId,
        operationType: 'invalidate',
        subjectHash: input.subjectHash,
        requestHash: input.requestHash,
        response: Object.freeze({}),
        now: input.now,
      })
      await auditQueryOperation(client, {
        eventType: 'query_snapshot_invalidated',
        queryId: input.queryId,
        requestId: input.requestId,
        subjectKind: input.subjectKind,
        subjectHash: input.subjectHash,
        result: resultKey,
        version,
      })
    })
  }

  async createNavigationContext(input: CreateNavigationContextStoreInput): Promise<SearchNavigationProjection> {
    return begin(this.pool,async(client)=>{
      const replay=await client.query<{
        navigation_context_id:string;click_id:string;project_id:string;result_item_id:string;
        position:number;channel:'search_exact'|'search_adjacent';group_id:'exact'|'adjacent';
        ranking_version:string;expires_at:Date;request_hash:string
      }>(
        `SELECT navigation_context_id,click_id,project_id,result_item_id,position,channel,
           group_id,ranking_version,expires_at,request_hash
         FROM search.navigation_contexts
         WHERE owner_subject_hash=$1 AND click_request_id=$2`,
        [input.subjectHash,input.clickRequestId],
      )
      const existing=replay.rows[0]
      if(existing){
        if(existing.request_hash!==input.requestHash)throw searchError('CLICK_REQUEST_REUSED',409)
        return Object.freeze({
          navigation_context_id:existing.navigation_context_id,click_id:existing.click_id,
          project_id:existing.project_id,result_item_id:existing.result_item_id,
          position:existing.position,channel:existing.channel,group_id:existing.group_id,
          ranking_version:existing.ranking_version,expires_at:existing.expires_at.toISOString(),
          navigation_url:`/project/${existing.project_id}?navigation_context_id=${existing.navigation_context_id}`,
          deduplicated:true,
        })
      }
      const frozen=await client.query<{
        snapshot_status:'active'|'invalidated';snapshot_expires_at:Date;authorized:boolean;
        result_expires_at:Date;ranking_version:string;is_current_result:boolean;
        project_id:string;result_item_id:string;group_position:number;channel:'search_exact'|'search_adjacent';
        group_id:'exact'|'adjacent';token_binding_hash:Buffer;review_status:string
      }>(
        `SELECT snapshot.status AS snapshot_status,snapshot.expires_at AS snapshot_expires_at,
           (snapshot.owner_subject_hash=$3 OR EXISTS(
             SELECT 1 FROM search.query_authorized_subjects authorized
             WHERE authorized.query_id=snapshot.query_id AND authorized.subject_hash=$3
               AND authorized.revoked_at IS NULL
           )) AS authorized,
           result.expires_at AS result_expires_at,result.ranking_version,
           result.result_version=(
             SELECT current_result.result_version FROM search.result_versions current_result
             WHERE current_result.query_id=snapshot.query_id
               AND current_result.intent_version=snapshot.active_intent_version
             ORDER BY current_result.created_at DESC,current_result.result_version DESC LIMIT 1
           ) AS is_current_result,
           item.project_id,item.result_item_id,item.group_position,item.channel,item.group_id,
           item.token_binding_hash,project.review_status
         FROM search.query_snapshots snapshot
         JOIN search.result_versions result ON result.result_version=$2 AND result.query_id=snapshot.query_id
         JOIN search.result_items item ON item.result_version=result.result_version AND item.result_item_id=$4
         JOIN catalog.projects project ON project.project_id=item.project_id
         WHERE snapshot.query_id=$1
         FOR UPDATE OF snapshot`,
        [input.token.queryId,input.token.resultVersion,input.subjectHash,input.token.resultItemId],
      )
      const row=frozen.rows[0]
      if(!row)throw searchError('SEARCH_RESULT_ITEM_NOT_FOUND',404)
      if(!row.authorized)throw searchError('QUERY_FORBIDDEN',403)
      if(row.snapshot_status!=='active'||row.snapshot_expires_at<=input.now||row.result_expires_at<=input.now){
        throw searchError('SEARCH_RESULT_EXPIRED',410)
      }
      if(!row.is_current_result)throw searchError('SEARCH_RESULT_STALE',410)
      if(!['published_platform','published_author'].includes(row.review_status)){
        throw searchError('PROJECT_NOT_PUBLIC',410)
      }
      const binding=createHash('sha256').update(JSON.stringify({
        query_id:input.token.queryId,result_version:input.token.resultVersion,
        result_item_id:input.token.resultItemId,project_id:input.token.projectId,
        position:input.token.position,channel:input.token.channel,group_id:input.token.groupId,
        ranking_version:input.token.rankingVersion,
      })).digest()
      if(
        row.project_id!==input.token.projectId||row.result_item_id!==input.token.resultItemId||
        row.group_position!==input.token.position||row.channel!==input.token.channel||
        row.group_id!==input.token.groupId||row.ranking_version!==input.token.rankingVersion||
        !row.token_binding_hash.equals(binding)
      )throw searchError('SEARCH_RESULT_TOKEN_MISMATCH',422)

      const navigationContextId=randomUUID()
      const clickId=randomUUID()
      const transactionId=randomUUID()
      const expiresAt=new Date(Math.min(
        input.token.expiresAt.getTime(),row.snapshot_expires_at.getTime(),row.result_expires_at.getTime(),
      ))
      await client.query(
        `INSERT INTO analytics.identity_bridge_events(
           bridge_event_id,metric_subject_id,subject_kind,subject_ref_hash,bridge_version,
           link_action,status,effective_at,created_at
         ) VALUES($1,$2,$3,$4,$5,'created','active',$6,$6)
         ON CONFLICT(subject_kind,subject_ref_hash,bridge_version) DO NOTHING`,
        [randomUUID(),input.metricSubjectId,input.subjectKind,input.metricSubjectRefHash,input.bridgeVersion,input.now],
      )
      await client.query(
        `INSERT INTO search.navigation_contexts(
           navigation_context_id,click_id,click_request_id,owner_subject_kind,owner_subject_hash,
           query_id,result_version,result_item_id,project_id,position,channel,group_id,ranking_version,
           page_cursor_hash,source_page,metric_subject_id,subject_kind,bridge_version,request_hash,
           transaction_id,status,expires_at,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'active',$21,$22)`,
        [navigationContextId,clickId,input.clickRequestId,input.subjectKind,input.subjectHash,
          input.token.queryId,input.token.resultVersion,input.token.resultItemId,input.token.projectId,
          input.token.position,input.token.channel,input.token.groupId,input.token.rankingVersion,
          input.token.pageCursorHash,input.sourcePage,input.metricSubjectId,input.subjectKind,
          input.bridgeVersion,input.requestHash,transactionId,expiresAt,input.now],
      )
      const payload={
        event_name:'feed_item_clicked',event_version:2,actor_type:'service',
        attestation_type:'service_attested',metric_subject_id:input.metricSubjectId,
        subject_kind:input.subjectKind,bridge_version:input.bridgeVersion,item_type:'project',
        item_id:input.token.projectId,project_id:input.token.projectId,position:input.token.position,
        channel:input.token.channel,click_id:clickId,query_id:input.token.queryId,
        result_version:input.token.resultVersion,result_item_id:input.token.resultItemId,
        group_id:input.token.groupId,ranking_version:input.token.rankingVersion,
        navigation_context_id:navigationContextId,source_page:input.sourcePage,
        page_cursor_hash:input.token.pageCursorHash,service_actor_id:'search-navigation',transaction_id:transactionId,
      }
      await client.query(
        `INSERT INTO ops.outbox_events(outbox_id,event_id,aggregate_type,aggregate_id,event_name,
           event_version,payload_json,transaction_id,status,next_attempt_at,created_at)
         VALUES($1,$2,'search_navigation',$3,'feed_item_clicked',2,$4::jsonb,$5,'pending',$6,$6)`,
        [randomUUID(),clickId,navigationContextId,JSON.stringify(payload),transactionId,input.now],
      )
      return Object.freeze({
        navigation_context_id:navigationContextId,click_id:clickId,project_id:input.token.projectId,
        result_item_id:input.token.resultItemId,position:input.token.position,channel:input.token.channel,
        group_id:input.token.groupId,ranking_version:input.token.rankingVersion,
        expires_at:expiresAt.toISOString(),
        navigation_url:`/project/${input.token.projectId}?navigation_context_id=${navigationContextId}`,
        deduplicated:false,
      })
    })
  }

  async consumeNavigationContext(input: ConsumeNavigationContextStoreInput): Promise<SearchAttributionContext|null> {
    const outcome=await begin(this.pool,async(client)=>{
      const result=await client.query<{
        navigation_context_id:string;click_id:string;owner_subject_hash:Buffer;query_id:string;
        result_version:string;result_item_id:string;project_id:string;position:number;
        channel:'search_exact'|'search_adjacent';group_id:'exact'|'adjacent';ranking_version:string;
        source_page:'P05'|'P07';metric_subject_id:string;subject_kind:'anonymous'|'user';
        bridge_version:number;transaction_id:string;status:'active'|'consumed'|'expired';expires_at:Date
      }>(`SELECT * FROM search.navigation_contexts WHERE navigation_context_id=$1 FOR UPDATE`,[input.navigationContextId])
      const row=result.rows[0]
      if(!row)return Object.freeze({kind:'not_found' as const})
      if(!row.owner_subject_hash.equals(input.subjectHash))return Object.freeze({kind:'forbidden' as const})
      if(row.project_id!==input.projectId)return Object.freeze({kind:'mismatch' as const})
      if(row.status==='consumed')return Object.freeze({kind:'consumed' as const})
      if(row.status==='expired')return Object.freeze({kind:'expired' as const})
      if(row.expires_at<=input.now){
        await client.query(`UPDATE search.navigation_contexts SET status='expired' WHERE navigation_context_id=$1`,[row.navigation_context_id])
        return Object.freeze({kind:'expired' as const})
      }
      const current=await client.query<{review_status:string}>(
        `SELECT review_status FROM catalog.projects WHERE project_id=$1`,[row.project_id],
      )
      if(!current.rows[0]||!['published_platform','published_author'].includes(current.rows[0].review_status)){
        return Object.freeze({kind:'project_unavailable' as const})
      }
      await client.query(
        `UPDATE search.navigation_contexts SET status='consumed',consumed_at=$2 WHERE navigation_context_id=$1`,
        [row.navigation_context_id,input.now],
      )
      const eventId=randomUUID()
      const consumeTransactionId=randomUUID()
      const payload={
        event_name:'project_viewed',event_version:2,actor_type:'service',
        attestation_type:'service_attested',metric_subject_id:row.metric_subject_id,
        subject_kind:row.subject_kind,bridge_version:row.bridge_version,project_id:row.project_id,
        item_id:row.project_id,click_id:row.click_id,query_id:row.query_id,
        result_version:row.result_version,result_item_id:row.result_item_id,position:row.position,
        channel:row.channel,group_id:row.group_id,ranking_version:row.ranking_version,
        navigation_context_id:row.navigation_context_id,source_page:row.source_page,
        service_actor_id:'search-navigation',transaction_id:consumeTransactionId,
      }
      await client.query(
        `INSERT INTO ops.outbox_events(outbox_id,event_id,aggregate_type,aggregate_id,event_name,
           event_version,payload_json,transaction_id,status,next_attempt_at,created_at)
         VALUES($1,$2,'search_navigation',$3,'project_viewed',2,$4::jsonb,$5,'pending',$6,$6)`,
        [randomUUID(),eventId,row.navigation_context_id,JSON.stringify(payload),consumeTransactionId,input.now],
      )
      return Object.freeze({kind:'attributed' as const,value:Object.freeze({
        navigation_context_id:row.navigation_context_id,click_id:row.click_id,query_id:row.query_id,
        result_version:row.result_version,result_item_id:row.result_item_id,project_id:row.project_id,
        position:row.position,channel:row.channel,group_id:row.group_id,
        ranking_version:row.ranking_version,source_page:row.source_page,
        metric_subject_id:row.metric_subject_id,subject_kind:row.subject_kind,bridge_version:row.bridge_version,
      })})
    })
    if(outcome.kind==='attributed')return outcome.value
    if(outcome.kind==='consumed')return null
    if(outcome.kind==='not_found')throw searchError('SEARCH_NAVIGATION_NOT_FOUND',404)
    if(outcome.kind==='forbidden')throw searchError('SEARCH_NAVIGATION_FORBIDDEN',403)
    if(outcome.kind==='mismatch')throw searchError('SEARCH_NAVIGATION_PROJECT_MISMATCH',422)
    if(outcome.kind==='project_unavailable')throw searchError('PROJECT_NOT_PUBLIC',410)
    throw searchError('SEARCH_NAVIGATION_EXPIRED',410)
  }
}
