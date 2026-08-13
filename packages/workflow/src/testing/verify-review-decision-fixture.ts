import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import { PostgresAdminOperationSecurityStore } from '../admin-operation-postgres-store.js'
import { AdminOperationSecurityService } from '../admin-operation-service.js'
import { PostgresReviewDecisionStore } from '../review-decision-postgres-store.js'
import { ReviewDecisionService } from '../review-decision-service.js'
import { PostgresWorkflowStore } from '../postgres-store.js'
import { WorkflowService } from '../service.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')

const authSecret = 'fixture-identity-auth-secret-at-least-32-characters'
const tokenSecret = 'fixture-workflow-token-secret-at-least-32-characters'
const sessionToken = 'r'.repeat(43)
const claimActor = Object.freeze({
  userId: '94000000-0000-4000-8000-000000000001',
  roles: Object.freeze(['admin'] as const),
  permissions: Object.freeze([]),
})
const ownerUserId = '94000000-0000-4000-8000-000000000002'
const submissionId = '94000000-0000-4000-8000-000000000003'
const workItemId = '94000000-0000-4000-8000-000000000004'
const checkId = '94000000-0000-4000-8000-000000000005'
const draftId = '94000000-0000-4000-8000-000000000006'
const chainId = '94000000-0000-4000-8000-000000000007'
const anonymousSubjectId = '94000000-0000-4000-8000-000000000008'

const pool = new Pool({ connectionString: databaseUrl })
const sessionHash = createHmac('sha256', authSecret).update(sessionToken).digest()
const clock = new Date('2026-08-13T15:00:00.000Z')

