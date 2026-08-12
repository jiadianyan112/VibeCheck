import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SearchError } from './errors.js'
import { SearchService } from './service.js'
import type {
  CreateStoredSearchInput,
  ExistingStoredSearchInput,
  QueryAccessResult,
  SearchStore,
  StoredQuerySnapshot,
  StoredSearchExecution,
} from './store.js'
import type { SearchCommand, SearchSubject } from './types.js'

const now = new Date('2026-08-12T00:00:00.000Z')
const owner: SearchSubject = Object.freeze({
  kind: 'anonymous',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
})

function execution(input: CreateStoredSearchInput, nextOffset: number | null): StoredSearchExecution {
  return Object.freeze({
    queryId: input.queryId,
    intentVersion: 1,
    parserVersion: 'keyword.v1',
    resultVersion: '91000000-0000-4000-8000-000000000001',
    rankingVersion: 'search.keyword.v1',
    categoryId: input.categoryId,
    filters: input.filters,
    sort: input.sort,
    semanticDegraded: true,
    exactCount: 1,
    adjacentCount: nextOffset === null ? 0 : 1,
    expiresAt: input.expiresAt,
    items: Object.freeze([Object.freeze({
      project_id: '10000000-0000-4000-8000-000000000002',
      category_id: 'personal_site_portfolio',
      result_item_id: '92000000-0000-4000-8000-000000000001',
      group_id: 'exact',
      group_position: 1,
      global_position: 1,
      channel: 'search_exact',
      reason_json: Object.freeze({
        matched_fields: Object.freeze(['project_core.current_name']),
        unmatched_soft_fields: Object.freeze([]),
        relaxed_fields: Object.freeze([]),
        evidence_freshness: 'valid',
        reason_template_key: 'search.match.exact',
      }),
    })]),
    nextOffset,
  })
}

class FakeStore implements SearchStore {
  created: CreateStoredSearchInput | null = null
  access: QueryAccessResult = Object.freeze({ kind: 'missing' })
  rateAllowed = true

  async consumeRawQueryRateLimit() {
    return Object.freeze({ allowed: this.rateAllowed, retryAfterSeconds: 60 })
  }

  async createSearch(input: CreateStoredSearchInput): Promise<StoredSearchExecution> {
    this.created = input
    this.access = Object.freeze({
      kind: 'active',
      snapshot: Object.freeze({
        query_id: input.queryId,
        owner_subject_kind: input.subjectKind,
        owner_subject_hash: input.subjectHash,
        encrypted_data_key: input.encryptedQuery.encryptedDataKey,
        data_key_iv: input.encryptedQuery.dataKeyIv,
        data_key_auth_tag: input.encryptedQuery.dataKeyAuthTag,
        raw_query_ciphertext: input.encryptedQuery.ciphertext,
        raw_query_iv: input.encryptedQuery.iv,
        raw_query_auth_tag: input.encryptedQuery.authTag,
        encryption_key_version: input.encryptionKeyVersion,
        mode: input.mode,
        category_id: input.categoryId,
        active_intent_version: 1,
        status: 'active',
        expires_at: input.expiresAt,
        active_filter_snapshot: input.filters,
      } satisfies StoredQuerySnapshot),
    })
    return execution(input, 1)
  }

  async getAuthorizedQuery(): Promise<QueryAccessResult> {
    return this.access
  }

  async searchExisting(input: ExistingStoredSearchInput): Promise<StoredSearchExecution> {
    assert.equal(input.rawQuery, 'Northstar Portfolio')
    assert.equal(input.offset, 1)
    assert.deepEqual(input.filters.category_fields, { site_type: ['portfolio'] })
    return Object.freeze({ ...execution(this.created!, null), items: Object.freeze([]) })
  }
}

function service(store: SearchStore): SearchService {
  return new SearchService({
    store,
    config: Object.freeze({
      encryptionMasterKey: Buffer.alloc(32, 8).toString('base64'),
      encryptionKeyVersion: 'test-v1',
      subjectHashPepper: 'search-subject-hash-pepper-at-least-32-characters',
      resultTokenSecret: 'search-result-token-secret-at-least-32-characters',
      snapshotTtlSeconds: 86_400,
      pageSize: 1,
      maximumStoredResults: 10,
      rawQueryLimit: 30,
      rawQueryRateWindowSeconds: 900,
    }),
    now: () => now,
  })
}

function rawCommand(): SearchCommand {
  return Object.freeze({
    query: 'Northstar Portfolio',
    queryId: null,
    mode: 'search',
    categoryId: 'personal_site_portfolio',
    filters: { category_fields: { site_type: ['portfolio'] } },
    sort: 'relevance',
    cursor: null,
    locale: 'zh-CN',
    rateLimitKey: '127.0.0.1',
  })
}

test('raw keyword search creates an encrypted owner-bound snapshot and omits plaintext from projection', async () => {
  const store = new FakeStore()
  const result = await service(store).search(rawCommand(), owner)
  assert.equal(result.semantic_degraded, true)
  assert.equal(result.groups[0]?.items[0]?.position, 1)
  assert.ok(result.next_cursor)
  assert.equal(JSON.stringify(result).includes('Northstar Portfolio'), false)
  assert.equal(store.created?.rawQuery, 'Northstar Portfolio')
  assert.equal(store.created?.encryptedQuery.ciphertext.includes(Buffer.from('Northstar Portfolio')), false)

  const replay = await service(store).search(Object.freeze({
    ...rawCommand(),
    query: null,
    queryId: result.query_id,
    cursor: result.next_cursor,
    filters: undefined,
  }), owner)
  assert.equal(replay.result_version, result.result_version)
})

test('expired query snapshots and discover mode fail explicitly', async () => {
  const store = new FakeStore()
  store.access = Object.freeze({ kind: 'gone' })
  await assert.rejects(
    service(store).search(Object.freeze({
      ...rawCommand(),
      query: null,
      queryId: '90000000-0000-4000-8000-000000000001',
    }), owner),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_GONE',
  )
  await assert.rejects(
    service(store).search(Object.freeze({ ...rawCommand(), mode: 'discover' }), owner),
    (error: unknown) => error instanceof SearchError && error.code === 'SEARCH_DISCOVER_NOT_IMPLEMENTED',
  )
})

test('raw query rate limiting fails before a QuerySnapshot is created', async () => {
  const store = new FakeStore()
  store.rateAllowed = false
  await assert.rejects(
    service(store).search(rawCommand(), owner),
    (error: unknown) => error instanceof SearchError &&
      error.code === 'SEARCH_RATE_LIMITED' && error.retryAfterSeconds === 60,
  )
  assert.equal(store.created, null)
})
