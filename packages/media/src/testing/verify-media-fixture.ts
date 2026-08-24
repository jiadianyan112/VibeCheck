import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresMediaStore } from '../postgres-store.js'
import { MediaScanProcessor, PostgresMediaScanStore } from '../scan-processor.js'
import { MediaService } from '../service.js'
import type { MediaScanStorage, MediaStorage } from '../types.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const uploadStorage: MediaStorage = Object.freeze({
  async issueUpload(input: Parameters<MediaStorage['issueUpload']>[0]) {
    return Object.freeze({
      uploadUrl: 'https://media-fixture.example/upload',
      uploadHeaders: Object.freeze({
        'content-type': input.declaredMime, 'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from(input.checksumSha256, 'hex').toString('base64'),
        'x-amz-server-side-encryption': 'AES256', 'x-amz-tagging': 'VibeCheckAccess=quarantined',
      }),
    })
  },
  async inspectUpload() {
    return Object.freeze({ detectedMime: 'image/png', byteSize: 2048, checksumSha256: 'e'.repeat(64) })
  },
  async issueRead() { return Object.freeze({ readUrl: 'https://media-fixture.example/read' }) },
})
const scanStorage: MediaScanStorage = Object.freeze({
  async getScanResult() { return 'clean' as const },
  async sanitizeImage(input: Parameters<MediaScanStorage['sanitizeImage']>[0]) {
    return Object.freeze({
      finalStorageKey: `ready/${input.ownerUserId}/${input.mediaResourceId}`,
      detectedMime: input.declaredMime, width: 1200, height: 800, exifRemoved: true as const,
    })
  },
})
const service = new MediaService(
  new PostgresMediaStore(pool), uploadStorage,
  () => new Date('2026-08-13T13:00:00.000Z'),
)
const userId = '93000000-0000-4000-8000-000000000001'
const checkId = '93000000-0000-4000-8000-000000000002'
const draftId = '93000000-0000-4000-8000-000000000003'
const chainId = '93000000-0000-4000-8000-000000000004'
const resourceId = '93000000-0000-4000-8000-000000000005'
const projectUpdateId = '93000000-0000-4000-8000-000000000006'
const now = new Date('2026-08-13T13:00:00.000Z')

async function verifyProjectUpdateReference(): Promise<void> {
  const existing = await pool.query<{
    readonly lifecycle_status: string
    readonly reference_version: number
    readonly update_version: number
    readonly media_ids: unknown
  }>(
    `SELECT reference.lifecycle_status,reference.version AS reference_version,
       project_update.version::int AS update_version,project_update.media_reference_ids_json AS media_ids
     FROM media.media_references reference
     JOIN media.media_resources resource ON resource.media_resource_id=reference.media_resource_id
     JOIN catalog.project_updates project_update ON project_update.update_id=reference.target_id
     WHERE resource.owner_user_id=$1
       AND reference.target_type='project_update'
       AND reference.target_id=$2`,
    [userId, projectUpdateId],
  )
  if (existing.rows[0]) {
    assert.deepEqual(existing.rows[0], {
      lifecycle_status: 'unlinked', reference_version: 2, update_version: 3, media_ids: [],
    })
    return
  }
  await pool.query(
    `INSERT INTO catalog.project_updates (
       update_id,owner_user_id,project_id,origin_review_status,base_version_id,update_type,
       authorization_snapshot_json,status,client_request_id,request_hash,created_at,updated_at
     ) VALUES ($1,$2,'10000000-0000-4000-8000-000000000001','published_author',
       '11000000-0000-4000-8000-000000000001','description','{}'::jsonb,'editing',
       'media-fixture-project-update-0001',$3,$4,$4)
     ON CONFLICT (update_id) DO NOTHING`,
    [projectUpdateId, userId, 'f'.repeat(64), now],
  )
  const created = await service.createReference({
    userId, mediaResourceId: resourceId, targetType: 'project_update', targetId: projectUpdateId,
    role: 'cover', altText: 'Project update fixture cover', sortOrder: 0,
    cropFocus: null, variant: 'cover.v1',
    clientRequestId: 'media-fixture-project-update-reference-0001',
    requestId: 'media-fixture-project-update-request-0001',
  })
  const afterCreate = await pool.query<{ readonly version: number; readonly media_ids: unknown }>(
    `SELECT version::int AS version,media_reference_ids_json AS media_ids
     FROM catalog.project_updates WHERE update_id=$1`,
    [projectUpdateId],
  )
  assert.equal(afterCreate.rows[0]?.version, 2)
  assert.deepEqual(afterCreate.rows[0]?.media_ids, [created.media_reference_id])
  await service.deleteReference({
    userId, mediaReferenceId: created.media_reference_id, expectedVersion: 1,
    operationId: 'media-fixture-project-update-delete-0001',
    requestId: 'media-fixture-project-update-request-0002',
  })
  const afterDelete = await pool.query<{
    readonly lifecycle_status: string
    readonly reference_version: number
    readonly update_version: number
    readonly media_ids: unknown
  }>(
    `SELECT reference.lifecycle_status,reference.version AS reference_version,
       project_update.version::int AS update_version,project_update.media_reference_ids_json AS media_ids
     FROM media.media_references reference
     JOIN catalog.project_updates project_update ON project_update.update_id=reference.target_id
     WHERE reference.media_reference_id=$1`,
    [created.media_reference_id],
  )
  assert.deepEqual(afterDelete.rows[0], {
    lifecycle_status: 'unlinked', reference_version: 2, update_version: 3, media_ids: [],
  })
}

