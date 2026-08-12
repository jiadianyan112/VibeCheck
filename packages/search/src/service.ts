import { randomUUID } from 'node:crypto'

import type { CategoryId } from '@vibecheck/catalog'

import { SearchCrypto } from './crypto.js'
import { searchError } from './errors.js'
import type { SearchStore, StoredQuerySnapshot, StoredSearchExecution } from './store.js'
import type {
  SearchCommand,
  SearchProjection,
  QueryInvalidationCommand,
  QueryLinkCommand,
  QueryLinkProjection,
  QueryMutationCommand,
  QuerySnapshotProjection,
  SearchResultGroup,
  SearchResultItem,
  SearchServiceConfig,
  SearchSubject,
} from './types.js'
import {
  normalizeRawQuery,
  parseCategoryId,
  parseLocale,
  parseQueryId,
  parseSearchFilters,
  parseSearchMode,
  parseSearchSort,
  queryLengthBucket,
} from './validation.js'

const parserVersion = 'keyword.v1' as const
const rankingVersion = 'search.keyword.v1' as const

export interface SearchServiceDependencies {
  readonly store: SearchStore
  readonly config: SearchServiceConfig
  readonly now?: () => Date
}

interface CursorPayload {
  readonly type: 'search_cursor.v1'
  readonly query_id: string
  readonly result_version: string
  readonly offset: number
  readonly expires_at: number
}

function cursorPayload(value: Readonly<Record<string, unknown>>): CursorPayload {
  if (
    value.type !== 'search_cursor.v1' || typeof value.query_id !== 'string' ||
    typeof value.result_version !== 'string' || typeof value.offset !== 'number' ||
    !Number.isSafeInteger(value.offset) || value.offset < 1 || typeof value.expires_at !== 'number'
  ) throw searchError('SEARCH_CURSOR_INVALID', 400)
  return value as unknown as CursorPayload
}

function queryEncryption(snapshot: StoredQuerySnapshot) {
  return Object.freeze({
    encryptedDataKey: snapshot.encrypted_data_key,
    dataKeyIv: snapshot.data_key_iv,
    dataKeyAuthTag: snapshot.data_key_auth_tag,
    ciphertext: snapshot.raw_query_ciphertext,
    iv: snapshot.raw_query_iv,
    authTag: snapshot.raw_query_auth_tag,
  })
}

function operationUuid(name: string, value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw searchError(`${name}_INVALID`, 422)
  }
  return value.toLowerCase()
}

function expectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw searchError('EXPECTED_VERSION_INVALID', 422)
  return value
}

export class SearchService {
  private readonly crypto: SearchCrypto
  private readonly now: () => Date

  constructor(private readonly dependencies: SearchServiceDependencies) {
    const { config } = dependencies
    if (
      config.snapshotTtlSeconds < 60 || config.snapshotTtlSeconds > 86_400 ||
      config.pageSize < 1 || config.pageSize > 50 ||
      config.maximumStoredResults < config.pageSize || config.maximumStoredResults > 500 ||
      config.rawQueryLimit < 1 || config.rawQueryRateWindowSeconds < 60
    ) throw new Error('SEARCH_CONFIG_INVALID')
    this.crypto = new SearchCrypto(
      config.encryptionMasterKey,
      config.encryptionKeyVersion,
      config.subjectHashPepper,
      config.resultTokenSecret,
    )
    this.now = dependencies.now ?? (() => new Date())
  }

