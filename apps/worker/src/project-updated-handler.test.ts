import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createProjectUpdatedHandler } from './project-updated-handler.js'

const projectId = '10000000-0000-4000-8000-000000000001'
const versionId = '10000000-0000-4000-8000-000000000002'
const updateId = '10000000-0000-4000-8000-000000000003'
const decisionId = '10000000-0000-4000-8000-000000000004'
const lifecycleEventId = '10000000-0000-4000-8000-000000000005'
const event: OutboxEvent = {
  outboxId: '10000000-0000-4000-8000-000000000006',
  eventId: '10000000-0000-4000-8000-000000000007',
  aggregateType: 'project', aggregateId: projectId, eventName: 'project_updated', eventVersion: 2,
  payload: {
    project_id: projectId, version_id: versionId, update_id: updateId,
    review_decision_id: decisionId, event_id: lifecycleEventId,
    source_type: 'project_update', initiator_type: 'verified_author',
    update_type: 'author_content_update', result: 'success',
  },
  transactionId: '10000000-0000-4000-8000-000000000008', attemptCount: 0,
}

test('project updated handler rebuilds search before fan-out with one bound command', async () => {
  const calls: string[] = []
  const now = new Date('2026-08-13T15:10:00.000Z')
  const handler = createProjectUpdatedHandler(
    { indexUpdatedProject: async (input) => { calls.push(`index:${JSON.stringify(input)}`) } },
    { createProjectUpdatedNotifications: async (input) => { calls.push(`notify:${JSON.stringify(input)}`) } },
    () => now,
  )
  await handler(event)
  assert.equal(calls.length, 2)
  assert.match(calls[0]!, /^index:/)
  assert.match(calls[1]!, /^notify:/)
  assert.ok(calls[1]!.includes(now.toISOString()))
})

test('project updated handler rejects an unbound or non-author branch event', async () => {
  const handler = createProjectUpdatedHandler(
    { indexUpdatedProject: async () => undefined },
    { createProjectUpdatedNotifications: async () => undefined },
  )
  await assert.rejects(
    () => handler({ ...event, payload: { ...event.payload, source_type: 'admin_project_edit' } }),
    /PROJECT_UPDATED_EVENT_INVALID/,
  )
  await assert.rejects(
    () => handler({ ...event, aggregateId: '10000000-0000-4000-8000-000000000099' }),
    /PROJECT_UPDATED_EVENT_INVALID/,
  )
})
