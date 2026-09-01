import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

import pg from 'pg'

import { PostgresAdminOperationSecurityStore } from '../admin-operation-postgres-store.js'
import { AdminOperationSecurityService } from '../admin-operation-service.js'
import { WorkflowError } from '../errors.js'
import type { ReviewActor } from '../types.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const actorUserId = '87000000-0000-4000-8000-000000000001'
const anonymousSubjectId = '87000000-0000-4000-8000-000000000002'
const sessionToken = 'admin-operation-fixture-primary-session-token-000001'
const authTokenSecret = 'admin-operation-fixture-auth-secret-at-least-thirty-two-characters'
const tokenSecret = 'admin-operation-fixture-token-secret-at-least-thirty-two-characters'
const sessionHash = createHmac('sha256', authTokenSecret).update(sessionToken).digest()
let clock = new Date('2026-08-13T12:00:00.000Z')
const actor: ReviewActor = Object.freeze({
  userId: actorUserId,
  roles: Object.freeze(['user', 'admin'] as const),
  permissions: Object.freeze(['admin:access', 'admin:review'] as const),
})
const service = new AdminOperationSecurityService(
  new PostgresAdminOperationSecurityStore(pool),
  {
    tokenSecret,
    authTokenSecret,
    previewTtlSeconds: 600,
    confirmTtlSeconds: 120,
    recentAuthWindowSeconds: 300,
  },
  () => clock,
)