  async search(command: SearchCommand, subject: SearchSubject): Promise<SearchProjection> {
    const mode = parseSearchMode(command.mode)
    if (mode !== 'search') throw searchError('SEARCH_DISCOVER_NOT_IMPLEMENTED', 501)
    const sort = parseSearchSort(command.sort)
    const requestedCategoryId = parseCategoryId(command.categoryId)
    const locale = parseLocale(command.locale)
    const hasRawQuery = command.query !== null
    const hasQueryId = command.queryId !== null
    if (hasRawQuery === hasQueryId) throw searchError('SEARCH_QUERY_SOURCE_INVALID', 422)
    if (hasRawQuery && command.cursor !== null) throw searchError('SEARCH_CURSOR_INVALID', 400)

    const subjectHash = this.crypto.subjectHash(subject)
    const now = this.now()
    if (hasRawQuery) {
      const rawQuery = normalizeRawQuery(command.query!)
      const filters = parseSearchFilters(command.filters, requestedCategoryId)
      const windowMilliseconds = this.dependencies.config.rawQueryRateWindowSeconds * 1_000
      const windowStartedAt = new Date(Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds)
      const windowEndsAt = new Date(windowStartedAt.getTime() + windowMilliseconds)
      const rateLimit = await this.dependencies.store.consumeRawQueryRateLimit({
        bucketKeyHash: this.crypto.rateLimitHash(
          `${subject.kind}:${subject.id}:${command.rateLimitKey}:${windowStartedAt.toISOString()}`,
        ),
        windowStartedAt,
        windowEndsAt,
        limit: this.dependencies.config.rawQueryLimit,
      })
      if (!rateLimit.allowed) {
        throw searchError('SEARCH_RATE_LIMITED', 429, true, rateLimit.retryAfterSeconds)
      }

      const queryId = randomUUID()
      const expiresAt = new Date(now.getTime() + this.dependencies.config.snapshotTtlSeconds * 1_000)
      const fingerprint = this.crypto.fingerprint({
        category_id: requestedCategoryId,
        filters,
        sort,
        ranking_version: rankingVersion,
      })
      const execution = await this.dependencies.store.createSearch({
        queryId,
        subjectKind: subject.kind,
        subjectHash,
        encryptedQuery: this.crypto.encryptQuery(queryId, rawQuery, subjectHash),
        encryptionKeyVersion: this.crypto.keyVersion(),
        queryHash: this.crypto.queryHash(rawQuery),
        queryLengthBucket: queryLengthBucket([...rawQuery].length),
        rawQuery,
        mode,
        categoryId: requestedCategoryId,
        locale,
        expiresAt,
        requestFingerprint: fingerprint,
        filters,
        sort,
        maximumStoredResults: this.dependencies.config.maximumStoredResults,
        pageSize: this.dependencies.config.pageSize,
      })
      return this.projection(execution, subjectHash, null)
    }

    const queryId = parseQueryId(command.queryId!)
    const access = await this.dependencies.store.getAuthorizedQuery(queryId, subjectHash, now)
    if (access.kind === 'missing') throw searchError('QUERY_NOT_FOUND', 404)
    if (access.kind === 'forbidden') throw searchError('QUERY_FORBIDDEN', 403)
    if (access.kind === 'gone') throw searchError('QUERY_GONE', 410)
    const snapshot = access.snapshot!
    if (snapshot.mode !== mode) throw searchError('SEARCH_MODE_CONFLICT', 409)
    const categoryId = this.categoryForReplay(snapshot.category_id, requestedCategoryId)
    const filters = command.filters === undefined
      ? snapshot.active_filter_snapshot ?? parseSearchFilters(undefined, categoryId)
      : parseSearchFilters(command.filters, categoryId)
    const fingerprint = this.crypto.fingerprint({
      category_id: categoryId,
      filters,
      sort,
      ranking_version: rankingVersion,
    })
    const decodedCursor = command.cursor === null
      ? null
      : cursorPayload(this.crypto.verifyOpaquePayload(command.cursor, subjectHash))
    if (
      decodedCursor !== null &&
      (decodedCursor.query_id !== queryId || decodedCursor.expires_at <= now.getTime())
    ) throw searchError('SEARCH_CURSOR_INVALID', 400)
    const rawQuery = normalizeRawQuery(this.crypto.decryptQuery(
      queryId,
      queryEncryption(snapshot),
      snapshot.encryption_key_version,
      snapshot.owner_subject_hash,
    ))
    const execution = await this.dependencies.store.searchExisting({
      snapshot,
      subjectHash,
      rawQuery,
      categoryId,
      requestFingerprint: fingerprint,
      filters,
      sort,
      maximumStoredResults: this.dependencies.config.maximumStoredResults,
      pageSize: this.dependencies.config.pageSize,
      offset: decodedCursor?.offset ?? 0,
      expectedResultVersion: decodedCursor?.result_version ?? null,
      now,
    })
    return this.projection(execution, subjectHash, command.cursor)
  }

