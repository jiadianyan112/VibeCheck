import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createProjectUpdateApplicationHandler } from './project-update-application-handler.js'

const event: OutboxEvent = {
  outboxId: '10000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000002',
  aggregateType: 'project_update',
  aggregateId: '10000000-0000-4000-8000-000000000003',
  eventName: 'project_update_approved',
  eventVersion: 2,
  payload: {
    project_update_id: '10000000-0000-4000-8000-000000000003',
    review_decision_id: '10000000-0000-4000-8000-000000000004',
    resulting_status: 'approved',
  },
  transactionId: '10000000-0000-4000-8000-000000000005',
  attemptCount: 0,
}

test('project update application handler binds the approved event to its aggregate', async () => {
  const calls: string[][] = []
  const handler = createProjectUpdateApplicationHandler({
    applyApprovedUpdate: async (...args) => { calls.push(args) },
  })
  await handler(event)
  assert.deepEqual(calls, [[event.aggregateId, event.payload.review_decision_id]])
})

test('project update application handler rejects cross-aggregate payloads', async () => {
  const handler = createProjectUpdateApplicationHandler({ applyApprovedUpdate: async () => undefined })
  await assert.rejects(
    () => handler({ ...event, aggregateId: '10000000-0000-4000-8000-000000000099' }),
    /PROJECT_UPDATE_APPLICATION_EVENT_INVALID/,
  )
})
