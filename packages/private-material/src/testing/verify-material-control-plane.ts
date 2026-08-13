import assert from 'node:assert/strict'

import pg from 'pg'

import { PrivateMaterialError } from '../errors.js'
import { PrivateMaterialService } from '../service.js'
import { PostgresPrivateMaterialStore } from '../store.js'
import type { PrivateMaterialStorage } from '../types.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')

const pool = new pg.Pool({ connectionString: databaseUrl })
const now = new Date('2026-08-14T02:00:00.000Z')
const applicantId = '52000000-0000-4000-8000-000000000003'
const checksum = 'a'.repeat(64)
const storageKeys = new Set<string>()
const deniedKeys = new Set<string>()
let inspectionMime = 'application/pdf'
const storage: PrivateMaterialStorage = {
  async issueUpload(input) {
    storageKeys.add(input.storageKey)
    return { uploadUrl: `https://private-storage.example/upload/${encodeURIComponent(input.storageKey)}` }
  },
  async inspectUpload(input) {
    assert.equal(storageKeys.has(input.storageKey), true)
    assert.equal(input.uploadReceipt.startsWith('fixture-receipt-'), true)
    return { detectedMime: inspectionMime, byteSize: 4, checksumSha256: checksum }
  },
  async denyReads(input) { deniedKeys.add(input.storageKey) },
}

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$2,$2) ON CONFLICT (user_id) DO NOTHING`,
    [applicantId, now],
  )
  const project = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM catalog.projects
     WHERE review_status IN ('published_platform','published_author')
     ORDER BY project_id LIMIT 1`,
  )
  const projectId = project.rows[0]?.project_id
  if (!projectId) throw new Error('PRIVATE_MATERIAL_FIXTURE_PROJECT_REQUIRED')
  const request = await pool.query<{ verification_id: string }>(
    `WITH inserted AS (
       INSERT INTO workflow.verification_requests (
         project_id,applicant_user_id,creator_resolution_mode,new_creator_profile_input_json,
         requested_link_role,status_history_json,idempotency_key,request_hash,created_at,updated_at
       ) VALUES ($1,$2,'create_new_creator',jsonb_build_object('display_name','Material Fixture'),
         'owner',jsonb_build_array(jsonb_build_object('status','draft','at',$3::timestamptz)),
         'private-material-fixture-request',$4,$3,$3)
       ON CONFLICT (applicant_user_id,idempotency_key) DO NOTHING
       RETURNING verification_id
     )
     SELECT verification_id FROM inserted
     UNION ALL
     SELECT verification_id FROM workflow.verification_requests
     WHERE applicant_user_id=$2 AND idempotency_key='private-material-fixture-request'
     LIMIT 1`,
    [projectId, applicantId, now, 'f'.repeat(64)],
  )
  const verificationId = request.rows[0]!.verification_id
  const service = new PrivateMaterialService({
    store: new PostgresPrivateMaterialStore(pool),
    storage,
    crypto: {
      encryptionKeyBase64: Buffer.alloc(32, 11).toString('base64'),
      encryptionKeyVersion: 'fixture-v1',
    },
    now: () => now,
  })
  const prepared = await service.prepare({
    userId: applicantId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
    checksum, idempotencyKey: 'material-fixture-prepare-0001', requestId: 'material-fixture-prepare',
  })
  const prepareReplay = await service.prepare({
    userId: applicantId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
    checksum, idempotencyKey: 'material-fixture-prepare-0001', requestId: 'material-fixture-prepare-retry',
  })
  assert.equal(prepareReplay.material.material_id, prepared.material.material_id)
  assert.equal(Object.hasOwn(prepared.material, 'storage_key_ciphertext'), false)
  assert.equal(Object.hasOwn(prepared.material, 'scan_result'), false)

  const completeCommand = {
    userId: applicantId, materialId: prepared.material.material_id, checksum,
    uploadReceipt: 'fixture-receipt-clean-0001', operationId: 'material-fixture-complete-0001',
    requestId: 'material-fixture-complete',
  }
  const completed = await service.complete(completeCommand)
  const completeReplay = await service.complete({ ...completeCommand, requestId: 'material-fixture-complete-retry' })
  assert.deepEqual(completeReplay, completed)
  assert.equal(completed.scan_queued, true)
  const outbox = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ops.outbox_events
     WHERE aggregate_type='verification_material' AND aggregate_id=$1
       AND event_name='verification_material_scan_requested'`,
    [prepared.material.material_id],
  )
  assert.equal(outbox.rows[0]!.count, 1)

  const revoked = await service.revoke({
    userId: applicantId, materialId: prepared.material.material_id, expectedVersion: 2,
    reasonCode: 'fixture_cleanup', operationId: 'material-fixture-revoke-0001',
    requestId: 'material-fixture-revoke',
  })
  assert.equal(revoked.material.next_action, 'none')
  assert.equal(deniedKeys.size, 1)

  inspectionMime = 'text/plain'
  const rejectedPrepare = await service.prepare({
    userId: applicantId, verificationId, declaredMime: 'application/pdf', byteSize: 4,
    checksum, idempotencyKey: 'material-fixture-prepare-0002', requestId: 'material-fixture-rejected-prepare',
  })
  await assert.rejects(
    service.complete({
      userId: applicantId, materialId: rejectedPrepare.material.material_id, checksum,
      uploadReceipt: 'fixture-receipt-rejected-0002', operationId: 'material-fixture-complete-0002',
      requestId: 'material-fixture-rejected-complete',
    }),
    (error: unknown) => error instanceof PrivateMaterialError && error.code==='MATERIAL_MIME_MISMATCH',
  )
  const rejected = await pool.query<{ status: string; rejection_reason_code: string }>(
    `SELECT status,rejection_reason_code FROM private_material.verification_materials WHERE material_id=$1`,
    [rejectedPrepare.material.material_id],
  )
  assert.deepEqual(rejected.rows[0], { status: 'rejected', rejection_reason_code: 'MIME_MISMATCH' })
  const publicMedia = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM media.media_resources
     WHERE owner_user_id=$1 AND created_at>=$2`,
    [applicantId, now],
  )
  assert.equal(publicMedia.rows[0]!.count, 0)
  console.info(JSON.stringify({
    verification_id: verificationId,
    accepted_material_id: prepared.material.material_id,
    rejected_material_id: rejectedPrepare.material.material_id,
    scan_events: 1,
    public_media_writes: 0,
  }))
} finally {
  await pool.end()
}
