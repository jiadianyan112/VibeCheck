import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ComparisonConfig } from '@vibecheck/config'

import { ComparisonError } from './errors.js'
import { ComparisonService } from './service.js'
import type { ComparisonStore } from './store-port.js'
import type {
  ComparisonMutationProjection,
  ComparisonProgressProjection,
  ComparisonProjection,
} from './types.js'

const comparisonId = '10000000-0000-4000-8000-000000000001'
const projectId = '20000000-0000-4000-8000-000000000001'
const subjectId = '30000000-0000-4000-8000-000000000001'
const requestId = '40000000-0000-4000-8000-000000000001'
const eventId = '50000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-12T00:00:00.000Z')

const config: ComparisonConfig = Object.freeze({
  enabled: true,
  subjectHashPepper: 'comparison-subject-hash-pepper-at-least-32-characters',
  subjectCookieSecret: 'comparison-subject-cookie-secret-at-least-32-characters',
  anonymousTtlSeconds: 604_800,
  maximumVisibleMsPerEvent: 60_000,
})

const projection: ComparisonProjection = Object.freeze({
  comparison_id: comparisonId,
  comparison_version: 1,
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  ordered_project_ids: Object.freeze([projectId]),
  items: Object.freeze([]),
  valid_count: 1,
  invalid_count: 0,
  dimension_groups: Object.freeze(['audience', 'problem', 'workflow', 'capabilities']),
  dimension_groups_viewed: Object.freeze([]),
  visible_duration_ms: 0,
  saved_at: null,
  completed_at: null,
  expires_at: '2026-08-19T00:00:00.000Z',
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
})

class FakeStore implements ComparisonStore {
  putInput: Parameters<ComparisonStore['putComparison']>[0] | null = null
  progressInput: Parameters<ComparisonStore['recordDimensionProgress']>[0] | null = null
  saveInput: Parameters<ComparisonStore['setSaved']>[0] | null = null

  async getComparison(): Promise<ComparisonProjection> {
    return projection
  }

  async putComparison(
    input: Parameters<ComparisonStore['putComparison']>[0],
  ): Promise<ComparisonMutationProjection> {
    this.putInput = input
    return Object.freeze({ ...projection, mutation_result: 'created' })
  }

  async setSaved(
    input: Parameters<ComparisonStore['setSaved']>[0],
  ): Promise<ComparisonProjection> {
    this.saveInput = input
    return projection
  }

  async recordDimensionProgress(
    input: Parameters<ComparisonStore['recordDimensionProgress']>[0],
  ): Promise<ComparisonProgressProjection> {
    this.progressInput = input
    return Object.freeze({
      comparison_id: comparisonId,
      comparison_version: 1,
      dimension_groups_viewed: Object.freeze(['audience']),
      visible_duration_ms: input.visibleMs,
      completed_at: null,
      completed_now: false,
      deduplicated: false,
    })
  }
}

async function failure(
  run: () => Promise<unknown> | unknown,
  code: string,
  status: number,
): Promise<ComparisonError> {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof ComparisonError)
    assert.equal(error.code, code)
    assert.equal(error.httpStatus, status)
    return error
  }
  assert.fail('Expected ComparisonError')
}

