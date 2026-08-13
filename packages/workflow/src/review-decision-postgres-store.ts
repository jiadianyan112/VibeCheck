import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { workflowError } from './errors.js'
import type { ReviewDecisionStore } from './review-decision-store.js'
import type {
  ReviewDecisionProjection,
  StoredSubmissionReviewDecisionInput,
  SubmissionReviewDecision,
} from './review-decision-types.js'

interface WorkItemRow extends QueryResultRow {
  readonly work_item_id: string
  readonly work_type: string
  readonly target_type: string
  readonly target_id: string
  readonly status: string
  readonly assignee_user_id: string | null
  readonly claim_token_hash: Buffer | null
  readonly lease_expires_at: Date | null
  readonly version: number
}

interface SubmissionRow extends QueryResultRow {
  readonly submission_id: string
  readonly draft_id: string
  readonly owner_user_id: string
  readonly review_status: string
  readonly review_work_item_id: string
  readonly evidence_draft_ids_json: unknown
  readonly media_reference_ids_json: unknown
  readonly version: number
}

interface PreviewRow extends QueryResultRow {
  readonly preview_id: string
  readonly actor_user_id: string
  readonly primary_session_id_hash: Buffer
  readonly roles_version: string
  readonly operation_type: string
  readonly targets_json: unknown
  readonly expected_versions_json: unknown
  readonly proposed_diff_json: unknown
  readonly reason_code: string
  readonly claim_token_hash: Buffer | null
  readonly diff_hash: string
  readonly impact_hash: string
  readonly confirmation_summary_hash: string
  readonly status: string
  readonly expires_at: Date
}

interface ConfirmRow extends QueryResultRow {
  readonly confirm_grant_id: string
  readonly preview_id: string
  readonly actor_user_id: string
  readonly primary_session_id_hash: Buffer
  readonly roles_version: string
  readonly confirmation_summary_hash: string
  readonly status: string
  readonly expires_at: Date
}

interface DecisionRow extends QueryResultRow {
  readonly review_decision_id: string
  readonly decision_request_id: string
  readonly work_item_id: string
  readonly target_id: string
  readonly decision: SubmissionReviewDecision
  readonly decision_payload_hash: string
  readonly resulting_status: 'approved' | 'changes_requested' | 'rejected'
  readonly transaction_id: string
  readonly committed_at: Date
}

export class PostgresReviewDecisionStore implements ReviewDecisionStore {
  constructor(private readonly pool: Pool) {}

  async decideSubmission(
    input: StoredSubmissionReviewDecisionInput,
  ): Promise<ReviewDecisionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const activeRolesVersion = await this.activeSession(client, input)

