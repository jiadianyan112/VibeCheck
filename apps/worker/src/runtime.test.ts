import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { runWorkerCycle, type OutboxStore } from './runtime.js'

function event(name: string, outboxId: string): OutboxEvent {
  return Object.freeze({
    outboxId,
    eventId: `event-${outboxId}`,
    aggregateType: 'project',
    aggregateId: 'project-1',
    eventName: name,
    eventVersion: 1,
    payload: Object.freeze({}),
    transactionId: 'transaction-1',
    attemptCount: 1,
  })
}

test('worker publishes handled events and retries deterministic failures', async () => {
  const published: string[] = []
  const retried: Array<readonly [string, string]> = []
  const events = [event('project.updated', 'outbox-1'), event('project.updated', 'outbox-2')]
  const store: OutboxStore = {
    requeueExpired: async () => 1,
    requeueExpiredReviewClaims: async () => 2,
    claim: async (_workerId, names, limit) => {
      assert.deepEqual(names, ['project.updated'])
      assert.equal(limit, 25)
      return events
    },
    markPublished: async (id) => {
      published.push(id)
    },
    markRetry: async (id, code) => {
      retried.push([id, code])
    },
  }
  const handlers = new Map([
    ['project.updated', async (item: OutboxEvent) => {
      if (item.outboxId === 'outbox-2') throw new Error('INDEX_TEMPORARILY_UNAVAILABLE')
    }],
  ])

  const result = await runWorkerCycle(store, 'worker-1', handlers, 25)

  assert.deepEqual(result, {
    requeued: 1, reviewClaimsRequeued: 2, claimed: 2, published: 1, failed: 1,
  })
  assert.deepEqual(published, ['outbox-1'])
  assert.deepEqual(retried, [['outbox-2', 'INDEX_TEMPORARILY_UNAVAILABLE']])
})

test('worker with no registered module handlers only recovers expired leases', async () => {
  let claimCalled = false
  const store: OutboxStore = {
    requeueExpired: async () => 2,
    requeueExpiredReviewClaims: async () => 3,
    claim: async () => {
      claimCalled = true
      return []
    },
    markPublished: async () => undefined,
    markRetry: async () => undefined,
  }

  const result = await runWorkerCycle(store, 'worker-1', new Map(), 25)

  assert.equal(claimCalled, false)
  assert.deepEqual(result, {
    requeued: 2, reviewClaimsRequeued: 3, claimed: 0, published: 0, failed: 0,
  })
})
