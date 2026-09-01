import assert from 'node:assert/strict'

import pg from 'pg'

import { WorkflowError } from '../errors.js'
import { PostgresWorkflowStore } from '../postgres-store.js'
import { WorkflowService } from '../service.js'
import type { ReviewActor } from '../types.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const store = new PostgresWorkflowStore(pool)
const authorId = '86000000-0000-4000-8000-000000000001'
const reviewerId = '86000000-0000-4000-8000-000000000002'
const commentId = '86000000-0000-4000-8000-000000000003'
const workItemId = '86000000-0000-4000-8000-000000000004'
const projectId = '10000000-0000-4000-8000-000000000001'
let clock = new Date('2026-08-13T11:00:00.000Z')
const service = new WorkflowService(store, Object.freeze({
  cursorSecret: 'workflow-fixture-cursor-secret-at-least-thirty-two-characters',
  leaseSeconds: 60,
  maximumClaimSeconds: 900,
  queuePageSize: 25,
}), () => clock)

const reviewer: ReviewActor = Object.freeze({
  userId: reviewerId,
  roles: Object.freeze(['user', 'editor'] as const),
  permissions: Object.freeze(['admin:review'] as const),
})
const author: ReviewActor = Object.freeze({
  userId: authorId,
  roles: Object.freeze(['user', 'editor'] as const),
  permissions: Object.freeze(['admin:review'] as const),
})

async function run(): Promise<void> {
  const existing = await pool.query<{ readonly status: string; readonly version: number }>(
    'SELECT status,version FROM workflow.review_work_items WHERE work_item_id=$1',
    [workItemId],
  )
  if (existing.rows[0]) {
    assert.deepEqual(existing.rows[0], { status: 'queued', version: 6 })
    const evidence = await pool.query<{ event_count: number; audit_count: number }>(
      `SELECT
         (SELECT count(*)::int FROM workflow.review_work_item_events WHERE work_item_id=$1) AS event_count,
         (SELECT count(*)::int FROM audit.audit_logs
          WHERE target_type='review_work_item' AND target_id=$1::text) AS audit_count`,
      [workItemId],
    )
    assert.equal(evidence.rows[0]?.event_count, 5)
    assert.equal(evidence.rows[0]?.audit_count, 5)
    return
  }
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$3,$3),($2,'active',$3,$3)
     ON CONFLICT (user_id) DO UPDATE SET status='active',updated_at=EXCLUDED.updated_at`,
    [authorId, reviewerId, clock],
  )
  await pool.query(
    `INSERT INTO community.comments (
       comment_id,project_id,author_user_id,body,moderation_state,version,
       client_request_id,request_hash,created_at,updated_at
     ) VALUES ($1,$2,$3,'workflow fixture','under_review',1,
       'workflow_fixture_comment_0001',$4,$5,$5)`,
    [commentId, projectId, authorId, 'a'.repeat(64), clock],
  )
  await pool.query(
    `INSERT INTO workflow.review_work_items (
       work_item_id,work_type,target_type,target_id,status,version,created_at,updated_at
     ) VALUES ($1,'relation','relation_candidate',$2,'queued',1,$3,$3)`,
    [workItemId, commentId, clock],
  )
  await pool.query(
    `INSERT INTO workflow.review_work_item_conflict_principals (
       work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
     ) VALUES ($1,$2,'comment_author',$3,1,$4)`,
    [workItemId, authorId, commentId, clock],
  )

  const reviewerPage = await service.listWorkItems({
    actor: reviewer, workType: 'relation', targetType: 'relation_candidate', status: 'queued',
    cursor: null, requestId: 'workflow-fixture-list-0001',
  })
  assert.equal(reviewerPage.total_count, 1)
  assert.equal(reviewerPage.items[0]?.domain_summary.status, 'not_implemented')
  const authorPage = await service.listWorkItems({
    actor: author, workType: 'relation', targetType: 'relation_candidate', status: 'queued',
    cursor: null, requestId: 'workflow-fixture-list-0002',
  })
  assert.equal(authorPage.total_count, 0)
  assert.deepEqual(authorPage.items, [])
  await assert.rejects(
    service.claimWorkItem({
      actor: author, workItemId, expectedVersion: 1,
      expectedConflictPrincipalVersion: null, requestId: 'workflow-fixture-claim-denied',
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === 'CONFLICT_OF_INTEREST',
  )

  const claimed = await service.claimWorkItem({
    actor: reviewer, workItemId, expectedVersion: 1,
    expectedConflictPrincipalVersion: null, requestId: 'workflow-fixture-claim-0001',
  })
  assert.equal(claimed.work_item_status, 'claimed')
  assert.equal(claimed.version, 2)
  const persistedToken = await pool.query<{ readonly raw_present: boolean }>(
    `SELECT position($2::text in encode(claim_token_hash,'hex'))>0 AS raw_present
     FROM workflow.review_work_items WHERE work_item_id=$1`,
    [workItemId, claimed.claim_token],
  )
  assert.equal(persistedToken.rows[0]?.raw_present, false)

  clock = new Date(clock.getTime() + 30_000)
  const heartbeat = await service.heartbeatWorkItem({
    actor: reviewer, workItemId, claimToken: claimed.claim_token,
    requestId: 'workflow-fixture-heartbeat-0001',
  })
  assert.equal(heartbeat.version, 3)
  assert.equal(heartbeat.lease_expires_at, '2026-08-13T11:01:30.000Z')

  const released = await service.releaseWorkItem({
    actor: reviewer, workItemId, claimToken: claimed.claim_token,
    reasonCode: 'manual_release', requestId: 'workflow-fixture-release-0001',
  })
  assert.equal(released.work_item_status, 'queued')
  assert.equal(released.version, 4)
  const replay = await service.releaseWorkItem({
    actor: reviewer, workItemId, claimToken: claimed.claim_token,
    reasonCode: 'manual_release', requestId: 'workflow-fixture-release-0002',
  })
  assert.deepEqual(replay, released)

  const claimedAgain = await service.claimWorkItem({
    actor: reviewer, workItemId, expectedVersion: 4,
    expectedConflictPrincipalVersion: null, requestId: 'workflow-fixture-claim-0002',
  })
  clock = new Date(clock.getTime() + 61_000)
  assert.equal(await store.requeueExpiredClaims(clock, 25), 1)
  const recovered = await pool.query<{ status: string; version: number; claim_token_hash: Buffer | null }>(
    'SELECT status,version,claim_token_hash FROM workflow.review_work_items WHERE work_item_id=$1',
    [workItemId],
  )
  assert.deepEqual(recovered.rows[0], { status: 'queued', version: 6, claim_token_hash: null })
  assert.ok(claimedAgain.claim_token)

  const evidence = await pool.query<{ event_count: number; audit_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM workflow.review_work_item_events WHERE work_item_id=$1) AS event_count,
       (SELECT count(*)::int FROM audit.audit_logs
        WHERE target_type='review_work_item' AND target_id=$1::text) AS audit_count`,
    [workItemId],
  )
  assert.equal(evidence.rows[0]?.event_count, 5)
  assert.equal(evidence.rows[0]?.audit_count, 5)
}

try {
  await run()
  console.info('workflow fixture verified')
} finally {
  await pool.end()
}