  async getQuerySnapshot(
    queryIdValue: string,
    subject: SearchSubject,
    requestId: string,
  ): Promise<QuerySnapshotProjection> {
    const queryId = parseQueryId(queryIdValue)
    const stored = await this.dependencies.store.readQuerySnapshot({
      queryId,
      subjectKind: subject.kind,
      subjectHash: this.crypto.subjectHash(subject),
      requestId,
      now: this.now(),
    })
    return Object.freeze({
      query_id: stored.queryId,
      mode: stored.mode,
      category_id: stored.categoryId,
      intent: stored.intent,
      confidence: stored.confidence,
      intent_version: stored.intentVersion,
      parser_version: stored.parserVersion,
      result_version: stored.resultVersion,
      ranking_version: stored.rankingVersion,
      filters: stored.filters,
      sort: stored.sort,
      semantic_degraded: stored.semanticDegraded,
      exact_count: stored.exactCount,
      adjacent_count: stored.adjacentCount,
      version: stored.version,
      expires_at: stored.expiresAt.toISOString(),
      input_state: 'not_restored',
      notice_key: 'search.conditions_restored',
    })
  }

  async linkQuery(
    queryIdValue: string,
    command: QueryLinkCommand,
    subject: SearchSubject,
    requestId: string,
  ): Promise<QueryLinkProjection> {
    if (subject.kind !== 'user') throw searchError('AUTHENTICATION_REQUIRED', 401)
    const queryId = parseQueryId(queryIdValue)
    const identityLinkId = operationUuid('IDENTITY_LINK_ID', command.identityLinkId)
    const operationId = operationUuid('OPERATION_ID', command.operationId)
    const version = expectedVersion(command.expectedVersion)
    const link = await this.dependencies.store.getIdentityLink(identityLinkId)
    if (link === null) throw searchError('IDENTITY_LINK_NOT_FOUND', 404)
    const userSubjectHash = this.crypto.subjectHash(subject)
    const result = await this.dependencies.store.linkQuery({
      queryId,
      identityLinkId,
      anonymousSubjectId: link.anonymousSubjectId,
      anonymousSubjectHash: this.crypto.subjectHash({
        kind: 'anonymous',
        id: link.anonymousSubjectId,
      }),
      userId: subject.id,
      userSubjectHash,
      expectedVersion: version,
      operationId,
      requestHash: this.crypto.fingerprint({
        operation: 'link',
        query_id: queryId,
        identity_link_id: identityLinkId,
        expected_version: version,
      }),
      requestId,
      now: this.now(),
    })
    return Object.freeze({
      authorized: true,
      version: result.version,
      expires_at: result.expiresAt.toISOString(),
    })
  }

  async unlinkQuery(
    queryIdValue: string,
    command: QueryMutationCommand,
    subject: SearchSubject,
    requestId: string,
  ): Promise<void> {
    if (subject.kind !== 'user') throw searchError('AUTHENTICATION_REQUIRED', 401)
    const queryId = parseQueryId(queryIdValue)
    const operationId = operationUuid('OPERATION_ID', command.operationId)
    const version = expectedVersion(command.expectedVersion)
    const subjectHash = this.crypto.subjectHash(subject)
    await this.dependencies.store.unlinkQuery({
      queryId,
      subjectKind: subject.kind,
      subjectHash,
      expectedVersion: version,
      operationId,
      requestHash: this.crypto.fingerprint({
        operation: 'unlink',
        query_id: queryId,
        expected_version: version,
      }),
      requestId,
      now: this.now(),
    })
  }

