import assert from 'node:assert/strict'

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

try {
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

  await assert.rejects(
    service.search(Object.freeze({ ...command, query: null, queryId: created.query_id }), Object.freeze({
      kind: 'anonymous',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_FORBIDDEN',
  )

  const expiredService = new SearchService({
    store,
    config,
    now: () => new Date(Date.parse(created.expires_at) + 1),
  })
  await assert.rejects(
    expiredService.search(Object.freeze({ ...command, query: null, queryId: created.query_id }), owner),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_GONE',
  )

  process.stdout.write(JSON.stringify({
    result: 'verified',
    query_id: created.query_id,
    result_version: created.result_version,
    exact_count: created.exact_count,
    semantic_degraded: created.semantic_degraded,
  }) + '\n')
} finally {
  await pool.end()
}
