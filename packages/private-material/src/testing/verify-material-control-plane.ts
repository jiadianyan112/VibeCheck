import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'

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
const reviewerId = '52000000-0000-4000-8000-000000000008'
const checksum = 'a'.repeat(64)
const sessionToken = 's'.repeat(43)
const claimToken = 'c'.repeat(43)
const authTokenSecret = 'private-material-fixture-auth-secret-32'
const readGrantTokenSecret = 'private-material-fixture-grant-secret-32'
const storageKeys = new Set<string>()
const deniedKeys = new Set<string>()
let inspectionMime = 'application/pdf'
const storage: PrivateMaterialStorage = {
  async issueUpload(input) {
    storageKeys.add(input.storageKey)
    return {
      uploadUrl: `https://private-storage.example/upload/${encodeURIComponent(input.storageKey)}`,
      uploadHeaders: {
        'content-type': input.declaredMime,
        'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from(input.checksumSha256, 'hex').toString('base64'),
        'x-amz-server-side-encryption': 'AES256',
        'x-amz-tagging': 'VibeCheckAccess=quarantined',
      },
    }
  },
  async inspectUpload(input) {
    assert.equal(storageKeys.has(input.storageKey), true)
    assert.equal(input.uploadReceipt.startsWith('fixture-receipt-'), true)
    return { detectedMime: inspectionMime, byteSize: 4, checksumSha256: checksum }
  },
  async issueRead() { return { readUrl: 'https://private-storage.example/read' } },
  async allowReads() {},
  async denyReads(input) { deniedKeys.add(input.storageKey) },
}

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$3,$3),($2,'active',$3,$3) ON CONFLICT (user_id) DO NOTHING`,
    [applicantId,reviewerId,now],
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
      authTokenSecret,
      readGrantTokenSecret,
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

  await pool.query(
    `UPDATE private_material.verification_materials SET status='scanning',version=version+1,
       next_scan_at=$2::timestamptz+interval '5 minutes',
       updated_at=GREATEST($2::timestamptz,updated_at+interval '1 microsecond')
     WHERE material_id=$1 AND status='uploaded'`,[prepared.material.material_id,now],
  )
  await pool.query(
    `UPDATE private_material.verification_materials SET status='ready',scan_result='clean',
       next_scan_at=NULL,version=version+1,
       updated_at=GREATEST($2::timestamptz,updated_at+interval '1 microsecond')
     WHERE material_id=$1 AND status='scanning'`,[prepared.material.material_id,now],
  )
  await pool.query(
    `UPDATE workflow.verification_requests SET method='official_account_control',
       public_summary='Fixture reviewer material access request.',version=version+1,
       updated_at=$2::timestamptz+interval '1 microsecond'
     WHERE verification_id=$1 AND status='draft'`,[verificationId,now],
  )
  const reviewWorkItemId=randomUUID()
  const claimTokenHash=createHash('sha256').update(claimToken,'utf8').digest()
  await pool.query(
    `INSERT INTO workflow.review_work_items (
       work_item_id,work_type,target_type,target_id,status,assignee_user_id,claim_token_hash,
       lease_expires_at,last_heartbeat_at,version,created_at,updated_at
     ) VALUES ($1,'verification','verification_request',$2,'claimed',$3,$4,
       $5::timestamptz+interval '10 minutes',$5::timestamptz,2,
       $5::timestamptz,$5::timestamptz)`,
    [reviewWorkItemId,verificationId,reviewerId,claimTokenHash,now],
  )
  await pool.query(
    `UPDATE workflow.verification_requests SET status='pending',material_ids_json=$2::jsonb,
       link_policy_snapshot_json=$3::jsonb,review_work_item_id=$4,
       status_history_json=status_history_json||jsonb_build_array(
         jsonb_build_object('status','pending','at',$5::timestamptz)),
       submitted_at=$5::timestamptz,version=version+1,
       updated_at=$5::timestamptz+interval '2 microseconds'
     WHERE verification_id=$1 AND status='draft'`,
    [verificationId,JSON.stringify([prepared.material.material_id]),JSON.stringify({
      policy_version:'creator_link.v1',target_creator_aggregate_version:null,
      owner_link_set_version:null,allowed_link_roles:['owner'],default_link_role:'owner',
      allowed_permission_profile_refs:[],observed_owner_link_id:null,
      observed_owner_link_version:null,reused_link_id:null,reused_link_version:null,
    }),reviewWorkItemId,now],
  )
  const sessionIdHash=createHmac('sha256',authTokenSecret).update(sessionToken,'utf8').digest()
  await pool.query(
    `INSERT INTO iam.sessions (
       session_id_hash,user_id,anonymous_subject_id,csrf_token_hash,roles_version,status,recent_auth_at,
       expires_at,created_at
     ) VALUES ($1,$2,$3,$5,1,'active',$4::timestamptz,
       $4::timestamptz+interval '1 hour',$4::timestamptz)`,
    [sessionIdHash,reviewerId,randomUUID(),now,Buffer.alloc(32,8)],
  )
  const reviewerCommand={reviewerUserId:reviewerId,roles:['admin'] as const,
    permissions:[] as const,sessionToken,materialId:prepared.material.material_id,claimToken}
  const reviewerProjection=await service.getForReviewer({...reviewerCommand,
    requestId:'material-fixture-reviewer-metadata'})
  assert.equal(reviewerProjection.read_grant_eligibility,'eligible')
  const grant=await service.createReadGrant({...reviewerCommand,
    purpose:'author_verification_review',operationId:'material-fixture-read-grant-0001',
    requestId:'material-fixture-read-grant'})
  const grantToken=grant.read_url.split('/').at(-1)!
  const redemption=await service.redeemReadGrant({reviewerUserId:reviewerId,sessionToken,
    grantToken,requestId:'material-fixture-content-read'})
  assert.equal(redemption.redirect_url,'https://private-storage.example/read')
  await assert.rejects(
    service.redeemReadGrant({reviewerUserId:reviewerId,sessionToken,grantToken,
      requestId:'material-fixture-content-read-replay'}),
    (error:unknown)=>error instanceof PrivateMaterialError&&error.code==='MATERIAL_READ_GRANT_CONSUMED',
  )
  const invalidatedGrant=await service.createReadGrant({...reviewerCommand,
    purpose:'author_verification_review',operationId:'material-fixture-read-grant-0002',
    requestId:'material-fixture-read-grant-before-revoke'})

  const revoked = await service.revoke({
    userId: applicantId, materialId: prepared.material.material_id, expectedVersion: 4,
    reasonCode: 'fixture_cleanup', operationId: 'material-fixture-revoke-0001',
    requestId: 'material-fixture-revoke',
  })
  assert.equal(revoked.material.next_action, 'none')
  assert.equal(deniedKeys.size, 1)
  await assert.rejects(
    service.redeemReadGrant({reviewerUserId:reviewerId,sessionToken,
      grantToken:invalidatedGrant.read_url.split('/').at(-1)!,
      requestId:'material-fixture-content-read-after-revoke'}),
    (error:unknown)=>error instanceof PrivateMaterialError&&error.code==='MATERIAL_READ_GRANT_EXPIRED',
  )
  const accessLogs=await pool.query<{action:string;count:number}>(
    `SELECT action,count(*)::int AS count FROM private_material.material_access_logs
     WHERE material_id=$1 AND actor_user_id=$2 AND action IN ('read_grant','content_read')
     GROUP BY action`,[prepared.material.material_id,reviewerId],
  )
  assert.equal(accessLogs.rows.find((row)=>row.action==='read_grant')?.count,3)
  assert.equal(accessLogs.rows.find((row)=>row.action==='content_read')?.count,1)

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
    one_time_read_grant: true,
    invalidated_read_grant: true,
    public_media_writes: 0,
  }))
} finally {
  await pool.end()
}
