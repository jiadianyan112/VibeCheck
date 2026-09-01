import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createPrivateMaterialScanHandler } from './private-material-scan-handler.js'

const event: OutboxEvent = {
  outboxId: '10000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000002',
  aggregateType: 'verification_material',
  aggregateId: '10000000-0000-4000-8000-000000000003',
  eventName: 'verification_material_scan_requested',
  eventVersion: 1,
  payload: { material_id: '10000000-0000-4000-8000-000000000003' },
  transactionId: '10000000-0000-4000-8000-000000000004',
  attemptCount: 1,
}

test('private material scan handler binds payload to the stable aggregate', async () => {
  const calls: string[] = []
  await createPrivateMaterialScanHandler({ process: async (id) => { calls.push(id) } })(event)
  assert.deepEqual(calls, [event.aggregateId])
})

test('private material scan handler rejects a cross-material payload', async () => {
  const handler = createPrivateMaterialScanHandler({ process: async () => undefined })
  await assert.rejects(
    handler({ ...event, payload: { material_id: '10000000-0000-4000-8000-000000000099' } }),
    /PRIVATE_MATERIAL_SCAN_EVENT_INVALID/,
  )
})
