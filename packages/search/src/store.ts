import { createHash, randomUUID } from 'node:crypto'

import type { CategoryId } from '@vibecheck/catalog'
import type { Pool, PoolClient } from 'pg'

import type { EncryptedQuery } from './crypto.js'
import { searchError } from './errors.js'
import type { SearchFilters, SearchMatchReason, SearchMode, SearchSort } from './types.js'

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
}
