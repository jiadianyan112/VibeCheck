import assert from 'node:assert/strict'

import pg from 'pg'

import {
  PostgresPrivateMaterialScanStore,
  PrivateMaterialScanProcessor,
} from '../scan-processor.js'
import {
  PrivateMaterialService,
  createPrivateMaterialStorageKeyResolver,
  type PrivateMaterialCryptoConfig,
} from '../service.js'
import { PostgresPrivateMaterialStore } from '../store.js'
import type { PrivateMaterialScanResult, PrivateMaterialStorage } from '../types.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')

const pool = new pg.Pool({ connectionString: databaseUrl })
const baseNow = new Date('2026-08-20T03:00:00.000Z')
const applicantId = '52000000-0000-4000-8000-000000000004'
const checksum = 'c'.repeat(64)
const crypto: PrivateMaterialCryptoConfig = {
  encryptionKeyBase64: Buffer.alloc(32, 12).toString('base64'),
  encryptionKeyVersion: 'scan-fixture-v1',
}
const openedKeys = new Set<string>()
const storage: PrivateMaterialStorage = {
  async issueUpload(input) {
    return {
      uploadUrl: `https://private-storage.example/${encodeURIComponent(input.storageKey)}`,
      uploadHeaders: {
        'content-type': input.declaredMime,
        'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from(input.checksumSha256, 'hex').toString('base64'),
        'x-amz-server-side-encryption': 'AES256',
        'x-amz-tagging': 'VibeCheckAccess=quarantined',
      },
    }
  },
  async inspectUpload() {
    return { detectedMime: 'application/pdf', byteSize: 4, checksumSha256: checksum }
  },
  async issueRead() { return { readUrl: 'https://private-storage.example/read' } },
  async allowReads(input) { openedKeys.add(input.storageKey) },
  async denyReads(input) { openedKeys.delete(input.storageKey) },
}

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$2,$2) ON CONFLICT (user_id) DO NOTHING`,
    [applicantId, baseNow],
  )
  const project = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM catalog.projects
     WHERE review_status IN ('published_platform','published_author')
     ORDER BY project_id LIMIT 1`,
  )
  const projectId = project.rows[0]?.project_id
  if (!projectId) throw new Error('PRIVATE_MATERIAL_SCAN_FIXTURE_PROJECT_REQUIRED')
  const verification = await pool.query<{ verification_id: string }>(
    `WITH inserted AS (
       INSERT INTO workflow.verification_requests (
         project_id,applicant_user_id,creator_resolution_mode,new_creator_profile_input_json,
         requested_link_role,status_history_json,idempotency_key,request_hash,created_at,updated_at
       ) VALUES ($1,$2,'create_new_creator',jsonb_build_object('display_name','Scan Fixture'),
         'owner',jsonb_build_array(jsonb_build_object('status','draft','at',$3::timestamptz)),
         'private-material-scan-fixture',$4,$3,$3)
       ON CONFLICT (applicant_user_id,idempotency_key) DO NOTHING
       RETURNING verification_id
     )
     SELECT verification_id FROM inserted
     UNION ALL
     SELECT verification_id FROM workflow.verification_requests
     WHERE applicant_user_id=$2 AND idempotency_key='private-material-scan-fixture'
     LIMIT 1`,
    [projectId, applicantId, baseNow, 'd'.repeat(64)],
  )
  const verificationId = verification.rows[0]!.verification_id
  const materialStore = new PostgresPrivateMaterialStore(pool)
  const scanStore = new PostgresPrivateMaterialScanStore(pool)
  const service = new PrivateMaterialService({
    store: materialStore,
    storage,
    crypto,
    now: () => baseNow,
  })
  const prepareAndComplete = async (suffix: string) => {
    const prepared = await service.prepare({
      userId: applicantId,
      verificationId,
      declaredMime: 'application/pdf',
      byteSize: 4,
      checksum,
      idempotencyKey: `scan-fixture-prepare-${suffix}`,
      requestId: `scan-fixture-prepare-${suffix}`,
    })
    await service.complete({
      userId: applicantId,
      materialId: prepared.material.material_id,
      checksum,
      uploadReceipt: `scan-fixture-receipt-${suffix}`,
      operationId: `scan-fixture-complete-${suffix}`,
      requestId: `scan-fixture-complete-${suffix}`,
    })
    return prepared.material.material_id
  }
  const process = async (materialId: string, at: Date, result: PrivateMaterialScanResult) => {
    await new PrivateMaterialScanProcessor({
      store: scanStore,
      scanner: { async getScanResult() { return result } },
      storage,
      resolveStorageKey: createPrivateMaterialStorageKeyResolver(crypto),
      now: () => at,
    }).process(materialId)
  }

  const cleanId = await prepareAndComplete('clean-0001')
  await process(cleanId, offset(1), 'pending')
  const pending = await material(cleanId)
  assert.equal(pending.status, 'scanning')
  assert.equal(pending.scan_attempt_count, 0)
  assert.equal(pending.next_scan_at?.toISOString(), offset(16).toISOString())
  await process(cleanId, offset(2), 'malicious')
  assert.equal((await material(cleanId)).status, 'scanning')
  await process(cleanId, offset(16), 'clean')
  assert.equal((await material(cleanId)).status, 'ready')
  assert.equal(openedKeys.size, 1)
  const cleanEvents = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ops.outbox_events
     WHERE aggregate_type='verification_material' AND aggregate_id=$1`,
    [cleanId],
  )
  assert.equal(cleanEvents.rows[0]!.count, 2)

  const maliciousId = await prepareAndComplete('malicious-0002')
  await process(maliciousId, offset(1), 'malicious')
  const malicious = await material(maliciousId)
  assert.deepEqual(
    [malicious.status, malicious.scan_result, malicious.rejection_reason_code],
    ['rejected', 'malicious', 'MALWARE_DETECTED'],
  )

  const failureId = await prepareAndComplete('failure-0003')
  await process(failureId, offset(1), 'retryable_failure')
  await process(failureId, offset(31), 'retryable_failure')
  await process(failureId, offset(91), 'retryable_failure')
  const failed = await material(failureId)
  assert.deepEqual(
    [failed.status, failed.scan_attempt_count, failed.rejection_reason_code],
    ['rejected', 3, 'SCAN_RETRY_EXHAUSTED'],
  )

  const expiredUpload = await service.prepare({
    userId: applicantId,
    verificationId,
    declaredMime: 'application/pdf',
    byteSize: 4,
    checksum,
    idempotencyKey: 'scan-fixture-prepare-expired-0004',
    requestId: 'scan-fixture-prepare-expired-0004',
  })
  const expiredScanId = await prepareAndComplete('deadline-0005')
  const swept = await scanStore.sweepExpired(offset(1_801), 10)
  assert.equal(swept, 2)
  assert.deepEqual(
    [(await material(expiredUpload.material.material_id)).status, (await material(expiredScanId)).status],
    ['abandoned', 'rejected'],
  )

  const audit = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM private_material.material_access_logs
     WHERE material_id=ANY($1::uuid[]) AND purpose='malware_scan'`,
    [[cleanId, maliciousId, failureId, expiredUpload.material.material_id, expiredScanId]],
  )
  assert.equal(audit.rows[0]!.count>=10, true)
  console.info(JSON.stringify({
    clean_material_id: cleanId,
    malicious_material_id: maliciousId,
    exhausted_material_id: failureId,
    scheduled_poll_events: cleanEvents.rows[0]!.count,
    swept_materials: swept,
  }))

  async function material(materialId: string) {
    const result = await pool.query<{
      status: string
      scan_result: string
      rejection_reason_code: string | null
      scan_attempt_count: number
      next_scan_at: Date | null
    }>(
      `SELECT status,scan_result,rejection_reason_code,scan_attempt_count,next_scan_at
       FROM private_material.verification_materials WHERE material_id=$1`,
      [materialId],
    )
    return result.rows[0]!
  }
} finally {
  await pool.end()
}

function offset(seconds: number): Date {
  return new Date(baseNow.getTime()+seconds*1_000)
}