try {
  const existing = await pool.query<{
    readonly count: number
    readonly approved: number
    readonly decided: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM workflow.review_decisions WHERE work_item_id=$1) AS count,
       (SELECT count(*)::int FROM workflow.submissions
          WHERE submission_id=$2 AND review_status='approved' AND resulting_project_id IS NULL) AS approved,
       (SELECT count(*)::int FROM workflow.review_work_items
          WHERE work_item_id=$1 AND status='decided' AND decision_ref_type='review_decision') AS decided`,
    [workItemId, submissionId],
  )
  if (existing.rows[0]?.count === 1) {
    assert.equal(existing.rows[0].approved, 1)
    assert.equal(existing.rows[0].decided, 1)
  } else {
    const projectCountBefore = await pool.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM catalog.projects',
    )
    await pool.query(
      `INSERT INTO iam.users (user_id,status,role_version,created_at,updated_at)
       VALUES ($1,'active',1,$3,$3),($2,'active',1,$3,$3)
       ON CONFLICT (user_id) DO UPDATE SET status='active',role_version=1,updated_at=EXCLUDED.updated_at`,
      [claimActor.userId, ownerUserId, clock],
    )
    await pool.query(
      `INSERT INTO iam.user_roles (
         user_role_id,user_id,role,granted_by_operation_id,valid_from,created_at
       ) VALUES ($1,$2,'admin','fixture_review_decision',$3,$3)
       ON CONFLICT (user_id,role) WHERE valid_to IS NULL DO NOTHING`,
      [randomUUID(), claimActor.userId, clock],
    )
    await pool.query(
      `INSERT INTO iam.sessions (
         session_id_hash,csrf_token_hash,user_id,anonymous_subject_id,roles_version,
         session_version,status,recent_auth_at,expires_at,created_at,last_seen_at,auth_method
       ) VALUES ($1,digest('fixture-review-csrf','sha256'),$2,$3,1,1,'active',$4,$5,$4,$4,'email_otp')
       ON CONFLICT (session_id_hash) DO UPDATE SET status='active',roles_version=1,
         recent_auth_at=EXCLUDED.recent_auth_at,expires_at=EXCLUDED.expires_at,last_seen_at=EXCLUDED.last_seen_at`,
      [sessionHash, claimActor.userId, anonymousSubjectId, clock, new Date(clock.getTime() + 86_400_000)],
    )
    await pool.query(
      `INSERT INTO workflow.submission_url_checks (
         check_id,owner_user_id,category_id,category_schema_version,input_hash,canonical_url,
         canonical_url_hash,redirect_chain_json,risk_result,access_result,category_result,
         duplicate_result,duplicate_candidates_json,risk_reasons_json,client_request_id,
         request_hash,request_id,checked_at,expires_at,created_at
       ) VALUES ($1,$2,'ai_learning_quiz','learning.v1',$3,'https://review-fixture.example/project',
         digest('https://review-fixture.example/project','sha256'),'[]'::jsonb,'allowed','accessible',
         'matched','none','[]'::jsonb,'[]'::jsonb,'review-fixture-url',$3,'review_fixture_url',
         $4,$5,$4)`,
      [checkId, ownerUserId, 'a'.repeat(64), clock, new Date(clock.getTime() + 86_400_000)],
    )
    await pool.query(
      `INSERT INTO workflow.submission_drafts (
         draft_id,submission_chain_id,owner_user_id,category_id,category_schema_version,check_id,
         draft_revision,payload_snapshot,media_reference_ids_json,evidence_draft_ids_json,
         asset_drafts_json,status,version,idempotency_key,request_hash,created_at,updated_at,
         saved_at,expires_at
       ) VALUES ($1,$2,$3,'ai_learning_quiz','learning.v1',$4,1,$5::jsonb,'[]'::jsonb,
         '[]'::jsonb,'[]'::jsonb,'submitted',1,'review-fixture-draft',$6,$7,$7,$7,$8)`,
      [draftId, chainId, ownerUserId, checkId, JSON.stringify({
        category_id: 'ai_learning_quiz',
        category_schema_version: 'learning.v1',
        project_core: { current_name: 'Review fixture' },
        category_data: {},
      }), 'b'.repeat(64), clock, new Date(clock.getTime() + 86_400_000)],
    )
    await pool.query(
      `INSERT INTO workflow.review_work_items (
         work_item_id,work_type,target_type,target_id,status,version,created_at,updated_at
       ) VALUES ($1,'submission','submission',$2,'queued',1,$3,$3)`,
      [workItemId, submissionId, clock],
    )
    await pool.query(
      `INSERT INTO workflow.submissions (
         submission_id,submission_chain_id,draft_id,owner_user_id,snapshot_version,payload_snapshot,
         evidence_draft_ids_json,media_reference_ids_json,review_status,review_work_item_id,
         preview_hash,idempotency_key,request_hash,version,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,1,$5::jsonb,'[]'::jsonb,'[]'::jsonb,'pending_review',$6,$7,
         'review-fixture-submission',$8,1,$9,$9)`,
      [submissionId, chainId, draftId, ownerUserId, JSON.stringify({
        category_id: 'ai_learning_quiz',
        category_schema_version: 'learning.v1',
      }), workItemId, 'c'.repeat(64), 'd'.repeat(64), clock],
    )
    await pool.query(
      `INSERT INTO workflow.review_work_item_conflict_principals (
         work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
       ) VALUES ($1,$2,'submission_owner',$3,1,$4)`,
      [workItemId, ownerUserId, submissionId, clock],
    )

    const workflow = new WorkflowService(new PostgresWorkflowStore(pool), {
      cursorSecret: tokenSecret,
      leaseSeconds: 60,
      maximumClaimSeconds: 3_600,
      queuePageSize: 25,
    }, () => clock)
    const claim = await workflow.claimWorkItem({
      actor: claimActor,
      workItemId,
      expectedVersion: 1,
      expectedConflictPrincipalVersion: null,
      requestId: 'review_fixture_claim',
    })
    const adminSecurity = new AdminOperationSecurityService(
      new PostgresAdminOperationSecurityStore(pool),
      {
        tokenSecret,
        authTokenSecret: authSecret,
        previewTtlSeconds: 600,
        confirmTtlSeconds: 120,
        recentAuthWindowSeconds: 300,
      },
      () => clock,
    )
    const preview = await adminSecurity.preview({
      actor: claimActor,
      sessionToken,
      operationType: 'submission_review',
      targets: [{ target_type: 'submission', target_id: submissionId }],
      expectedVersions: { submission: 1, work_item: claim.version },
      proposedDiff: { review_status: 'approved' },
      reasonCode: 'submission_approved',
      claimToken: claim.claim_token,
      expectedConflictPrincipalVersion: null,
      requestId: 'review_fixture_preview',
    })
    const confirm = await adminSecurity.confirm({
      actor: claimActor,
      sessionToken,
      previewToken: preview.preview_token,
      confirmationSummaryHash: preview.confirmation_summary_hash,
      confirmRequestId: 'review_fixture_confirm',
      reauthGrantId: null,
      expectedConflictPrincipalVersion: null,
      requestId: 'review_fixture_confirm_1',
    })
    const decisions = new ReviewDecisionService(
      new PostgresReviewDecisionStore(pool),
      { tokenSecret, authTokenSecret: authSecret },
      () => clock,
    )
    const command = {
      actor: claimActor,
      sessionToken,
      workItemId,
      previewToken: preview.preview_token,
      claimToken: claim.claim_token,
      confirmToken: confirm.confirm_token,
      decision: 'approve',
      reasonCode: 'submission_approved',
      fieldPaths: [],
      decisionEvidenceRefs: [],
      expectedVersion: claim.version,
      decisionRequestId: 'review_fixture_decision',
      decisionPayload: {},
      requestId: 'review_fixture_decision_1',
    } as const
    const decided = await decisions.decideSubmission(command)
    const replayed = await decisions.decideSubmission(command)
    assert.equal(replayed.review_decision_id, decided.review_decision_id)
    await assert.rejects(
      () => decisions.decideSubmission({ ...command, reasonCode: 'submission_approved_retry' }),
      (error: unknown) => typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'REVIEW_DECISION_REQUEST_CONFLICT',
    )

    const verified = await pool.query<{
      readonly review_status: string
      readonly resulting_project_id: string | null
      readonly submission_version: number
      readonly work_item_status: string
      readonly work_item_version: number
      readonly decision_ref_type: string
      readonly decision_ref_id: string
      readonly decision_count: number
      readonly outbox_count: number
      readonly decided_event_count: number
      readonly consumed_event_count: number
      readonly audit_count: number
      readonly confirm_status: string
      readonly preview_status: string
    }>(
      `SELECT submission.review_status,submission.resulting_project_id,
         submission.version AS submission_version,item.status AS work_item_status,
         item.version AS work_item_version,item.decision_ref_type,item.decision_ref_id,
         (SELECT count(*)::int FROM workflow.review_decisions WHERE work_item_id=item.work_item_id) AS decision_count,
         (SELECT count(*)::int FROM ops.outbox_events WHERE aggregate_type='submission'
            AND aggregate_id=submission.submission_id::text AND event_name='submission_approved') AS outbox_count,
         (SELECT count(*)::int FROM workflow.review_work_item_events
            WHERE work_item_id=item.work_item_id AND event_type='decided') AS decided_event_count,
         (SELECT count(*)::int FROM workflow.admin_operation_security_events
            WHERE preview_id=preview.preview_id AND event_type='confirm_consumed') AS consumed_event_count,
         (SELECT count(*)::int FROM audit.audit_logs WHERE operation_id='OP-ADMIN-DECISION'
            AND target_id=submission.submission_id::text) AS audit_count,
         confirm.status AS confirm_status,preview.status AS preview_status
       FROM workflow.submissions submission
       JOIN workflow.review_work_items item ON item.work_item_id=submission.review_work_item_id
       JOIN workflow.review_decisions decision ON decision.work_item_id=item.work_item_id
       JOIN workflow.admin_operation_previews preview ON preview.confirmation_summary_hash=decision.confirmation_summary_hash
       JOIN workflow.admin_operation_confirm_grants confirm ON confirm.preview_id=preview.preview_id
       WHERE submission.submission_id=$1 AND decision.review_decision_id=$2`,
      [submissionId, decided.review_decision_id],
    )
    assert.deepEqual(verified.rows[0], {
      review_status: 'approved',
      resulting_project_id: null,
      submission_version: 2,
      work_item_status: 'decided',
      work_item_version: 3,
      decision_ref_type: 'review_decision',
      decision_ref_id: decided.review_decision_id,
      decision_count: 1,
      outbox_count: 1,
      decided_event_count: 1,
      consumed_event_count: 1,
      audit_count: 1,
      confirm_status: 'consumed',
      preview_status: 'consumed',
    })
    const projectCountAfter = await pool.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM catalog.projects',
    )
    assert.equal(projectCountAfter.rows[0]?.count, projectCountBefore.rows[0]?.count)
    await assert.rejects(
      () => pool.query(
        `UPDATE workflow.review_decisions SET reason_code='tampered'
         WHERE review_decision_id=$1`,
        [decided.review_decision_id],
      ),
      /REVIEW_DECISION_IMMUTABLE/,
    )
  }

  process.stdout.write('review_decision_fixture_ok\n')
} finally {
  await pool.end()
}