  async invalidateQuery(
    queryIdValue: string,
    command: QueryInvalidationCommand,
    subject: SearchSubject,
    requestId: string,
  ): Promise<void> {
    const queryId = parseQueryId(queryIdValue)
    const operationId = operationUuid('OPERATION_ID', command.operationId)
    const subjectHash = this.crypto.subjectHash(subject)
    await this.dependencies.store.invalidateQuery({
      queryId,
      subjectKind: subject.kind,
      subjectHash,
      operationId,
      requestHash: this.crypto.fingerprint({
        operation: 'invalidate',
        query_id: queryId,
        subject_kind: subject.kind,
      }),
      requestId,
      now: this.now(),
    })
  }

  private categoryForReplay(
    snapshotCategoryId: CategoryId | null,
    requestedCategoryId: CategoryId | null,
  ): CategoryId | null {
    if (
      snapshotCategoryId !== null && requestedCategoryId !== null &&
      snapshotCategoryId !== requestedCategoryId
    ) throw searchError('SEARCH_CATEGORY_CONFLICT', 409)
    return requestedCategoryId ?? snapshotCategoryId
  }

  private projection(
    execution: StoredSearchExecution,
    subjectHash: Buffer,
    pageCursor: string | null,
  ): SearchProjection {
    const pageCursorHash = this.crypto.fingerprint(pageCursor ?? 'start').toString('hex')
    const byGroup = new Map<'exact' | 'adjacent', SearchResultItem[]>([
      ['exact', []],
      ['adjacent', []],
    ])
    for (const item of execution.items) {
      const token = this.crypto.signOpaquePayload(Object.freeze({
        type: 'search_result_item.v1',
        query_id: execution.queryId,
        result_version: execution.resultVersion,
        project_id: item.project_id,
        result_item_id: item.result_item_id,
        position: item.group_position,
        channel: item.channel,
        group_id: item.group_id,
        ranking_version: execution.rankingVersion,
        page_cursor_hash: pageCursorHash,
        expires_at: execution.expiresAt.getTime(),
      }), subjectHash)
      byGroup.get(item.group_id)!.push(Object.freeze({
        project_id: item.project_id,
        category_id: item.category_id,
        result_item_id: item.result_item_id,
        position: item.group_position,
        result_item_token: token,
        match_reason: item.reason_json,
      }))
    }
    const groups: SearchResultGroup[] = []
    for (const groupId of ['exact', 'adjacent'] as const) {
      const items = byGroup.get(groupId)!
      if (items.length === 0) continue
      groups.push(Object.freeze({
        group_id: groupId,
        channel: groupId === 'exact' ? 'search_exact' : 'search_adjacent',
        default_collapsed: groupId === 'adjacent' && execution.exactCount >= 3,
        items: Object.freeze(items),
      }))
    }
    const nextCursor = execution.nextOffset === null
      ? null
      : this.crypto.signOpaquePayload(Object.freeze({
          type: 'search_cursor.v1',
          query_id: execution.queryId,
          result_version: execution.resultVersion,
          offset: execution.nextOffset,
          expires_at: execution.expiresAt.getTime(),
        }), subjectHash)
    return Object.freeze({
      query_id: execution.queryId,
      intent_version: execution.intentVersion,
      parser_version: parserVersion,
      result_version: execution.resultVersion,
      ranking_version: rankingVersion,
      mode: 'search',
      category_id: execution.categoryId,
      filters: execution.filters,
      sort: execution.sort,
      semantic_degraded: true,
      exact_count: execution.exactCount,
      adjacent_count: execution.adjacentCount,
      groups: Object.freeze(groups),
      next_cursor: nextCursor,
      expires_at: execution.expiresAt.toISOString(),
    })
  }
}