async function run(): Promise<void> {
  const existing = await pool.query<{ readonly event_count: number; readonly audit_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM workflow.admin_operation_security_events
        WHERE actor_user_id=$1) AS event_count,
       (SELECT count(*)::int FROM audit.audit_logs
        WHERE target_type='admin_operation_preview' AND actor_id_hash=digest($1::text,'sha256')) AS audit_count`,
    [actorUserId],
  )
  if ((existing.rows[0]?.event_count ?? 0) > 0) {
    assert.equal(existing.rows[0]?.event_count, 6)
    assert.equal(existing.rows[0]?.audit_count, 4)
    return
  }

  await pool.query(
    `INSERT INTO iam.users (user_id,status,role_version,created_at,updated_at)
     VALUES ($1,'active',1,$2,$2)
     ON CONFLICT (user_id) DO UPDATE SET status='active',role_version=1,updated_at=EXCLUDED.updated_at`,
    [actorUserId, clock],
  )
  await pool.query(
    `INSERT INTO iam.user_roles (
       user_role_id,user_id,role,granted_by_operation_id,valid_from,created_at
     ) VALUES ($1,$2,'admin','fixture_admin_role',$3,$3)
     ON CONFLICT (user_id,role) WHERE valid_to IS NULL DO NOTHING`,
    [randomUUID(), actorUserId, clock],
  )
  await pool.query(
    `INSERT INTO iam.sessions (
       session_id_hash,csrf_token_hash,user_id,anonymous_subject_id,roles_version,
       session_version,status,recent_auth_at,expires_at,created_at,last_seen_at,auth_method
     ) VALUES ($1,digest('fixture-csrf','sha256'),$2,$3,1,1,'active',$4,$5,$4,$4,'email_otp')
     ON CONFLICT (session_id_hash) DO UPDATE SET status='active',roles_version=1,
       recent_auth_at=EXCLUDED.recent_auth_at,expires_at=EXCLUDED.expires_at,last_seen_at=EXCLUDED.last_seen_at`,
    [sessionHash, actorUserId, anonymousSubjectId, clock, new Date(clock.getTime() + 86_400_000)],
  )

  const recentPreview = await service.preview({
    actor,
    sessionToken,
    operationType: 'submission_review',
    targets: [{ target_type: 'submission', target_id: 'fixture-submission-1' }],
    expectedVersions: { work_item: 2, submission: 1 },
    proposedDiff: { review_status: 'approved' },
    reasonCode: 'submission_approved',
    claimToken: 'q'.repeat(43),
    expectedConflictPrincipalVersion: null,
    requestId: 'admin_fixture_preview_recent',
  })
  const recentConfirm = await service.confirm({
    actor,
    sessionToken,
    previewToken: recentPreview.preview_token,
    confirmationSummaryHash: recentPreview.confirmation_summary_hash,
    confirmRequestId: 'admin_fixture_confirm_recent',
    reauthGrantId: null,
    expectedConflictPrincipalVersion: null,
    requestId: 'admin_fixture_confirm_recent_1',
  })
  assert.equal(recentConfirm.assurance_source, 'recent_session')
  assert.equal(recentConfirm.replayed, false)
  const replay = await service.confirm({
    actor,
    sessionToken,
    previewToken: recentPreview.preview_token,
    confirmationSummaryHash: recentPreview.confirmation_summary_hash,
    confirmRequestId: 'admin_fixture_confirm_recent',
    reauthGrantId: null,
    expectedConflictPrincipalVersion: null,
    requestId: 'admin_fixture_confirm_recent_2',
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.confirm_token, recentConfirm.confirm_token)

  clock = new Date('2026-08-13T12:10:00.000Z')
  await pool.query(
    `UPDATE iam.sessions SET recent_auth_at=$2,last_seen_at=$3 WHERE session_id_hash=$1`,
    [sessionHash, new Date(clock.getTime() - 301_000), clock],
  )
  const challengedPreview = await service.preview({
    actor,
    sessionToken,
    operationType: 'project_archive',
    targets: [{ target_type: 'project', target_id: '10000000-0000-4000-8000-000000000001' }],
    expectedVersions: { project: 4 },
    proposedDiff: { review_status: 'archived' },
    reasonCode: 'project_archived',
    claimToken: null,
    expectedConflictPrincipalVersion: null,
    requestId: 'admin_fixture_preview_stale',
  })
  await assert.rejects(
    () => service.confirm({
      actor,
      sessionToken,
      previewToken: challengedPreview.preview_token,
      confirmationSummaryHash: challengedPreview.confirmation_summary_hash,
      confirmRequestId: 'admin_fixture_confirm_stale',
      reauthGrantId: null,
      expectedConflictPrincipalVersion: null,
      requestId: 'admin_fixture_confirm_stale_1',
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === 'REAUTH_REQUIRED' &&
      error.httpStatus === 401,
  )
  const reauthGrantId = randomUUID()
  const challengedPreviewHash = createHmac('sha256', authTokenSecret)
    .update(challengedPreview.preview_token).digest()
  await pool.query(
    `INSERT INTO iam.admin_reauth_grants (
       reauth_grant_id,user_id,primary_session_id_hash,preview_token_hash,roles_version,
       auth_flow_id,recent_auth_at,status,issued_at,expires_at
     ) VALUES ($1,$2,$3,$4,1,$5,$6,'active',$6,$7)`,
    [reauthGrantId, actorUserId, sessionHash, challengedPreviewHash, randomUUID(), clock,
      new Date(clock.getTime() + 300_000)],
  )
  await pool.query(
    `UPDATE iam.sessions SET recent_auth_at=$2,last_seen_at=$2 WHERE session_id_hash=$1`,
    [sessionHash, clock],
  )
  const steppedUp = await service.confirm({
    actor,
    sessionToken,
    previewToken: challengedPreview.preview_token,
    confirmationSummaryHash: challengedPreview.confirmation_summary_hash,
    confirmRequestId: 'admin_fixture_confirm_stale',
    reauthGrantId,
    expectedConflictPrincipalVersion: null,
    requestId: 'admin_fixture_confirm_stale_2',
  })
  assert.equal(steppedUp.assurance_source, 'step_up_grant')
  const state = await pool.query<{
    readonly grant_status: string
    readonly preview_count: number
    readonly confirm_count: number
    readonly event_count: number
    readonly audit_count: number
  }>(
    `SELECT
       (SELECT status FROM iam.admin_reauth_grants WHERE reauth_grant_id=$1) AS grant_status,
       (SELECT count(*)::int FROM workflow.admin_operation_previews WHERE actor_user_id=$2) AS preview_count,
       (SELECT count(*)::int FROM workflow.admin_operation_confirm_grants WHERE actor_user_id=$2) AS confirm_count,
       (SELECT count(*)::int FROM workflow.admin_operation_security_events WHERE actor_user_id=$2) AS event_count,
       (SELECT count(*)::int FROM audit.audit_logs
        WHERE target_type='admin_operation_preview' AND actor_id_hash=digest($2::text,'sha256')) AS audit_count`,
    [reauthGrantId, actorUserId],
  )
  assert.deepEqual(state.rows[0], {
    grant_status: 'consumed',
    preview_count: 2,
    confirm_count: 2,
    event_count: 6,
    audit_count: 4,
  })
  await assert.rejects(
    () => pool.query(
      `UPDATE workflow.admin_operation_security_events SET metadata_json=metadata_json
       WHERE actor_user_id=$1`,
      [actorUserId],
    ),
    /IMMUTABLE_ADMIN_OPERATION_SECURITY_EVENT/,
  )
  console.info(JSON.stringify({
    fixture: 'admin-operation-preview-confirm-security',
    status: 'ok',
    assurance_sources: ['recent_session', 'step_up_grant'],
  }))
}

await run().finally(async () => pool.end())
