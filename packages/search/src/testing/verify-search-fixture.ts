import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import { SearchError } from '../errors.js'
import { SearchService } from '../service.js'
import { PostgresSearchStore } from '../store.js'
import type { SearchCommand, SearchServiceConfig, SearchSubject } from '../types.js'

if (process.env.NODE_ENV === 'production') throw new Error('SEARCH_FIXTURE_FORBIDDEN_IN_PRODUCTION')
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString })
const config: SearchServiceConfig = Object.freeze({
  encryptionMasterKey: Buffer.alloc(32, 12).toString('base64'),
  encryptionKeyVersion: 'ci-search-v1',
  subjectHashPepper: 'ci-search-subject-hash-pepper-at-least-32-characters',
  resultTokenSecret: 'ci-search-result-token-secret-at-least-32-characters',
  snapshotTtlSeconds: 86_400,
  pageSize: 20,
  maximumStoredResults: 100,
  rawQueryLimit: 30,
  rawQueryRateWindowSeconds: 900,
})
const owner: SearchSubject = Object.freeze({
  kind: 'anonymous',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
})
const command: SearchCommand = Object.freeze({
  query: 'Northstar Portfolio',
  queryId: null,
  mode: 'search',
  categoryId: 'personal_site_portfolio',
  filters: Object.freeze({
    access_status: ['normal'],
    has_available_asset: true,
    category_fields: Object.freeze({ site_type: ['portfolio'] }),
  }),
  sort: 'relevance',
  cursor: null,
  locale: 'zh-CN',
  rateLimitKey: 'ci-loopback',
})

let fixtureStage = 'initialize'