async function run(): Promise<void> {
  const existing = await pool.query<{ readonly lifecycle_status: string; readonly version: number }>(
    `SELECT lifecycle_status,version FROM media.media_references
     WHERE media_resource_id=$1 ORDER BY created_at LIMIT 1`,
    [resourceId],
  )
  if (existing.rows[0]) {
    assert.deepEqual(existing.rows[0], { lifecycle_status: 'unlinked', version: 3 })
    await verifyProjectUpdateReference()
    return
  }
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$2,$2) ON CONFLICT (user_id) DO UPDATE SET status='active',updated_at=$2`,
    [userId, now],
  )
  const prepared = await service.prepareResource({
    userId, purpose: 'project_cover', declaredMime: 'image/png', byteSize: 2048,
    checksumSha256: 'e'.repeat(64), idempotencyKey: 'media-fixture-upload-prepare-0001',
    requestId: 'media-fixture-upload-request-0001',
  })
  assert.equal(prepared.media.status, 'uploading')
  const completed = await service.completeResource({
    userId, mediaResourceId: prepared.media.media_resource_id, checksumSha256: 'e'.repeat(64),
    uploadReceipt: 'fixture-etag', operationId: 'media-fixture-upload-complete-0001',
    requestId: 'media-fixture-upload-request-0002',
  })
  const completionReplay = await service.completeResource({
    userId, mediaResourceId: prepared.media.media_resource_id, checksumSha256: 'e'.repeat(64),
    uploadReceipt: 'fixture-etag', operationId: 'media-fixture-upload-complete-0001',
    requestId: 'media-fixture-upload-request-0003',
  })
  assert.equal(completed.media.status, 'uploaded')
  assert.equal(completionReplay.media.media_resource_id, completed.media.media_resource_id)
  const queued = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ops.outbox_events
     WHERE aggregate_type='media_resource' AND aggregate_id=$1 AND event_name='media_scan_requested'`,
    [completed.media.media_resource_id],
  )
  assert.equal(queued.rows[0]?.count, 1)
  await new MediaScanProcessor({
    store: new PostgresMediaScanStore(pool),
    storage: scanStorage, now: () => new Date('2026-08-13T13:00:10.000Z'),
  }).process(completed.media.media_resource_id)
  const ready = await service.getResource({
    userId, mediaResourceId: completed.media.media_resource_id,
    requestId: 'media-fixture-upload-request-0004',
  })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.scan_result, 'clean')
  assert.equal(ready.exif_removed, true)
  const content = await service.readResourceContent({
    userId, mediaResourceId: completed.media.media_resource_id,
    requestId: 'media-fixture-upload-request-0005',
  })
  assert.equal(content.redirect_url, 'https://media-fixture.example/read')
  await pool.query(
    `INSERT INTO workflow.submission_url_checks (
       check_id,owner_user_id,category_id,category_schema_version,input_hash,canonical_url,
       canonical_url_hash,risk_result,access_result,category_result,duplicate_result,
       client_request_id,request_hash,request_id,checked_at,expires_at
     ) VALUES ($1,$2,'personal_site_portfolio','portfolio.v1',$3,'https://media-fixture.example',
       digest('https://media-fixture.example','sha256'),'allowed','accessible','matched','none',
       'media-fixture-check-0001',$3,'media-fixture-request-0001',$4,$5)`,
    [checkId, userId, 'a'.repeat(64), now, new Date('2026-08-13T13:30:00.000Z')],
  )
  await pool.query(
    `INSERT INTO workflow.submission_drafts (
       draft_id,submission_chain_id,owner_user_id,category_id,category_schema_version,check_id,
       payload_snapshot,status,version,idempotency_key,request_hash,created_at,updated_at,saved_at,expires_at
     ) VALUES ($1,$2,$3,'personal_site_portfolio','portfolio.v1',$4,
       '{"project_core":{"public_url":"https://media-fixture.example"},"category_id":"personal_site_portfolio","category_schema_version":"portfolio.v1","category_data":{}}'::jsonb,
       'editing',1,'media-fixture-draft-0001',$5,$6,$6,$6,$7)`,
    [draftId, chainId, userId, checkId, 'b'.repeat(64), now, new Date('2026-09-13T13:00:00.000Z')],
  )
  await pool.query(
    `INSERT INTO media.media_resources (
       media_resource_id,owner_user_id,purpose,storage_key,declared_mime,detected_mime,
       byte_size,width,height,checksum_sha256,status,scan_result,exif_removed,version,
       idempotency_key,request_hash,created_at,updated_at
     ) VALUES ($1,$2,'project_cover','fixture/media/93000000.png','image/png','image/png',
       1024,1200,800,$3,'ready','clean',true,1,'media-fixture-resource-0001',$4,$5,$5)`,
    [resourceId, userId, 'c'.repeat(64), 'd'.repeat(64), now],
  )

  const created = await service.createReference({
    userId, mediaResourceId: resourceId, targetType: 'submission_draft', targetId: draftId,
    role: 'cover', altText: 'Fixture cover', sortOrder: 0,
    cropFocus: Object.freeze({ x: 0.5, y: 0.5 }), variant: null,
    clientRequestId: 'media-fixture-reference-create-0001', requestId: 'media-fixture-request-0002',
  })
  const replay = await service.createReference({
    userId, mediaResourceId: resourceId, targetType: 'submission_draft', targetId: draftId,
    role: 'cover', altText: 'Fixture cover', sortOrder: 0,
    cropFocus: Object.freeze({ x: 0.5, y: 0.5 }), variant: null,
    clientRequestId: 'media-fixture-reference-create-0001', requestId: 'media-fixture-request-0003',
  })
  assert.equal(replay.media_reference_id, created.media_reference_id)
  const page = await service.listReferences({
    userId, targetType: 'submission_draft', targetId: draftId, role: 'cover',
    requestId: 'media-fixture-request-0004',
  })
  assert.equal(page.total_count, 1)

  const patched = await service.patchReference({
    userId, mediaReferenceId: created.media_reference_id, expectedVersion: 1,
    altText: 'Updated fixture cover', sortOrder: 0, cropFocus: null, variant: 'cover.v1',
    operationId: 'media-fixture-reference-patch-0001', requestId: 'media-fixture-request-0005',
  })
  assert.equal(patched.version, 2)
  await service.deleteReference({
    userId, mediaReferenceId: created.media_reference_id, expectedVersion: 2,
    operationId: 'media-fixture-reference-delete-0001', requestId: 'media-fixture-request-0006',
  })
  await service.deleteReference({
    userId, mediaReferenceId: created.media_reference_id, expectedVersion: 2,
    operationId: 'media-fixture-reference-delete-0001', requestId: 'media-fixture-request-0007',
  })
  const verified = await pool.query<{
    readonly lifecycle_status: string
    readonly reference_version: number
    readonly draft_version: number
    readonly media_ids: unknown
    readonly audit_count: number
  }>(
    `SELECT reference.lifecycle_status,reference.version AS reference_version,
       draft.version AS draft_version,draft.media_reference_ids_json AS media_ids,
       (SELECT count(*)::int FROM audit.audit_logs
        WHERE target_type='media_reference' AND target_id=reference.media_reference_id::text) AS audit_count
     FROM media.media_references reference
     JOIN workflow.submission_drafts draft ON draft.draft_id=reference.target_id
     WHERE reference.media_reference_id=$1`,
    [created.media_reference_id],
  )
  assert.equal(verified.rows[0]?.lifecycle_status, 'unlinked')
  assert.equal(verified.rows[0]?.reference_version, 3)
  assert.equal(verified.rows[0]?.draft_version, 3)
  assert.deepEqual(verified.rows[0]?.media_ids, [])
  assert.equal(verified.rows[0]?.audit_count, 3)
  await verifyProjectUpdateReference()
}

try {
  await run()
  process.stdout.write('media_fixture_ok references=2 targets=submission_draft,project_update audits>=5\n')
} finally {
  await pool.end()
}
