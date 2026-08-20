import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MediaScanProcessor, type MediaScanStorePort } from './scan-processor.js'
import type { MediaProviderScanResult, MediaScanStorage } from './types.js'

const row = Object.freeze({
  media_resource_id: '92000000-0000-4000-8000-000000000001',
  owner_user_id: '92000000-0000-4000-8000-000000000002',
  storage_key: 'quarantine/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001',
  declared_mime: 'image/png' as const,
  status: 'scanning', scan_result: 'not_scanned', scan_attempt_count: 0,
  next_scan_at: null, processing_deadline_at: new Date('2026-08-13T12:30:00.000Z'), version: 2,
})

class FakeScanStore implements MediaScanStorePort {
  action = ''
  async claim() { return row }
  async deferPending() { this.action = 'pending' }
  async recordFailure() { this.action = 'failure' }
  async finishRejected(_id: string, _version: number, result: 'malicious' | 'unscannable') {
    this.action = result
  }
  async finishReady() { this.action = 'ready' }
}

function storage(result: MediaProviderScanResult, processingFails = false): MediaScanStorage {
  return Object.freeze({
    async getScanResult() { return result },
    async sanitizeImage() {
      if (processingFails) throw new Error('provider failed')
      return Object.freeze({
        finalStorageKey: 'ready/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001',
        detectedMime: 'image/png' as const, width: 1200, height: 800, exifRemoved: true as const,
      })
    },
  })
}

describe('MediaScanProcessor', () => {
  for (const [providerResult, expected] of [
    ['pending', 'pending'], ['retryable_failure', 'failure'],
    ['malicious', 'malicious'], ['unscannable', 'unscannable'], ['clean', 'ready'],
  ] as const) {
    it(`maps ${providerResult} to ${expected}`, async () => {
      const store = new FakeScanStore()
      const processor = new MediaScanProcessor({
        store, storage: storage(providerResult), now: () => new Date('2026-08-13T12:00:00.000Z'),
      })
      await processor.process(row.media_resource_id)
      assert.equal(store.action, expected)
    })
  }

  it('retries when clean-object sanitization fails and never marks the raw object ready', async () => {
    const store = new FakeScanStore()
    await new MediaScanProcessor({ store, storage: storage('clean', true) }).process(row.media_resource_id)
    assert.equal(store.action, 'failure')
  })
})