describe('ComparisonService membership commands', () => {
  it('normalizes one new anonymous comparison and binds request/owner hashes', async () => {
    const store = new FakeStore()
    const service = new ComparisonService({ store, config, now: () => now })
    const result = await service.putComparison({
      comparisonId: comparisonId.toUpperCase(),
      orderedProjectIds: [projectId.toUpperCase()],
      expectedVersion: 0,
      clientRequestId: requestId,
      subject: { kind: 'anonymous', id: subjectId },
    })
    assert.equal(result.mutation_result, 'created')
    assert.equal(store.putInput?.comparisonId, comparisonId)
    assert.deepEqual(store.putInput?.orderedProjectIds, [projectId])
    assert.equal(store.putInput?.subjectHash.length, 32)
    assert.equal(store.putInput?.anonymousExpiresAt.toISOString(), '2026-08-19T00:00:00.000Z')
    assert.match(store.putInput?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('rejects six, duplicate, and empty-create lists before touching the store', async () => {
    const store = new FakeStore()
    const service = new ComparisonService({ store, config, now: () => now })
    const six = Array.from({ length: 6 }, (_, index) => (
      `20000000-0000-4000-8000-00000000000${index + 1}`
    ))
    const overLimit = await failure(() => service.putComparison({
      comparisonId,
      orderedProjectIds: six,
      expectedVersion: 1,
      clientRequestId: requestId,
      subject: { kind: 'anonymous', id: subjectId },
    }), 'COMPARISON_ITEM_LIMIT_EXCEEDED', 409)
    assert.deepEqual(overLimit.details, { maximum_count: 5, requested_count: 6 })
    await failure(() => service.putComparison({
      comparisonId,
      orderedProjectIds: [projectId, projectId],
      expectedVersion: 1,
      clientRequestId: requestId,
      subject: { kind: 'anonymous', id: subjectId },
    }), 'COMPARISON_PROJECT_DUPLICATED', 422)
    await failure(() => service.putComparison({
      comparisonId,
      orderedProjectIds: [],
      expectedVersion: 0,
      clientRequestId: requestId,
      subject: { kind: 'anonymous', id: subjectId },
    }), 'COMPARISON_CREATE_REQUIRES_PROJECT', 422)
    assert.equal(store.putInput, null)
  })

  it('requires an authenticated owner to set saved state', async () => {
    const store = new FakeStore()
    const service = new ComparisonService({ store, config, now: () => now })
    await failure(() => service.setSaved({
      comparisonId,
      comparisonVersion: 1,
      state: true,
      subject: { kind: 'anonymous', id: subjectId },
      requestId: 'request_12345678',
    }), 'AUTHENTICATION_REQUIRED', 401)
    await service.setSaved({
      comparisonId,
      comparisonVersion: 1,
      state: true,
      subject: { kind: 'user', id: subjectId },
      requestId: 'request_12345678',
    })
    assert.equal(store.saveInput?.state, true)
  })
})

describe('ComparisonService trusted progress input', () => {
  it('accepts a bounded visible dimension event and rejects untrusted time/bounds', async () => {
    const store = new FakeStore()
    const service = new ComparisonService({ store, config, now: () => now })
    await service.recordDimensionProgress({
      eventId,
      comparisonId,
      comparisonVersion: 1,
      dimensionGroup: 'workflow',
      visibleMs: 7_500,
      viewSequence: 1,
      occurredAt: now.toISOString(),
      subject: { kind: 'anonymous', id: subjectId },
    })
    assert.equal(store.progressInput?.visibleMs, 7_500)
    assert.equal(store.progressInput?.dimensionGroup, 'workflow')

    await failure(() => service.recordDimensionProgress({
      eventId,
      comparisonId,
      comparisonVersion: 1,
      dimensionGroup: 'workflow',
      visibleMs: 999,
      viewSequence: 1,
      occurredAt: now.toISOString(),
      subject: { kind: 'anonymous', id: subjectId },
    }), 'COMPARISON_PROGRESS_INVALID', 422)
    await failure(() => service.recordDimensionProgress({
      eventId,
      comparisonId,
      comparisonVersion: 1,
      dimensionGroup: 'bad group',
      visibleMs: 1_000,
      viewSequence: 1,
      occurredAt: now.toISOString(),
      subject: { kind: 'anonymous', id: subjectId },
    }), 'COMPARISON_DIMENSION_INVALID', 422)
    await failure(() => service.recordDimensionProgress({
      eventId,
      comparisonId,
      comparisonVersion: 1,
      dimensionGroup: 'workflow',
      visibleMs: 1_000,
      viewSequence: 1,
      occurredAt: '2026-08-20T00:00:00.000Z',
      subject: { kind: 'anonymous', id: subjectId },
    }), 'COMPARISON_PROGRESS_TIME_INVALID', 422)
  })
})