function workflowAnnotation(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

try {
  fixtureStage = 'create_keyword_search'
  const store = new PostgresSearchStore(pool)
  const service = new SearchService({ store, config })
  const created = await service.search(command, owner)
  assert.equal(created.semantic_degraded, true)
  assert.equal(created.exact_count, 1)
  assert.equal(created.adjacent_count, 0)
  assert.equal(created.groups[0]?.group_id, 'exact')
  assert.equal(created.groups[0]?.items[0]?.project_id, '10000000-0000-4000-8000-000000000002')
  assert.equal(JSON.stringify(created).includes(command.query!), false)

  const replayed = await service.search(Object.freeze({
    ...command,
    query: null,
    queryId: created.query_id,
  }), owner)
  assert.equal(replayed.result_version, created.result_version)
  assert.deepEqual(replayed.groups, created.groups)

  fixtureStage = 'verify_learning_structured_fts'
  const learning = await service.search(Object.freeze({
    ...command,
    query: 'spaced_repetition',
    categoryId: 'ai_learning_quiz',
    filters: Object.freeze({
      access_status: ['normal'],
      category_fields: Object.freeze({
        target_users: ['self_directed_learners'],
        main_inputs: ['notes', 'pdf'],
      }),
      exclude_category_fields: Object.freeze({ use_scenarios: ['classroom_only'] }),
    }),
  }), owner)
  assert.equal(learning.exact_count, 1)
  assert.equal(learning.groups[0]?.items[0]?.project_id, '10000000-0000-4000-8000-000000000001')
  assert.ok(learning.groups[0]?.items[0]?.match_reason.matched_fields.includes('full_text'))

  fixtureStage = 'verify_portfolio_and_or_not_filters'
  const portfolio = await service.search(Object.freeze({
    ...command,
    query: 'showcase_work',
    filters: Object.freeze({
      access_status: ['normal'],
      category_fields: Object.freeze({
        site_type: ['portfolio', 'hybrid'],
        creator_roles: ['product_designer'],
        core_modules: ['case_study'],
      }),
      exclude_category_fields: Object.freeze({ core_modules: ['blog'] }),
    }),
  }), owner)
  assert.equal(portfolio.exact_count, 1)
  assert.equal(portfolio.groups[0]?.items[0]?.project_id, '10000000-0000-4000-8000-000000000002')
  assert.ok(portfolio.groups[0]?.items[0]?.match_reason.matched_fields.includes('category_data'))

  fixtureStage = 'verify_search_config_and_indexes'
  const searchConfig = await pool.query<{ category_id: string; filters: string[] }>(
    `SELECT category_id,ARRAY(
       SELECT jsonb_array_elements_text(search_field_map->'filters')
     ) AS filters
     FROM taxonomy.category_schema_versions
     WHERE (category_id,schema_version) IN (
       ('ai_learning_quiz','learning.v1'),
       ('personal_site_portfolio','portfolio.v1')
     )
     ORDER BY category_id`,
  )
  assert.deepEqual(searchConfig.rows, [
    {
      category_id: 'ai_learning_quiz',
      filters: ['target_users', 'use_scenarios', 'main_inputs', 'main_outputs'],
    },
    {
      category_id: 'personal_site_portfolio',
      filters: ['site_type', 'creator_roles', 'primary_goals', 'page_model', 'core_modules'],
    },
  ])
  const indexNames = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='search' AND tablename='project_documents'`,
  )
  assert.ok(indexNames.rows.some(({ indexname }) => indexname === 'project_documents_search_idx'))
  assert.ok(indexNames.rows.some(({ indexname }) => indexname === 'project_documents_structured_idx'))
  await assert.rejects(
    () => pool.query(
      `UPDATE search.project_documents SET category_id='ai_learning_quiz'
       WHERE project_id='10000000-0000-4000-8000-000000000002'`,
    ),
    /project_documents_structured_identity_valid|SEARCH_DOCUMENT_CATEGORY_MISMATCH/,
  )

  fixtureStage = 'recover_query_snapshot'
  const recovered = await service.getQuerySnapshot(created.query_id, owner, 'fixture_query_read')
  assert.equal(recovered.input_state, 'not_restored')
  assert.equal(recovered.notice_key, 'search.conditions_restored')
  assert.equal(recovered.version, 1)
  assert.equal(JSON.stringify(recovered).includes(command.query!), false)

  fixtureStage = 'verify_empty_search'
  const empty = await service.search(Object.freeze({
    ...command,
    query: 'term-with-no-synthetic-fixture-match-987654321',
    filters: Object.freeze({
      category_fields: Object.freeze({ site_type: ['portfolio'] }),
      exclude_category_fields: Object.freeze({ site_type: ['portfolio'] }),
    }),
  }), owner)
  assert.equal(empty.exact_count, 0)
  assert.equal(empty.adjacent_count, 0)
  assert.deepEqual(empty.groups, [])

  fixtureStage = 'verify_encrypted_storage'
  const stored = await pool.query<{
    raw_query_ciphertext: Buffer
    owner_subject_hash: Buffer
    intent_json: unknown
    filter_snapshot_json: unknown
  }>(
    `SELECT snapshot.raw_query_ciphertext,snapshot.owner_subject_hash,
       intent.intent_json,result.filter_snapshot_json
     FROM search.query_snapshots snapshot
     JOIN search.intent_versions intent ON intent.query_id=snapshot.query_id AND intent.intent_version=1
     JOIN search.result_versions result ON result.query_id=snapshot.query_id
     WHERE snapshot.query_id=$1`,
    [created.query_id],
  )
  assert.equal(stored.rows.length, 1)
  assert.equal(stored.rows[0]!.owner_subject_hash.length, 32)
  assert.equal(stored.rows[0]!.raw_query_ciphertext.includes(Buffer.from(command.query!, 'utf8')), false)
  assert.equal(JSON.stringify(stored.rows[0]!.intent_json).includes(command.query!), false)
  assert.equal(JSON.stringify(stored.rows[0]!.filter_snapshot_json).includes(command.query!), false)

  fixtureStage = 'verify_cross_subject_access'
  await assert.rejects(
    service.search(Object.freeze({ ...command, query: null, queryId: created.query_id }), Object.freeze({
      kind: 'anonymous',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_FORBIDDEN',
  )
  await assert.rejects(
    service.getQuerySnapshot(created.query_id, Object.freeze({
      kind: 'anonymous',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }), 'fixture_cross_subject_read'),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_FORBIDDEN',
  )

  fixtureStage = 'verify_expired_access'
  const expiredService = new SearchService({
    store,
    config,
    now: () => new Date(Date.parse(created.expires_at) + 1),
  })
  await assert.rejects(
    expiredService.search(Object.freeze({ ...command, query: null, queryId: created.query_id }), owner),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_GONE',
  )

  fixtureStage = 'link_query_identity'
  const userId = randomUUID()
  const identityLinkId = randomUUID()
  const authFlowId = randomUUID()
  await pool.query(`INSERT INTO iam.users (user_id,status,role_version,privacy_state)
                    VALUES ($1,'active',1,'active')`, [userId])
  await pool.query(
    `INSERT INTO iam.identity_links (
       identity_link_id,anonymous_subject_id,user_id,auth_flow_id,purpose,status,issued_at,expires_at
     ) VALUES ($1,$2,$3,$4,'query_continuation','active',now(),now()+interval '5 minutes')`,
    [identityLinkId, owner.id, userId, authFlowId],
  )
  const userSubject: SearchSubject = Object.freeze({ kind: 'user', id: userId })
  const linked = await service.linkQuery(created.query_id, {
    identityLinkId,
    expectedVersion: 1,
    operationId: randomUUID(),
  }, userSubject, 'fixture_query_link')
  assert.equal(linked.authorized, true)
  assert.equal(linked.version, 2)
  assert.equal(linked.expires_at, created.expires_at)
  assert.equal((await service.getQuerySnapshot(
    created.query_id,
    userSubject,
    'fixture_linked_read',
  )).version, 2)

  fixtureStage = 'unlink_query_identity'
  await service.unlinkQuery(created.query_id, {
    expectedVersion: 2,
    operationId: randomUUID(),
  }, userSubject, 'fixture_query_unlink')
  await service.unlinkQuery(created.query_id, {
    expectedVersion: 2,
    operationId: randomUUID(),
  }, userSubject, 'fixture_query_unlink_repeat')
  await assert.rejects(
    service.getQuerySnapshot(created.query_id, userSubject, 'fixture_unlinked_read'),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_FORBIDDEN',
  )
  assert.equal((await service.getQuerySnapshot(
    created.query_id,
    owner,
    'fixture_owner_after_unlink',
  )).version, 3)

  fixtureStage = 'invalidate_query_snapshot'
  await service.invalidateQuery(created.query_id, {
    operationId: randomUUID(),
  }, owner, 'fixture_query_invalidate')
  await service.invalidateQuery(created.query_id, {
    operationId: randomUUID(),
  }, owner, 'fixture_query_invalidate_repeat')
  await assert.rejects(
    service.getQuerySnapshot(created.query_id, owner, 'fixture_invalidated_read'),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_GONE',
  )
  fixtureStage = 'verify_query_lifecycle_storage'
  const lifecycle = await pool.query<{
    status: string
    owner_subject_hash: Buffer
    expires_at: Date
    encrypted_data_key: Buffer | null
    raw_query_ciphertext: Buffer | null
    link_status: string
    audit_count: number
  }>(
    `SELECT snapshot.status,snapshot.owner_subject_hash,snapshot.expires_at,
       snapshot.encrypted_data_key,snapshot.raw_query_ciphertext,link.status AS link_status,
       (SELECT count(*)::integer FROM audit.security_events event
        WHERE event.target_type='query_snapshot'
          AND event.target_id_hash=digest($1::text,'sha256')) AS audit_count
     FROM search.query_snapshots snapshot
     JOIN iam.identity_links link ON link.identity_link_id=$2::uuid
     WHERE snapshot.query_id=$1::uuid`,
    [created.query_id, identityLinkId],
  )
  assert.equal(lifecycle.rows[0]!.status, 'invalidated')
  assert.ok(lifecycle.rows[0]!.owner_subject_hash.equals(stored.rows[0]!.owner_subject_hash))
  assert.equal(lifecycle.rows[0]!.expires_at.toISOString(), created.expires_at)
  assert.equal(lifecycle.rows[0]!.encrypted_data_key, null)
  assert.equal(lifecycle.rows[0]!.raw_query_ciphertext, null)
  assert.equal(lifecycle.rows[0]!.link_status, 'consumed')
  assert.ok(lifecycle.rows[0]!.audit_count >= 8)

  process.stdout.write(JSON.stringify({
    result: 'verified',
    query_id: created.query_id,
    result_version: created.result_version,
    exact_count: created.exact_count,
    semantic_degraded: created.semantic_degraded,
    lifecycle: 'verified',
  }) + '\n')
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(
    `::error title=Search fixture ${workflowAnnotation(fixtureStage)}::${workflowAnnotation(detail)}\n`,
  )
  throw error
} finally {
  await pool.end()
}
