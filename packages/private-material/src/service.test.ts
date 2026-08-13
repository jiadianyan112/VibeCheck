import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PrivateMaterialError } from './errors.js'
import { PrivateMaterialService, type PrivateMaterialStorePort } from './service.js'
import { applicantSummary, type StoredMaterial } from './store.js'
import type { PrivateMaterialStorage } from './types.js'

const userId = '52000000-0000-4000-8000-000000000003'
const verificationId = '54000000-0000-4000-8000-000000000003'
const materialId = '56000000-0000-4000-8000-000000000003'
const checksum = 'a'.repeat(64)
const now = new Date('2026-08-14T02:00:00.000Z')
const encryptionKeyBase64 = Buffer.alloc(32, 7).toString('base64')

describe('PrivateMaterialService', () => {
  it('prepares an owner-only upload and exposes no storage or scan internals', async () => {
    const fixture = fakeDependencies()
    const service = createService(fixture)
    const projection = await service.prepare({
      userId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
      checksum, idempotencyKey: 'material-prepare-0001', requestId: 'request-1',
    })
    assert.equal(projection.material.applicant_scan_state, 'pending')
    assert.equal(projection.upload_url.startsWith('https://private.example/'), true)
    assert.deepEqual(Object.keys(projection.material).sort(), [
      'applicant_scan_state','material_id','next_action','reason_key',
      'upload_expires_at','verification_id','version',
    ])
    assert.equal(fixture.issueCalls, 1)
  })

  it('returns the immutable first completion receipt after material state changes', async () => {
    const fixture = fakeDependencies()
    const service = createService(fixture)
    const prepared = await service.prepare({
      userId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
      checksum, idempotencyKey: 'material-prepare-0002', requestId: 'request-2',
    })
    const command = {
      userId, materialId: prepared.material.material_id, checksum, uploadReceipt: 'upload-receipt-0002',
      operationId: 'material-complete-0002', requestId: 'request-2',
    }
    const first = await service.complete(command)
    fixture.setStatus('ready')
    const replay = await service.complete(command)
    assert.deepEqual(replay, first)
    assert.equal(replay.material.applicant_scan_state, 'pending')
    assert.equal(fixture.inspectCalls, 1)
  })

  it('persists and replays a MIME rejection without disclosing detected MIME', async () => {
    const fixture = fakeDependencies({ detectedMime: 'text/plain' })
    const service = createService(fixture)
    const prepared = await service.prepare({
      userId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
      checksum, idempotencyKey: 'material-prepare-0003', requestId: 'request-3',
    })
    const command = {
      userId, materialId: prepared.material.material_id, checksum, uploadReceipt: 'upload-receipt-0003',
      operationId: 'material-complete-0003', requestId: 'request-3',
    }
    for (let attempt=0; attempt<2; attempt+=1) {
      await assert.rejects(
        service.complete(command),
        (error: unknown) => error instanceof PrivateMaterialError && error.code==='MATERIAL_MIME_MISMATCH' && error.httpStatus===415,
      )
    }
    assert.equal(fixture.inspectCalls, 1)
  })

  it('commits revocation before reporting a retryable storage denial failure', async () => {
    const fixture = fakeDependencies({ denyReadsFails: true })
    const service = createService(fixture)
    const prepared = await service.prepare({
      userId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
      checksum, idempotencyKey: 'material-prepare-0004', requestId: 'request-4',
    })
    await assert.rejects(
      service.revoke({
        userId, materialId: prepared.material.material_id, expectedVersion: 1, reasonCode: 'user_removed',
        operationId: 'material-revoke-0004', requestId: 'request-4',
      }),
      (error: unknown) => error instanceof PrivateMaterialError && error.code==='MATERIAL_STORAGE_REVOKE_PENDING' && error.retryable,
    )
    assert.equal(fixture.current().status, 'revoked')
  })
})

function createService(fixture: ReturnType<typeof fakeDependencies>): PrivateMaterialService {
  return new PrivateMaterialService({
    store: fixture.store,
    storage: fixture.storage,
    crypto: { encryptionKeyBase64, encryptionKeyVersion: 'test-v1' },
    now: () => now,
  })
}

function fakeDependencies(options: {
  readonly detectedMime?: string
  readonly denyReadsFails?: boolean
} = {}) {
  let row: StoredMaterial | null = null
  let issueCalls = 0
  let inspectCalls = 0
  const receipts = new Map<string, { requestHash: string; response: unknown }>()
  const store = {
    async findPrepareReplay() { return row },
    async getOwned() { return row },
    async create(input: Parameters<PrivateMaterialStorePort['create']>[0]) {
      row = stored(input.materialId, input.storageKey)
      return row
    },
    async recordSelfRead() {},
    async getOperationReplay(input: Parameters<PrivateMaterialStorePort['getOperationReplay']>[0]) {
      return receipts.get(input.operationId) ?? null
    },
    async complete(input: Parameters<PrivateMaterialStorePort['complete']>[0]) {
      if (!row) throw new Error('missing row')
      const updated = {
        ...row,
        status: input.accepted ? 'uploaded' : 'rejected',
        rejection_reason_code: input.rejectionReason,
        version: '2',
      } as StoredMaterial
      row = updated
      const response = {
        material: applicantSummary(updated),
        scan_queued: input.accepted,
        error_code: input.rejectionReason,
      }
      receipts.set(input.operationId, { requestHash: input.requestHash, response })
      return { material: updated, operationResponse: response, replayed: false }
    },
    async revoke(input: Parameters<PrivateMaterialStorePort['revoke']>[0]) {
      if (!row) throw new Error('missing row')
      row = {
        ...row, status: 'revoked', revoked_at: now, version: String(Number(row.version)+1),
        applicant_terminal_state_json: applicantSummary(row),
      } as StoredMaterial
      receipts.set(input.operationId, { requestHash: input.requestHash, response: applicantSummary(row) })
      return row
    },
  } as PrivateMaterialStorePort
  const storage: PrivateMaterialStorage = {
    async issueUpload() {
      issueCalls += 1
      return { uploadUrl: `https://private.example/${materialId}` }
    },
    async inspectUpload() {
      inspectCalls += 1
      return { detectedMime: options.detectedMime ?? 'application/pdf', byteSize: 4, checksumSha256: checksum }
    },
    async denyReads() {
      if (options.denyReadsFails) throw new Error('gateway unavailable')
    },
  }
  return {
    store, storage,
    get issueCalls() { return issueCalls },
    get inspectCalls() { return inspectCalls },
    current() { return row! },
    setStatus(status: StoredMaterial['status']) { row = { ...row!, status } as StoredMaterial },
  }
}

function stored(
  createdMaterialId: string,
  storageKey: Parameters<PrivateMaterialStorePort['create']>[0]['storageKey'],
): StoredMaterial {
  return {
    material_id: createdMaterialId,
    verification_id: verificationId,
    owner_user_id: userId,
    storage_key_ciphertext: storageKey.ciphertext,
    storage_key_nonce: storageKey.nonce,
    storage_key_auth_tag: storageKey.authTag,
    storage_key_version: storageKey.keyVersion,
    declared_mime: 'application/pdf',
    detected_mime: null,
    byte_size: 4,
    checksum_sha256: checksum,
    status: 'prepared',
    scan_result: 'not_scanned',
    rejection_reason_code: null,
    applicant_terminal_state_json: null,
    idempotency_key: 'material-prepare',
    request_hash: 'b'.repeat(64),
    version: '1',
    created_at: now,
    updated_at: now,
    upload_expires_at: new Date(now.getTime()+30*60*1000),
    processing_deadline_at: null,
    revoked_at: null,
  }
}