      const replay = await client.query<DecisionRow>(
        `SELECT review_decision_id,decision_request_id,work_item_id,target_id,decision,
           decision_payload_hash,resulting_status,transaction_id,committed_at
         FROM workflow.review_decisions
         WHERE actor_user_id=$1 AND work_item_id=$2 AND decision_request_id=$3`,
        [input.actor.userId, input.workItemId, input.decisionRequestId],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].decision_payload_hash !== input.decisionPayloadHash) {
          throw workflowError('REVIEW_DECISION_REQUEST_CONFLICT', 409)
        }
        await client.query('COMMIT')
        return this.projection(replay.rows[0])
      }

      const workItem = await this.workItem(client, input.workItemId)
      if (!workItem) throw workflowError('WORK_ITEM_NOT_FOUND', 404)
      if (workItem.version !== input.expectedVersion) {
        throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: workItem.version,
        })
      }
      if (workItem.work_type !== 'submission' || workItem.target_type !== 'submission') {
        throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
      }
      if (workItem.status !== 'claimed') throw workflowError('WORK_ITEM_NOT_CLAIMED', 409)
      if (workItem.assignee_user_id !== input.actor.userId) {
        throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN', 403)
      }
      if (!workItem.claim_token_hash || !workItem.claim_token_hash.equals(input.claimTokenHash)) {
        throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN', 403)
      }
      if (!workItem.lease_expires_at || workItem.lease_expires_at <= input.now) {
        throw workflowError('WORK_ITEM_LEASE_EXPIRED', 410)
      }
      await this.assertNoConflict(client, workItem.work_item_id, input.actor.userId)

      const submissionResult = await client.query<SubmissionRow>(
        'SELECT * FROM workflow.submissions WHERE submission_id=$1 FOR UPDATE',
        [workItem.target_id],
      )
      const submission = submissionResult.rows[0]
      if (!submission) throw workflowError('REVIEW_TARGET_NOT_FOUND', 404)
      if (
        submission.review_work_item_id !== workItem.work_item_id ||
        submission.review_status !== 'pending_review'
      ) throw workflowError('REVIEW_TARGET_STATE_CONFLICT', 409)
      if (submission.owner_user_id === input.actor.userId) {
        throw workflowError('CONFLICT_OF_INTEREST', 403)
      }

      const preview = await this.preview(client, input.previewTokenHash)
      this.assertPreview(preview, input, workItem, submission, activeRolesVersion)
      const confirm = await this.confirm(client, input.confirmTokenHash)
      this.assertConfirm(confirm, preview, input)
      await this.assertEvidenceRefs(client, input.decisionEvidenceRefs)
      if (input.decision === 'approve') await this.assertPublishDependencies(client, submission)

      const reviewDecisionId = randomUUID()
      const transactionId = randomUUID()
      const previewHash = this.hash(this.canonicalJson({
        confirmation_summary_hash: preview.confirmation_summary_hash,
        diff_hash: preview.diff_hash,
        expected_versions: preview.expected_versions_json,
        impact_hash: preview.impact_hash,
        operation_type: preview.operation_type,
        preview_id: preview.preview_id,
        reason_code: preview.reason_code,
        targets: preview.targets_json,
      }))
      const inserted = await client.query<DecisionRow>(
        `INSERT INTO workflow.review_decisions (
           review_decision_id,decision_request_id,work_item_id,work_type,target_type,target_id,
           decision,actor_user_id,project_id,base_version_id,reason_code,field_paths_json,
           decision_evidence_refs_json,preview_hash,confirmation_summary_hash,
           decision_payload_hash,resulting_status,transaction_id,committed_at,schema_version
         ) VALUES (
           $1,$2,$3,'submission','submission',$4,$5,$6,NULL,NULL,$7,$8::jsonb,$9::jsonb,
           $10,$11,$12,$13,$14,$15,'review_decision.v1'
         ) RETURNING review_decision_id,decision_request_id,work_item_id,target_id,decision,
           decision_payload_hash,resulting_status,transaction_id,committed_at`,
        [
          reviewDecisionId, input.decisionRequestId, workItem.work_item_id, submission.submission_id,
          input.decision, input.actor.userId, input.reasonCode, JSON.stringify(input.fieldPaths),
          JSON.stringify(input.decisionEvidenceRefs), previewHash, preview.confirmation_summary_hash,
          input.decisionPayloadHash, input.resultingStatus, transactionId, input.now,
        ],
      )

      const updatedSubmission = await client.query(
        `UPDATE workflow.submissions SET review_status=$2,version=version+1,
           decided_at=$3,updated_at=$3
         WHERE submission_id=$1 AND review_status='pending_review' AND version=$4`,
        [submission.submission_id, input.resultingStatus, input.now, submission.version],
      )
      if (updatedSubmission.rowCount !== 1) throw workflowError('REVIEW_TARGET_STATE_CONFLICT', 409)

      const updatedWorkItem = await client.query<WorkItemRow>(
        `UPDATE workflow.review_work_items SET status='decided',assignee_user_id=NULL,
           claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,
           conflict_principal_version_at_claim=NULL,decision_ref_type='review_decision',
           decision_ref_id=$2,version=version+1,updated_at=$3
         WHERE work_item_id=$1 AND status='claimed' AND version=$4 RETURNING *`,
        [workItem.work_item_id, reviewDecisionId, input.now, workItem.version],
      )
      const decidedWorkItem = updatedWorkItem.rows[0]
      if (!decidedWorkItem) throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409)

      const consumedConfirm = await client.query(
        `UPDATE workflow.admin_operation_confirm_grants SET status='consumed',consumed_at=$2
         WHERE confirm_grant_id=$1 AND status='active'`,
        [confirm.confirm_grant_id, input.now],
      )
      if (consumedConfirm.rowCount !== 1) throw workflowError('CONFIRM_TOKEN_CONSUMED', 410)
      const consumedPreview = await client.query(
        `UPDATE workflow.admin_operation_previews SET status='consumed',consumed_at=$2
         WHERE preview_id=$1 AND status IN ('active','reauth_required')`,
        [preview.preview_id, input.now],
      )
      if (consumedPreview.rowCount !== 1) throw workflowError('PREVIEW_TOKEN_CONSUMED', 410)

      await this.writeFacts(client, {
        input,
        workItem,
        decidedWorkItem,
        submission,
        reviewDecisionId,
        transactionId,
        preview,
        confirm,
      })
      await client.query('COMMIT')
      return this.projection(inserted.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async activeSession(
    client: PoolClient,
    input: StoredSubmissionReviewDecisionInput,
  ): Promise<number> {
    const result = await client.query<{
      readonly user_id: string
      readonly roles_version: string
      readonly role_version: string
      readonly user_status: string
    } & QueryResultRow>(
      `SELECT session.user_id,session.roles_version,user_account.role_version,
         user_account.status AS user_status
       FROM iam.sessions session
       JOIN iam.users user_account ON user_account.user_id=session.user_id
       WHERE session.session_id_hash=$1 AND session.status='active'
         AND session.expires_at>$2 FOR UPDATE OF session`,
      [input.primarySessionIdHash, input.now],
    )
    const session = result.rows[0]
    if (
      !session || session.user_id !== input.actor.userId || session.user_status !== 'active' ||
      session.roles_version !== session.role_version
    ) throw workflowError('SESSION_INVALID', 401)
    return Number(session.roles_version)
  }

  private async workItem(client: PoolClient, workItemId: string): Promise<WorkItemRow | null> {
    const result = await client.query<WorkItemRow>(
      'SELECT * FROM workflow.review_work_items WHERE work_item_id=$1 FOR UPDATE',
      [workItemId],
    )
    return result.rows[0] ?? null
  }

  private async preview(client: PoolClient, tokenHash: Buffer): Promise<PreviewRow> {
    const result = await client.query<PreviewRow>(
      'SELECT * FROM workflow.admin_operation_previews WHERE preview_token_hash=$1 FOR UPDATE',
      [tokenHash],
    )
    if (!result.rows[0]) throw workflowError('PREVIEW_TOKEN_INVALID', 403)
    return result.rows[0]
  }

  private async confirm(client: PoolClient, tokenHash: Buffer): Promise<ConfirmRow> {
    const result = await client.query<ConfirmRow>(
      `SELECT * FROM workflow.admin_operation_confirm_grants
       WHERE confirm_token_hash=$1 FOR UPDATE`,
      [tokenHash],
    )
    if (!result.rows[0]) throw workflowError('CONFIRM_TOKEN_INVALID', 403)
    return result.rows[0]
  }

  private assertPreview(
    preview: PreviewRow,
    input: StoredSubmissionReviewDecisionInput,
    workItem: WorkItemRow,
    submission: SubmissionRow,
    activeRolesVersion: number,
  ): void {
    if (preview.expires_at <= input.now || preview.status === 'expired') {
      throw workflowError('PREVIEW_TOKEN_EXPIRED', 410)
    }
    if (!['active', 'reauth_required'].includes(preview.status)) {
      throw workflowError(`PREVIEW_TOKEN_${preview.status.toUpperCase()}`, 410)
    }
    if (
      preview.actor_user_id !== input.actor.userId ||
      !preview.primary_session_id_hash.equals(input.primarySessionIdHash) ||
      Number(preview.roles_version) !== activeRolesVersion
    ) throw workflowError('PREVIEW_BINDING_MISMATCH', 403)
    if (preview.operation_type !== 'submission_review') {
      throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
    }
    if (!preview.claim_token_hash || !preview.claim_token_hash.equals(input.claimTokenHash)) {
      throw workflowError('PREVIEW_BINDING_MISMATCH', 403)
    }
    const targets = [{ target_type: 'submission', target_id: submission.submission_id }]
    const expectedVersions = { submission: submission.version, work_item: workItem.version }
    const diff = { review_status: input.resultingStatus }
    if (
      this.canonicalJson(preview.targets_json) !== this.canonicalJson(targets) ||
      this.canonicalJson(preview.expected_versions_json) !== this.canonicalJson(expectedVersions) ||
      this.canonicalJson(preview.proposed_diff_json) !== this.canonicalJson(diff) ||
      preview.reason_code !== input.reasonCode
    ) throw workflowError('PREVIEW_BINDING_STALE', 409)
  }

  private assertConfirm(
    confirm: ConfirmRow,
    preview: PreviewRow,
    input: StoredSubmissionReviewDecisionInput,
  ): void {
    if (confirm.expires_at <= input.now || confirm.status === 'expired') {
      throw workflowError('CONFIRM_TOKEN_EXPIRED', 410)
    }
    if (confirm.status !== 'active') {
      throw workflowError(`CONFIRM_TOKEN_${confirm.status.toUpperCase()}`, 410)
    }
    if (
      confirm.preview_id !== preview.preview_id || confirm.actor_user_id !== input.actor.userId ||
      !confirm.primary_session_id_hash.equals(input.primarySessionIdHash) ||
      Number(confirm.roles_version) !== Number(preview.roles_version) ||
      confirm.confirmation_summary_hash !== preview.confirmation_summary_hash
    ) throw workflowError('CONFIRM_BINDING_MISMATCH', 403)
  }

  private async assertNoConflict(
    client: PoolClient,
    workItemId: string,
    actorUserId: string,
  ): Promise<void> {
    const result = await client.query<{ readonly present: boolean } & QueryResultRow>(
      `SELECT EXISTS (
         SELECT 1 FROM workflow.review_work_item_conflict_principals
         WHERE work_item_id=$1 AND principal_user_id=$2 AND revoked_at IS NULL
       ) AS present`,
      [workItemId, actorUserId],
    )
    if (result.rows[0]?.present) throw workflowError('CONFLICT_OF_INTEREST', 403)
  }

  private async assertEvidenceRefs(client: PoolClient, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const result = await client.query<{ readonly count: number } & QueryResultRow>(
      'SELECT count(*)::int AS count FROM catalog.evidence WHERE evidence_id=ANY($1::uuid[])',
      [ids],
    )
    if (result.rows[0]?.count !== ids.length) {
      throw workflowError('DECISION_EVIDENCE_REFS_INVALID', 422)
    }
  }

  private async assertPublishDependencies(client: PoolClient, submission: SubmissionRow): Promise<void> {
    const evidenceIds = this.uuidArray(submission.evidence_draft_ids_json)
    if (evidenceIds.length > 0) {
      const evidence = await client.query<{ readonly count: number } & QueryResultRow>(
        `SELECT count(*)::int AS count FROM workflow.evidence_drafts
         WHERE evidence_draft_id=ANY($1::uuid[]) AND parent_type='submission_draft'
           AND parent_id=$2 AND owner_user_id=$3 AND status='ready'`,
        [evidenceIds, submission.draft_id, submission.owner_user_id],
      )
      if (evidence.rows[0]?.count !== evidenceIds.length) {
        throw workflowError('SUBMISSION_EVIDENCE_NOT_READY', 409)
      }
    }
    const mediaIds = this.uuidArray(submission.media_reference_ids_json)
    if (mediaIds.length > 0) {
      const media = await client.query<{ readonly count: number } & QueryResultRow>(
        `SELECT count(*)::int AS count FROM media.media_references reference
         JOIN media.media_resources resource
           ON resource.media_resource_id=reference.media_resource_id
         WHERE reference.media_reference_id=ANY($1::uuid[])
           AND reference.target_type='submission_draft' AND reference.target_id=$2
           AND reference.lifecycle_status='active' AND resource.owner_user_id=$3
           AND resource.status='ready' AND resource.scan_result='clean'
           AND resource.deletion_guard_job_id IS NULL`,
        [mediaIds, submission.draft_id, submission.owner_user_id],
      )
      if (media.rows[0]?.count !== mediaIds.length) {
        throw workflowError('SUBMISSION_MEDIA_NOT_READY', 409)
      }
    }
  }

  private async writeFacts(
    client: PoolClient,
    context: {
      readonly input: StoredSubmissionReviewDecisionInput
      readonly workItem: WorkItemRow
      readonly decidedWorkItem: WorkItemRow
      readonly submission: SubmissionRow
      readonly reviewDecisionId: string
      readonly transactionId: string
      readonly preview: PreviewRow
      readonly confirm: ConfirmRow
    },
  ): Promise<void> {
    const { input, workItem, decidedWorkItem, submission, reviewDecisionId, transactionId, preview, confirm } = context
    await client.query(
      `INSERT INTO workflow.review_work_item_events (
         event_id,work_item_id,event_type,actor_user_id,from_status,to_status,
         work_item_version,reason_code,metadata_json,occurred_at
       ) VALUES ($1,$2,'decided',$3,'claimed','decided',$4,$5,$6::jsonb,$7)`,
      [randomUUID(), workItem.work_item_id, input.actor.userId, decidedWorkItem.version,
        input.reasonCode, JSON.stringify({ review_decision_id: reviewDecisionId }), input.now],
    )
    await client.query(
      `INSERT INTO workflow.admin_operation_security_events (
         security_event_id,preview_id,confirm_grant_id,actor_user_id,event_type,
         request_id,metadata_json,occurred_at
       ) VALUES ($1,$2,$3,$4,'confirm_consumed',$5,$6::jsonb,$7)`,
      [randomUUID(), preview.preview_id, confirm.confirm_grant_id, input.actor.userId,
        input.requestId, JSON.stringify({ review_decision_id: reviewDecisionId }), input.now],
    )
    const eventName = input.decision === 'approve'
      ? 'submission_approved'
      : input.decision === 'reject'
        ? 'submission_rejected'
        : 'submission_changes_requested'
    await client.query(
      `INSERT INTO ops.outbox_events (
         outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,
         payload_json,transaction_id,status,next_attempt_at,created_at
       ) VALUES ($1,$2,'submission',$3,$4,$5,$6::jsonb,$7,'pending',$8,$8)`,
      [randomUUID(), randomUUID(), submission.submission_id, eventName, submission.version + 1,
        JSON.stringify({
          review_decision_id: reviewDecisionId,
          submission_id: submission.submission_id,
          resulting_status: input.resultingStatus,
        }), transactionId, input.now],
    )
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at
       ) VALUES ($1,'OP-ADMIN-DECISION',$2,$3,$4::jsonb,'submission',$5,$6,$7,$8::jsonb,
         $9,$10,$11,'succeeded',$12)`,
      [randomUUID(), input.actor.roles.includes('admin') ? 'admin' : 'platform_editor',
        createHash('sha256').update(input.actor.userId).digest(), JSON.stringify(input.actor.roles),
        submission.submission_id,
        this.hash(this.canonicalJson({ review_status: submission.review_status, version: submission.version })),
        this.hash(this.canonicalJson({ review_status: input.resultingStatus, version: submission.version + 1 })),
        JSON.stringify({ review_status: input.resultingStatus, review_decision_id: reviewDecisionId }),
        input.reasonCode, input.requestId, transactionId, input.now],
    )
  }

  private projection(row: DecisionRow): ReviewDecisionProjection {
    return Object.freeze({
      review_decision_id: row.review_decision_id,
      work_item_id: row.work_item_id,
      work_type: 'submission',
      target_type: 'submission',
      target_id: row.target_id,
      decision: row.decision,
      project_id: null,
      base_version_id: null,
      resulting_status: row.resulting_status,
      work_item_status: 'decided',
      work_item_decision_ref_type: 'review_decision',
      transaction_id: row.transaction_id,
      committed_at: row.committed_at.toISOString(),
      schema_version: 'review_decision.v1',
      domain_status: row.resulting_status,
      outbox_status: 'pending',
    })
  }

  private uuidArray(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw workflowError('REVIEW_TARGET_STATE_INVALID', 500, true)
    }
    return value as readonly string[]
  }

  private canonicalJson(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'number') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`
    if (typeof value !== 'object') throw workflowError('REVIEW_TARGET_STATE_INVALID', 500, true)
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`
    )).join(',')}}`
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
