import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mediaError } from './errors.js'
import { MediaScanProcessor, type MediaScanStorePort } from './scan-processor.js'
import type {
  MediaScanStorage,
  MediaValidationRejectionReason,
} from './types.js'

const row = Object.freeze({
  media_resource_id: '92000000-0000-4000-8000-000000000001',
  owner_user_id: '92000000-0000-4000-8000-000000000002',
  storage_key: 'quarantine/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001',
  declared_mime: 'image/png' as const,
  byte_size: 1024,
  checksum_sha256: 'a'.repeat(64),
  status: 'scanning', scan_result: 'not_scanned', scan_attempt_count: 0,
  next_scan_at: null, processing_deadline_at: new Date('2026-08-13T12:30:00.000Z'), version: 2,
})

class FakeScanStore implements MediaScanStorePort {
  action = ''
  rejectionReason: MediaValidationRejectionReason | null = null
  async claim() { return row }
  async deferPending() { this.action = 'pending' }
  async recordFailure() { this.action = 'failure' }
  async finishRejected(
    _id: string, _version: number, reason: MediaValidationRejectionReason,
  ) {
    this.action = 'rejected'
    this.rejectionReason = reason
  }
  async finishReady() { this.action = 'ready' }
}

function storage(
  failure?: ReturnType<typeof mediaError> | Error,
): { storage: MediaScanStorage; received: Parameters<MediaScanStorage['sanitizeImage']>[0] | null } {
  const result: { storage: MediaScanStorage; received: Parameters<MediaScanStorage['sanitizeImage']>[0] | null } = {
    storage: undefined as never, received: null,
  }
  result.storage = Object.freeze({
    async sanitizeImage(input: Parameters<MediaScanStorage['sanitizeImage']>[0]) {
      result.received = input
      if (failure) throw failure
      return Object.freeze({
        finalStorageKey: 'ready/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001',
        detectedMime: 'image/png' as const, width: 1200, height: 800, exifRemoved: true as const,
      })
    },
  })
  return result
}

describe('MediaScanProcessor', () => {
  it('passes database byte size and checksum to direct R2 sanitization and finalizes ready', async () => {
    const store = new FakeScanStore()
    const fixture = storage()
    await new MediaScanProcessor({
      store, storage: fixture.storage, now: () => new Date('2026-08-13T12:00:00.000Z'),
    }).process(row.media_resource_id)
    assert.equal(store.action, 'ready')
    assert.deepEqual(fixture.received, {
      storageKey: row.storage_key, mediaResourceId: row.media_resource_id,
      ownerUserId: row.owner_user_id, declaredMime: row.declared_mime,
      byteSize: 1024, checksumSha256: 'a'.repeat(64),
    })
  })

  for (const [code, reason] of [
    ['MEDIA_BYTE_SIZE_MISMATCH', 'BYTE_SIZE_MISMATCH'],
    ['MEDIA_CHECKSUM_MISMATCH', 'CHECKSUM_MISMATCH'],
    ['MEDIA_MIME_MISMATCH', 'MIME_MISMATCH'],
    ['MEDIA_DIMENSIONS_INVALID', 'DIMENSIONS_INVALID'],
    ['MEDIA_DECODE_FAILED', 'DECODE_FAILED'],
    ['MEDIA_DECODE_UNSUPPORTED', 'DECODE_UNSUPPORTED'],
  ] as const) {
    it(`maps permanent ${code} to bare rejection reason ${reason}`, async () => {
      const store = new FakeScanStore()
      const fixture = storage(mediaError(code, 422))
      await new MediaScanProcessor({ store, storage: fixture.storage }).process(row.media_resource_id)
      assert.equal(store.action, 'rejected')
      assert.equal(store.rejectionReason, reason)
    })
  }

  it('records retryable storage failures for retry instead of rejecting or finalizing', async () => {
    const store = new FakeScanStore()
    const fixture = storage(mediaError('MEDIA_STORAGE_DOWNLOAD_FAILED', 503, true))
    await new MediaScanProcessor({ store, storage: fixture.storage }).process(row.media_resource_id)
    assert.equal(store.action, 'failure')
    assert.equal(store.rejectionReason, null)
  })

  it('records unexpected sanitization failures for retry', async () => {
    const store = new FakeScanStore()
    const fixture = storage(new Error('storage unavailable'))
    await new MediaScanProcessor({ store, storage: fixture.storage }).process(row.media_resource_id)
    assert.equal(store.action, 'failure')
  })
})
