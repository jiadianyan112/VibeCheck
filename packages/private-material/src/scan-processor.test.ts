import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PrivateMaterialScanProcessor, type PrivateMaterialScanStorePort } from './scan-processor.js'
import type { StoredMaterial } from './store.js'
import type { PrivateMaterialScanResult } from './types.js'

const materialId = '56000000-0000-4000-8000-000000000003'
const now = new Date('2026-08-20T02:00:00.000Z')

describe('PrivateMaterialScanProcessor', () => {
  it('turns a pending GuardDuty tag into a scheduled domain poll without failing the outbox', async () => {
    const fixture = processorFixture('pending')
    await fixture.processor.process(materialId)
    assert.deepEqual(fixture.calls, ['claim', 'scan', 'defer:7'])
  })

  it('opens storage only after a clean result and then commits ready', async () => {
    const fixture = processorFixture('clean')
    await fixture.processor.process(materialId)
    assert.deepEqual(fixture.calls, ['claim', 'scan', 'allow', 'finish:clean:7'])
  })

  it('keeps storage quarantined and schedules a provider failure when access tagging fails', async () => {
    const fixture = processorFixture('clean', true)
    await fixture.processor.process(materialId)
    assert.deepEqual(fixture.calls, ['claim', 'scan', 'allow', 'failure:7'])
  })

  it('records GuardDuty provider failures without throwing into the generic outbox retry budget', async () => {
    const fixture = processorFixture('retryable_failure')
    await fixture.processor.process(materialId)
    assert.deepEqual(fixture.calls, ['claim', 'scan', 'failure:7'])
  })

  it('rejects malicious material without opening storage reads', async () => {
    const fixture = processorFixture('malicious')
    await fixture.processor.process(materialId)
    assert.deepEqual(fixture.calls, ['claim', 'scan', 'finish:malicious:7'])
  })
})

function processorFixture(result: PrivateMaterialScanResult, allowFails = false) {
  const calls: string[] = []
  const row = storedMaterial()
  const store = {
    async claim() { calls.push('claim'); return row },
    async deferPending(_materialId: string, version: number) { calls.push(`defer:${version}`) },
    async finish(_materialId: string, version: number, scanResult: string) {
      calls.push(`finish:${scanResult}:${version}`)
    },
    async recordFailure(_materialId: string, version: number) { calls.push(`failure:${version}`) },
  } as PrivateMaterialScanStorePort
  const processor = new PrivateMaterialScanProcessor({
    store,
    scanner: { async getScanResult() { calls.push('scan'); return result } },
    storage: {
      async allowReads() {
        calls.push('allow')
        if (allowFails) throw new Error('tag update failed')
      },
    },
    resolveStorageKey: () => 'verification/54000000-0000-4000-8000-000000000003/56000000-0000-4000-8000-000000000003',
    now: () => now,
  })
  return { calls, processor }
}

function storedMaterial(): StoredMaterial {
  return {
    material_id: materialId,
    verification_id: '54000000-0000-4000-8000-000000000003',
    owner_user_id: '52000000-0000-4000-8000-000000000003',
    storage_key_ciphertext: Buffer.from('ciphertext'),
    storage_key_nonce: Buffer.alloc(12),
    storage_key_auth_tag: Buffer.alloc(16),
    storage_key_version: 'test-v1',
    declared_mime: 'application/pdf',
    detected_mime: 'application/pdf',
    byte_size: 4,
    checksum_sha256: 'a'.repeat(64),
    status: 'scanning',
    scan_result: 'not_scanned',
    rejection_reason_code: null,
    scan_attempt_count: 0,
    next_scan_at: null,
    applicant_terminal_state_json: null,
    idempotency_key: 'material-prepare-0001',
    request_hash: 'b'.repeat(64),
    version: '7',
    created_at: now,
    updated_at: now,
    upload_expires_at: new Date(now.getTime()+1_800_000),
    processing_deadline_at: new Date(now.getTime()+1_800_000),
    revoked_at: null,
  }
}
