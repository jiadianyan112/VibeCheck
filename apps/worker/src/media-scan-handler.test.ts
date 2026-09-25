import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createMediaScanHandler } from './media-scan-handler.js'

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return Object.freeze({
    outboxId: '90000000-0000-4000-8000-000000000001',
    eventId: '90000000-0000-4000-8000-000000000002',
    aggregateType: 'media_resource', aggregateId: '90000000-0000-4000-8000-000000000003',
    eventName: 'media_scan_requested', eventVersion: 1,
    payload: Object.freeze({ media_resource_id: '90000000-0000-4000-8000-000000000003' }),
    transactionId: '90000000-0000-4000-8000-000000000004', attemptCount: 1,
    ...overrides,
  })
}

describe('createMediaScanHandler', () => {
  it('dispatches a typed media scan event', async () => {
    let received = ''
    const handler = createMediaScanHandler({ async process(id) { received = id } })
    await handler(event())
    assert.equal(received, '90000000-0000-4000-8000-000000000003')
  })

  it('rejects mismatched aggregate payloads', async () => {
    const handler = createMediaScanHandler({ async process() {} })
    await assert.rejects(
      handler(event({ payload: Object.freeze({ media_resource_id: 'different' }) })),
      /MEDIA_SCAN_EVENT_INVALID/,
    )
  })
})
