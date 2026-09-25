import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createPrivateMaterialAccessRevokeHandler } from './private-material-access-revoke-handler.js'

const event: OutboxEvent = {
  outboxId: '10000000-0000-4000-8000-000000000011',
  eventId: '10000000-0000-4000-8000-000000000012',
  aggregateType: 'verification_material',
  aggregateId: '10000000-0000-4000-8000-000000000013',
  eventName: 'verification_material_access_revoke_requested',
  eventVersion: 2,
  payload: {
    material_id: '10000000-0000-4000-8000-000000000013',
    reason: 'verification_withdrawn',
  },
  transactionId: '10000000-0000-4000-8000-000000000014',
  attemptCount: 1,
}

test('private material access revoke handler forwards only its stable aggregate', async () => {
  const calls: string[] = []
  await createPrivateMaterialAccessRevokeHandler({ revoke: async (id) => { calls.push(id) } })(event)
  assert.deepEqual(calls, [event.aggregateId])
})

test('private material access revoke handler rejects another aggregate type', async () => {
  const handler = createPrivateMaterialAccessRevokeHandler({ revoke: async () => undefined })
  await assert.rejects(
    handler({ ...event, aggregateType: 'verification_request' }),
    /PRIVATE_MATERIAL_REVOKE_EVENT_INVALID/,
  )
})
