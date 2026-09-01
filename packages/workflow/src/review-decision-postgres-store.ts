import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { workflowError } from './errors.js'
import type { ReviewDecisionStore } from './review-decision-store.js'
import type {
  ReviewDecisionProjection,
  StoredReviewDecisionInput,
  ReviewDecisionValue,
  OwnershipDecisionPayload,
  VerificationApprovePayload,
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

interface ProjectUpdateRow extends QueryResultRow {
  readonly update_id: string
  readonly owner_user_id: string
  readonly project_id: string
  readonly base_version_id: string
  readonly status: string
  readonly review_work_item_id: string
  readonly version: string
}

interface VerificationRequestRow extends QueryResultRow {
  readonly verification_id: string
  readonly project_id: string
  readonly applicant_user_id: string
  readonly creator_resolution_mode: 'use_existing_link' | 'create_new_creator' | 'claim_existing_creator'
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input_json: unknown
  readonly link_policy_snapshot_json: unknown
  readonly status: string
  readonly review_work_item_id: string
  readonly version: string
}

interface OwnershipCaseRow extends QueryResultRow {
  readonly case_id:string
  readonly project_id:string
  readonly author_relation_id:string
  readonly status:'open'|'investigating'|'resolved_upheld'|'resolved_revoked'|'withdrawn'
  readonly review_work_item_id:string
  readonly active_withdrawal_request_id:string|null
  readonly latest_withdrawal_request_id:string|null
  readonly conflict_principal_version:number
  readonly version:string
}

interface OwnershipRelationRow extends QueryResultRow {
  readonly author_relation_id:string
  readonly project_id:string
  readonly status:'active'|'suspended'|'terminated'|'replaced'
  readonly version:string
}

interface CreatorRow extends QueryResultRow {
  readonly creator_id: string
  readonly current_profile_version_id: string | null
  readonly aggregate_version: string
  readonly owner_link_set_version: string
  readonly canonical_creator_id: string | null
  readonly merge_status: string
}

interface CreatorAccountLinkRow extends QueryResultRow {
  readonly creator_account_link_id: string
  readonly user_id: string
  readonly creator_id: string
  readonly link_role: 'owner' | 'manager'
  readonly permission_profile_id: 'OWNER_V1' | 'MANAGER_V1'
  readonly permission_profile_version: number
  readonly permission_profile_config_hash: string
  readonly status: string
  readonly version: string
}

interface LinkPermissionProfileRow extends QueryResultRow {
  readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
  readonly profile_version: number
  readonly profile_family: 'owner' | 'manager'
  readonly config_hash: string
  readonly capabilities_json: unknown
  readonly field_path_ceiling_json: unknown
}

interface VerificationApprovalResult {
  readonly creatorId: string
  readonly linkId: string
  readonly relationId: string
  readonly profileVersionId: string | null
  readonly linkRole: 'owner' | 'manager'
  readonly profile: LinkPermissionProfileRow
  readonly effectiveFields: readonly string[]
  readonly capabilities: readonly string[]
  readonly creatorAggregateVersion: number
  readonly ownerLinkSetVersion: number
  readonly projectAggregateVersion: number
  readonly firstProjectAuthorLink: boolean
}

interface VerificationPolicySnapshot {
  readonly policy_version: 'creator_link.v1'
  readonly target_creator_aggregate_version: number | null
  readonly owner_link_set_version: number | null
  readonly observed_owner_link_id: string | null
  readonly observed_owner_link_version: number | null
  readonly reused_link_id: string | null
  readonly reused_link_version: number | null
  readonly allowed_link_roles: readonly ('owner' | 'manager')[]
  readonly default_link_role: 'owner' | 'manager'
  readonly allowed_permission_profile_refs: readonly Readonly<{
    readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
    readonly profile_version: 1
    readonly config_hash: string
  }>[]
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
  readonly work_type: 'submission' | 'project_update' | 'verification' | 'ownership_case'
  readonly target_type: 'submission' | 'project_update' | 'verification_request' | 'ownership_case'
  readonly decision: ReviewDecisionValue
  readonly project_id: string | null
  readonly base_version_id: string | null
  readonly decision_payload_hash: string
  readonly resulting_status: 'approved' | 'changes_requested' | 'rejected' | 'verified' | 'failed' | 'resolved_upheld' | 'resolved_revoked' | 'withdrawn'
  readonly transaction_id: string
  readonly committed_at: Date
}

interface VerificationProjectionRow extends QueryResultRow {
  readonly resulting_creator_id: string | null
  readonly resulting_link_id: string | null
  readonly resulting_author_relation_id: string | null
  readonly resulting_profile_version_id: string | null
  readonly approved_link_role: 'owner' | 'manager' | null
  readonly approved_permission_profile_id: 'OWNER_V1' | 'MANAGER_V1' | null
  readonly approved_permission_profile_version: number | null
  readonly approved_profile_config_hash: string | null
  readonly capabilities_json: unknown
  readonly field_path_ceiling_json: unknown
  readonly field_permissions_json: unknown
  readonly creator_aggregate_version: string | null
  readonly owner_link_set_version: string | null
}

export class PostgresReviewDecisionStore implements ReviewDecisionStore {
  constructor(private readonly pool: Pool) {}

  async decideReview(
    input: StoredReviewDecisionInput,
  ): Promise<ReviewDecisionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const activeRolesVersion = await this.activeSession(client, input)

      const replay = await client.query<DecisionRow>(
        `SELECT review_decision_id,decision_request_id,work_item_id,work_type,target_type,target_id,
           decision,project_id,base_version_id,decision_payload_hash,resulting_status,
           transaction_id,committed_at
         FROM workflow.review_decisions
         WHERE actor_user_id=$1 AND work_item_id=$2 AND decision_request_id=$3`,
        [input.actor.userId, input.workItemId, input.decisionRequestId],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].decision_payload_hash !== input.decisionPayloadHash) {
          throw workflowError('REVIEW_DECISION_REQUEST_CONFLICT', 409)
        }
        await client.query('COMMIT')
        const replayProjection = replay.rows[0].work_type === 'verification'
          ? await this.verificationProjection(client,replay.rows[0])
          : this.projection(replay.rows[0])
        return replayProjection
      }

      const workItem = await this.workItem(client, input.workItemId)
      if (!workItem) throw workflowError('WORK_ITEM_NOT_FOUND', 404)
      if (workItem.version !== input.expectedVersion) {
        throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: workItem.version,
        })
      }
      if (
        !['submission', 'project_update', 'verification', 'ownership_case'].includes(workItem.work_type) ||
        (workItem.work_type === 'verification'
          ? workItem.target_type !== 'verification_request'
          : workItem.target_type !== workItem.work_type)
      ) {
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

      this.assertWorkTypePermission(input,workItem.work_type)
      if (workItem.work_type === 'verification') {
        const projection = await this.decideVerification(client,input,workItem,activeRolesVersion)
        await client.query('COMMIT')
        return projection
      }
      if (workItem.work_type === 'ownership_case') {
        const projection=await this.decideOwnership(client,input,workItem,activeRolesVersion)
        await client.query('COMMIT')
        return projection
      }

      const submission = workItem.work_type === 'submission'
        ? (await client.query<SubmissionRow>(
            'SELECT * FROM workflow.submissions WHERE submission_id=$1 FOR UPDATE',
            [workItem.target_id],
          )).rows[0]
        : undefined
      const projectUpdate = workItem.work_type === 'project_update'
        ? (await client.query<ProjectUpdateRow>(
            'SELECT * FROM catalog.project_updates WHERE update_id=$1 FOR UPDATE',
            [workItem.target_id],
          )).rows[0]
        : undefined
      if (!submission && !projectUpdate) throw workflowError('REVIEW_TARGET_NOT_FOUND', 404)
      if (submission && (
        submission.review_work_item_id !== workItem.work_item_id ||
        submission.review_status !== 'pending_review'
      )) throw workflowError('REVIEW_TARGET_STATE_CONFLICT', 409)
      if (projectUpdate && (
        projectUpdate.review_work_item_id !== workItem.work_item_id ||
        projectUpdate.status !== 'update_pending'
      )) throw workflowError('REVIEW_TARGET_STATE_CONFLICT', 409)
      const target = submission ?? projectUpdate!
      if (target.owner_user_id === input.actor.userId) {
        throw workflowError('CONFLICT_OF_INTEREST', 403)
      }
      const targetVersion = this.targetVersion(target)

      const preview = await this.preview(client, input.previewTokenHash)
      this.assertPreview(preview, input, workItem, target, targetVersion, activeRolesVersion)
      const confirm = await this.confirm(client, input.confirmTokenHash)
      this.assertConfirm(confirm, preview, input)
      await this.assertEvidenceRefs(client, input.decisionEvidenceRefs)
      if (input.decision === 'approve' && submission) {
        await this.assertPublishDependencies(client, submission)
      }

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
           $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
           $13,$14,$15,$16,$17,$18,'review_decision.v1'
         ) RETURNING review_decision_id,decision_request_id,work_item_id,work_type,target_type,
           target_id,decision,project_id,base_version_id,decision_payload_hash,resulting_status,
           transaction_id,committed_at`,
        [
          reviewDecisionId, input.decisionRequestId, workItem.work_item_id, workItem.work_type,
          workItem.target_id, input.decision, input.actor.userId,
          projectUpdate?.project_id ?? null, projectUpdate?.base_version_id ?? null,
          input.reasonCode, JSON.stringify(input.fieldPaths),
          JSON.stringify(input.decisionEvidenceRefs), previewHash, preview.confirmation_summary_hash,
          input.decisionPayloadHash, input.resultingStatus, transactionId, input.now,
        ],
      )

      const updatedTarget = submission
        ? await client.query(
            `UPDATE workflow.submissions SET review_status=$2,version=version+1,
               decided_at=$3,updated_at=$3
             WHERE submission_id=$1 AND review_status='pending_review' AND version=$4`,
            [submission.submission_id, input.resultingStatus, input.now, submission.version],
          )
        : await client.query(
            `UPDATE catalog.project_updates SET status=$2::varchar,version=version+1,
               approved_at=CASE WHEN $2::varchar='approved' THEN $3 ELSE approved_at END,updated_at=$3
             WHERE update_id=$1 AND status='update_pending' AND version=$4`,
            [projectUpdate!.update_id, input.resultingStatus, input.now, targetVersion],
          )
      if (updatedTarget.rowCount !== 1) throw workflowError('REVIEW_TARGET_STATE_CONFLICT', 409)

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
        target,
        targetVersion,
        workType: workItem.work_type as 'submission' | 'project_update',
        reviewDecisionId,
        transactionId,
        preview,
        confirm,
      })
      await client.query('COMMIT')
      return this.projection(inserted.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw this.mapDatabaseConflict(error)
    } finally {
      client.release()
    }
  }

  private assertWorkTypePermission(input: StoredReviewDecisionInput,workType: string): void {
    if (input.actor.roles.includes('admin')) return
    const permission = ['verification','ownership_case'].includes(workType) ? 'admin:identity_review' : 'admin:review'
    if (!input.actor.permissions.includes(permission)) throw workflowError('WORK_ITEM_FORBIDDEN',403)
  }

  private async decideVerification(
    client: PoolClient,
    input: StoredReviewDecisionInput,
    workItem: WorkItemRow,
    activeRolesVersion: number,
  ): Promise<ReviewDecisionProjection> {
    const result = await client.query<VerificationRequestRow>(
      'SELECT * FROM workflow.verification_requests WHERE verification_id=$1 FOR UPDATE',
      [workItem.target_id],
    )
    const request = result.rows[0]
    if (!request) throw workflowError('REVIEW_TARGET_NOT_FOUND',404)
    if (request.review_work_item_id !== workItem.work_item_id || request.status !== 'pending') {
      throw workflowError('REVIEW_TARGET_STATE_CONFLICT',409)
    }
    if (request.applicant_user_id === input.actor.userId) throw workflowError('CONFLICT_OF_INTEREST',403)
    const targetVersion = this.targetVersion(request)
    const domainStatus = input.decision === 'approve'
      ? 'verified'
      : input.decision === 'reject' ? 'failed' : 'changes_requested'
    const payload = this.verificationPayload(input)
    const preview = await this.preview(client,input.previewTokenHash)
    this.assertPreview(preview,input,workItem,request,targetVersion,activeRolesVersion)
    const confirm = await this.confirm(client,input.confirmTokenHash)
    this.assertConfirm(confirm,preview,input)
    await this.assertEvidenceRefs(client,input.decisionEvidenceRefs)

    let approval: VerificationApprovalResult | null = null
    if (input.decision === 'approve') {
      approval = await this.applyVerificationApproval(client,request,payload!,input.now)
    }

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
       ) VALUES ($1,$2,$3,'verification','verification_request',$4,$5,$6,$7,NULL,$8,$9::jsonb,
         $10::jsonb,$11,$12,$13,$14,$15,$16,'review_decision.v1')
       RETURNING review_decision_id,decision_request_id,work_item_id,work_type,target_type,
         target_id,decision,project_id,base_version_id,decision_payload_hash,resulting_status,
         transaction_id,committed_at`,
      [reviewDecisionId,input.decisionRequestId,workItem.work_item_id,request.verification_id,
        input.decision,input.actor.userId,request.project_id,input.reasonCode,
        JSON.stringify(input.fieldPaths),JSON.stringify(input.decisionEvidenceRefs),previewHash,
        preview.confirmation_summary_hash,input.decisionPayloadHash,domainStatus,transactionId,input.now],
    )

    const updatedRequest = await client.query(
      `UPDATE workflow.verification_requests SET status=$2::varchar,
         decision=CASE WHEN $3::varchar='changes_requested' THEN NULL ELSE $3::varchar END,
         status_history_json=status_history_json||jsonb_build_array(
           jsonb_build_object('status',$2::text,'at',$4::timestamptz)
         ),decided_at=CASE WHEN $2::varchar='changes_requested' THEN NULL ELSE $4::timestamptz END,
         resulting_creator_id=$5,resulting_link_id=$6,resulting_author_relation_id=$7,
         resulting_profile_version_id=$8,approved_link_role=$9,
         approved_permission_profile_id=$10,approved_permission_profile_version=$11,
         approved_profile_config_hash=$12,version=version+1,
         updated_at=GREATEST($4::timestamptz,updated_at+interval '1 microsecond')
       WHERE verification_id=$1 AND status='pending' AND version=$13`,
      [request.verification_id,domainStatus,input.decision,input.now,
        approval?.creatorId ?? null,approval?.linkId ?? null,approval?.relationId ?? null,
        approval?.profileVersionId ?? null,approval?.linkRole ?? null,
        approval?.profile.profile_id ?? null,approval?.profile.profile_version ?? null,
        approval?.profile.config_hash ?? null,targetVersion],
    )
    if (updatedRequest.rowCount !== 1) throw workflowError('REVIEW_TARGET_STATE_CONFLICT',409)

    const updatedWorkItem = await client.query<WorkItemRow>(
      `UPDATE workflow.review_work_items SET status='decided',assignee_user_id=NULL,
         claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,
         conflict_principal_version_at_claim=NULL,decision_ref_type='review_decision',
         decision_ref_id=$2,version=version+1,updated_at=$3
       WHERE work_item_id=$1 AND status='claimed' AND version=$4 RETURNING *`,
      [workItem.work_item_id,reviewDecisionId,input.now,workItem.version],
    )
    const decidedWorkItem = updatedWorkItem.rows[0]
    if (!decidedWorkItem) throw workflowError('WORK_ITEM_VERSION_CONFLICT',409)
    await client.query(
      `UPDATE private_material.material_read_grants AS read_grant SET invalidated_at=$2
       FROM private_material.verification_materials material
       WHERE material.verification_id=$1 AND material.material_id=read_grant.material_id
         AND read_grant.consumed_at IS NULL AND read_grant.invalidated_at IS NULL`,
      [request.verification_id,input.now],
    )
    const consumedConfirm = await client.query(
      `UPDATE workflow.admin_operation_confirm_grants SET status='consumed',consumed_at=$2
       WHERE confirm_grant_id=$1 AND status='active'`,[confirm.confirm_grant_id,input.now],
    )
    if (consumedConfirm.rowCount !== 1) throw workflowError('CONFIRM_TOKEN_CONSUMED',410)
    const consumedPreview = await client.query(
      `UPDATE workflow.admin_operation_previews SET status='consumed',consumed_at=$2
       WHERE preview_id=$1 AND status IN ('active','reauth_required')`,[preview.preview_id,input.now],
    )
    if (consumedPreview.rowCount !== 1) throw workflowError('PREVIEW_TOKEN_CONSUMED',410)

    await client.query(
      `INSERT INTO workflow.review_work_item_events (
         event_id,work_item_id,event_type,actor_user_id,from_status,to_status,
         work_item_version,reason_code,metadata_json,occurred_at
       ) VALUES ($1,$2,'decided',$3,'claimed','decided',$4,$5,$6::jsonb,$7)`,
      [randomUUID(),workItem.work_item_id,input.actor.userId,decidedWorkItem.version,
        input.reasonCode,JSON.stringify({review_decision_id:reviewDecisionId}),input.now],
    )
    await client.query(
      `INSERT INTO workflow.admin_operation_security_events (
         security_event_id,preview_id,confirm_grant_id,actor_user_id,event_type,
         request_id,metadata_json,occurred_at
       ) VALUES ($1,$2,$3,$4,'confirm_consumed',$5,$6::jsonb,$7)`,
      [randomUUID(),preview.preview_id,confirm.confirm_grant_id,input.actor.userId,
        input.requestId,JSON.stringify({review_decision_id:reviewDecisionId}),input.now],
    )
    if (domainStatus !== 'changes_requested') {
      await this.writeVerificationOutbox(client,transactionId,request.verification_id,
        targetVersion+1,'author_verification_completed',{
          verification_id: request.verification_id,project_id: request.project_id,
          decision: input.decision,resulting_status: domainStatus,result: 'success',
          creator_id: approval?.creatorId ?? null,link_id: approval?.linkId ?? null,
          author_relation_id: approval?.relationId ?? null,
        },input.now)
    }
    if (approval?.firstProjectAuthorLink) {
      await this.writeVerificationOutbox(client,transactionId,request.project_id,
        approval.projectAggregateVersion,'project_author_linked',{
          project_id:request.project_id,creator_id:approval.creatorId,
          author_relation_id:approval.relationId,verification_id:request.verification_id,
        },input.now,'project')
    }
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at
       ) VALUES ($1,'OP-ADMIN-IDENTITY-DECISION',$2,$3,$4::jsonb,'verification_request',$5,
         $6,$7,$8::jsonb,$9,$10,$11,'succeeded',$12)`,
      [randomUUID(),input.actor.roles.includes('admin')?'admin':'platform_editor',
        createHash('sha256').update(input.actor.userId).digest(),JSON.stringify(input.actor.roles),
        request.verification_id,this.hash(this.canonicalJson({status:'pending',version:targetVersion})),
        this.hash(this.canonicalJson({status:domainStatus,version:targetVersion+1})),
        JSON.stringify({status:domainStatus,review_decision_id:reviewDecisionId,
          creator_id:approval?.creatorId ?? null,link_id:approval?.linkId ?? null,
          author_relation_id:approval?.relationId ?? null}),input.reasonCode,input.requestId,
        transactionId,input.now],
    )
    return approval
      ? this.verificationApprovalProjection(inserted.rows[0]!,approval)
      : this.verificationProjectionFromDecision(inserted.rows[0]!)
  }

  private async decideOwnership(
    client:PoolClient,
    input:StoredReviewDecisionInput,
    workItem:WorkItemRow,
    activeRolesVersion:number,
  ):Promise<ReviewDecisionProjection>{
    if(!['uphold','revoke','withdraw'].includes(input.decision))throw workflowError('REVIEW_DECISION_SCHEMA_INVALID',422)
    if(!input.actor.roles.includes('admin')&&!input.actor.permissions.includes('admin:identity_review'))throw workflowError('WORK_ITEM_FORBIDDEN',403)
    const caseRow=(await client.query<OwnershipCaseRow>('SELECT * FROM workflow.ownership_cases WHERE case_id=$1 FOR UPDATE',[workItem.target_id])).rows[0]
    if(!caseRow)throw workflowError('REVIEW_TARGET_NOT_FOUND',404)
    if(!['open','investigating'].includes(caseRow.status)||caseRow.review_work_item_id!==workItem.work_item_id)throw workflowError('REVIEW_TARGET_STATE_CONFLICT',409)
    const targetVersion=Number(caseRow.version)
    const payload=this.ownershipPayload(input)
    if(payload.expected_conflict_principal_version!==caseRow.conflict_principal_version)throw workflowError('CONFLICT_PRINCIPAL_VERSION_CONFLICT',409)
    if(workItem.conflict_principal_version_at_claim!==caseRow.conflict_principal_version)throw workflowError('CONFLICT_PRINCIPAL_VERSION_CONFLICT',409)
    const conflict=await client.query('SELECT 1 FROM workflow.ownership_conflict_principal_members WHERE case_id=$1 AND conflict_principal_version=$2 AND principal_user_id=$3 LIMIT 1',[caseRow.case_id,caseRow.conflict_principal_version,input.actor.userId])
    if(conflict.rowCount)throw workflowError('CONFLICT_OF_INTEREST',403)
    const liveConflict=await client.query<{present:boolean}&QueryResultRow>(`SELECT EXISTS (
      SELECT 1 FROM workflow.ownership_cases ownership
      JOIN catalog.author_relations relation ON relation.author_relation_id=ownership.author_relation_id
      WHERE ownership.case_id=$1 AND (
        ownership.opened_by_user_id=$2 OR ownership.appealed_user_id=$2 OR
        EXISTS (SELECT 1 FROM workflow.verification_requests verification WHERE verification.verification_id=relation.source_verification_id AND verification.applicant_user_id=$2) OR
        EXISTS (SELECT 1 FROM catalog.creator_account_links link WHERE link.creator_id=relation.creator_id AND link.user_id=$2 AND link.status IN ('active','suspended')) OR
        EXISTS (SELECT 1 FROM workflow.ownership_case_evidence_submissions evidence WHERE evidence.case_id=ownership.case_id AND evidence.submitted_by_user_id=$2) OR
        EXISTS (SELECT 1 FROM workflow.ownership_withdrawal_requests withdrawal WHERE withdrawal.case_id=ownership.case_id AND withdrawal.requested_by_user_id=$2)
      )
    ) AS present`,[caseRow.case_id,input.actor.userId]);if(liveConflict.rows[0]?.present)throw workflowError('CONFLICT_OF_INTEREST',403)
    const preview=await this.preview(client,input.previewTokenHash);this.assertPreview(preview,input,workItem,caseRow,targetVersion,activeRolesVersion)
    const confirm=await this.confirm(client,input.confirmTokenHash);this.assertConfirm(confirm,preview,input)
    await this.assertEvidenceRefs(client,input.decisionEvidenceRefs)
    const relation=(await client.query<OwnershipRelationRow>('SELECT author_relation_id,project_id,status,version FROM catalog.author_relations WHERE author_relation_id=$1 FOR UPDATE',[caseRow.author_relation_id])).rows[0]
    if(!relation||relation.project_id!==caseRow.project_id||relation.status!=='suspended')throw workflowError('AUTHOR_RELATION_STATE_CONFLICT',409)
    const withdrawalId=caseRow.active_withdrawal_request_id
    if(input.decision==='withdraw'){
      if(!withdrawalId||payload.withdrawal_request_id!==withdrawalId)throw workflowError('OWNERSHIP_WITHDRAWAL_REQUIRED',409)
      const active=await client.query('SELECT 1 FROM workflow.ownership_withdrawal_requests WHERE withdrawal_request_id=$1 AND case_id=$2 AND status=\'requested\' FOR UPDATE',[withdrawalId,caseRow.case_id]);if(!active.rowCount)throw workflowError('OWNERSHIP_WITHDRAWAL_NOT_ACTIVE',409)
    }else if(payload.withdrawal_request_id!==null)throw workflowError('REVIEW_DECISION_SCHEMA_INVALID',422)

    const reviewDecisionId=randomUUID(),transactionId=randomUUID()
    const resultingStatus=input.decision==='uphold'?'resolved_upheld':input.decision==='revoke'?'resolved_revoked':'withdrawn'
    const relationStatus=input.decision==='revoke'?'terminated':'active'
    const previewHash=this.hash(this.canonicalJson({confirmation_summary_hash:preview.confirmation_summary_hash,diff_hash:preview.diff_hash,expected_versions:preview.expected_versions_json,impact_hash:preview.impact_hash,operation_type:preview.operation_type,preview_id:preview.preview_id,reason_code:preview.reason_code,targets:preview.targets_json}))
    const inserted=await client.query<DecisionRow>(`INSERT INTO workflow.review_decisions (
      review_decision_id,decision_request_id,work_item_id,work_type,target_type,target_id,decision,
      actor_user_id,project_id,base_version_id,reason_code,field_paths_json,
      decision_evidence_refs_json,preview_hash,confirmation_summary_hash,decision_payload_hash,
      resulting_status,transaction_id,committed_at,schema_version
    ) VALUES ($1,$2,$3,'ownership_case','ownership_case',$4,$5,$6,$7,NULL,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,'review_decision.v1') RETURNING review_decision_id,decision_request_id,work_item_id,work_type,target_type,target_id,decision,project_id,base_version_id,decision_payload_hash,resulting_status,transaction_id,committed_at`,[reviewDecisionId,input.decisionRequestId,workItem.work_item_id,caseRow.case_id,input.decision,input.actor.userId,caseRow.project_id,input.reasonCode,JSON.stringify(input.fieldPaths),JSON.stringify(input.decisionEvidenceRefs),previewHash,preview.confirmation_summary_hash,input.decisionPayloadHash,resultingStatus,transactionId,input.now])
    const relationUpdated=await client.query(`UPDATE catalog.author_relations SET status=$2,version=version+1,updated_at=GREATEST($3,updated_at+interval '1 microsecond') WHERE author_relation_id=$1 AND status='suspended' AND version=$4`,[relation.author_relation_id,relationStatus,input.now,relation.version]);if(relationUpdated.rowCount!==1)throw workflowError('AUTHOR_RELATION_VERSION_CONFLICT',409)
    if(withdrawalId){const withdrawalStatus=input.decision==='withdraw'?'accepted':'closed_by_case_decision';const closed=await client.query(`UPDATE workflow.ownership_withdrawal_requests SET status=$2,decision_id=$3,decided_by_user_id=$4,decision_reason_code=$5,version=version+1,decided_at=$6 WHERE withdrawal_request_id=$1 AND status='requested'`,[withdrawalId,withdrawalStatus,reviewDecisionId,input.actor.userId,input.reasonCode,input.now]);if(closed.rowCount!==1)throw workflowError('OWNERSHIP_WITHDRAWAL_VERSION_CONFLICT',409)}
    const activeCount=await client.query<{count:string}&QueryResultRow>("SELECT count(*)::text count FROM catalog.author_relations WHERE project_id=$1 AND status='active'",[caseRow.project_id]);const hasActive=Number(activeCount.rows[0]?.count)>0
    const project=(await client.query<{review_status:string}&QueryResultRow>('SELECT review_status FROM catalog.projects WHERE project_id=$1 FOR UPDATE',[caseRow.project_id])).rows[0];if(!project)throw workflowError('PROJECT_NOT_FOUND',404)
    const projectStatus=['restricted','archived','deleted'].includes(project.review_status)?project.review_status:hasActive?'published_author':'published_platform'
    await client.query(`UPDATE catalog.projects SET review_status=$2,author_link_status=$3,completeness_level=$4,aggregate_version=aggregate_version+1,updated_at=$5 WHERE project_id=$1`,[caseRow.project_id,projectStatus,hasActive?'linked':'failed',hasActive?'complete':'pending_verification',input.now])
    const caseUpdated=await client.query(`UPDATE workflow.ownership_cases SET status=$2,decision=$3,decided_by_user_id=$4,review_decision_id=$5,active_withdrawal_request_id=NULL,resulting_author_relation_status=$6,resulting_project_status=$7,version=version+1,updated_at=GREATEST($8,updated_at+interval '1 microsecond'),decided_at=$8 WHERE case_id=$1 AND version=$9`,[caseRow.case_id,resultingStatus,input.decision,input.actor.userId,reviewDecisionId,relationStatus,projectStatus,input.now,caseRow.version]);if(caseUpdated.rowCount!==1)throw workflowError('OWNERSHIP_CASE_VERSION_CONFLICT',409)
    const decidedWork=(await client.query<WorkItemRow>(`UPDATE workflow.review_work_items SET status='decided',assignee_user_id=NULL,claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,conflict_principal_version_at_claim=NULL,decision_ref_type='review_decision',decision_ref_id=$2,version=version+1,updated_at=$3 WHERE work_item_id=$1 AND status='claimed' AND version=$4 RETURNING *`,[workItem.work_item_id,reviewDecisionId,input.now,workItem.version])).rows[0];if(!decidedWork)throw workflowError('WORK_ITEM_VERSION_CONFLICT',409)
    const consumedConfirm=await client.query("UPDATE workflow.admin_operation_confirm_grants SET status='consumed',consumed_at=$2 WHERE confirm_grant_id=$1 AND status='active'",[confirm.confirm_grant_id,input.now]);if(consumedConfirm.rowCount!==1)throw workflowError('CONFIRM_TOKEN_CONSUMED',410)
    const consumedPreview=await client.query("UPDATE workflow.admin_operation_previews SET status='consumed',consumed_at=$2 WHERE preview_id=$1 AND status IN ('active','reauth_required')",[preview.preview_id,input.now]);if(consumedPreview.rowCount!==1)throw workflowError('PREVIEW_TOKEN_CONSUMED',410)
    await client.query(`INSERT INTO workflow.review_work_item_events (event_id,work_item_id,event_type,actor_user_id,from_status,to_status,work_item_version,reason_code,metadata_json,occurred_at) VALUES ($1,$2,'decided',$3,'claimed','decided',$4,$5,$6::jsonb,$7)`,[randomUUID(),workItem.work_item_id,input.actor.userId,decidedWork.version,input.reasonCode,JSON.stringify({review_decision_id:reviewDecisionId}),input.now])
    await client.query(`INSERT INTO workflow.admin_operation_security_events (security_event_id,preview_id,confirm_grant_id,actor_user_id,event_type,request_id,metadata_json,occurred_at) VALUES ($1,$2,$3,$4,'confirm_consumed',$5,$6::jsonb,$7)`,[randomUUID(),preview.preview_id,confirm.confirm_grant_id,input.actor.userId,input.requestId,JSON.stringify({review_decision_id:reviewDecisionId}),input.now])
    const eventName=input.decision==='withdraw'?'ownership_dispute_withdrawn':'ownership_dispute_resolved'
    await this.writeVerificationOutbox(client,transactionId,caseRow.case_id,targetVersion+1,eventName,{case_id:caseRow.case_id,author_relation_id:caseRow.author_relation_id,project_id:caseRow.project_id,decision:input.decision,case_status:resultingStatus,resulting_author_relation_status:relationStatus,resulting_project_status:projectStatus,decision_id:reviewDecisionId,...(withdrawalId?{withdrawal_request_id:withdrawalId}:{}),result:'success'},input.now,'ownership_case')
    await client.query(`INSERT INTO audit.audit_logs (audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at) VALUES ($1,'OP-ADMIN-OWNERSHIP-DECISION',$2,$3,$4::jsonb,'ownership_case',$5,$6,$7,$8::jsonb,$9,$10,$11,'succeeded',$12)`,[randomUUID(),input.actor.roles.includes('admin')?'admin':'platform_editor',createHash('sha256').update(input.actor.userId).digest(),JSON.stringify(input.actor.roles),caseRow.case_id,this.hash(this.canonicalJson({status:caseRow.status,version:targetVersion})),this.hash(this.canonicalJson({status:resultingStatus,version:targetVersion+1})),JSON.stringify({decision:input.decision,relation_status:relationStatus,project_status:projectStatus,withdrawal_request_id:withdrawalId}),input.reasonCode,input.requestId,transactionId,input.now])
    return this.projection(inserted.rows[0]!)
  }

  private ownershipPayload(input:StoredReviewDecisionInput):OwnershipDecisionPayload {
    const payload=input.decisionPayload as Partial<OwnershipDecisionPayload>
    if(!Number.isSafeInteger(payload.expected_conflict_principal_version)||Number(payload.expected_conflict_principal_version)<1||!('withdrawal_request_id' in payload))throw workflowError('REVIEW_DECISION_SCHEMA_INVALID',422)
    return payload as OwnershipDecisionPayload
  }

  private verificationPayload(input: StoredReviewDecisionInput): VerificationApprovePayload | null {
    const keys = Object.keys(input.decisionPayload)
    if (input.decision !== 'approve') {
      if (keys.length !== 0) throw workflowError('REVIEW_DECISION_SCHEMA_INVALID',422)
      return null
    }
    if (keys.length === 0) throw workflowError('REVIEW_DECISION_SCHEMA_INVALID',422)
    return input.decisionPayload as VerificationApprovePayload
  }

  private async applyVerificationApproval(
    client: PoolClient,
    request: VerificationRequestRow,
    payload: VerificationApprovePayload,
    now: Date,
  ): Promise<VerificationApprovalResult> {
    const snapshot = this.verificationPolicySnapshot(request.link_policy_snapshot_json)
    if (payload.policy_version !== snapshot.policy_version ||
      payload.expected_creator_aggregate_version !== snapshot.target_creator_aggregate_version ||
      payload.expected_owner_link_set_version !== snapshot.owner_link_set_version ||
      payload.expected_reused_link_version !== snapshot.reused_link_version) {
      throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
    }
    const project = await client.query<{ aggregate_version: string; review_status: string } & QueryResultRow>(
      'SELECT aggregate_version,review_status FROM catalog.projects WHERE project_id=$1 FOR UPDATE',
      [request.project_id],
    )
    if (!project.rows[0] || project.rows[0].review_status === 'deleted') {
      throw workflowError('PROJECT_NOT_FOUND',404)
    }
    const firstRelation = await client.query<{ present: boolean } & QueryResultRow>(
      `SELECT EXISTS (SELECT 1 FROM catalog.author_relations
       WHERE project_id=$1 AND status IN ('active','suspended')) AS present`,[request.project_id],
    )
    const firstProjectAuthorLink = !firstRelation.rows[0]?.present

    let creator: CreatorRow
    let link: CreatorAccountLinkRow
    let profile: LinkPermissionProfileRow
    let profileVersionId: string | null = null
    if (request.creator_resolution_mode === 'create_new_creator') {
      if (payload.approved_link_role !== undefined || payload.approved_permission_profile_ref !== undefined ||
        snapshot.target_creator_aggregate_version !== null || snapshot.owner_link_set_version !== null ||
        snapshot.reused_link_version !== null) throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
      profile = await this.profileFromSnapshot(client,snapshot,'owner','OWNER_V1')
      const input = this.newCreatorProfile(request.new_creator_profile_input_json)
      const creatorId = randomUUID()
      profileVersionId = randomUUID()
      await client.query(
        `INSERT INTO catalog.creators (
           creator_id,current_profile_version_id,aggregate_version,owner_link_set_version,
           canonical_creator_id,merge_status,created_at,updated_at
         ) VALUES ($1,NULL,1,1,NULL,'canonical',$2,$2)`,[creatorId,now],
      )
      await client.query(
        `INSERT INTO catalog.creator_profile_versions (
           creator_profile_version_id,creator_id,base_version_id,source_creator_profile_draft_id,
           source_verification_request_id,profile_snapshot_json,avatar_media_reference_id,
           published_by_admin_id,created_at
         ) VALUES ($1,$2,NULL,NULL,$3,$4::jsonb,NULL,NULL,$5)`,
        [profileVersionId,creatorId,request.verification_id,JSON.stringify({
          display_name:input.display_name,bio:input.bio ?? '',avatar_url:null,
          contacts:[],external_links:[],verification_status:'verified',
        }),now],
      )
      const createdCreator = await client.query<CreatorRow>(
        `UPDATE catalog.creators SET current_profile_version_id=$2,aggregate_version=2,
           updated_at=$3 WHERE creator_id=$1 RETURNING *`,[creatorId,profileVersionId,now],
      )
      creator = createdCreator.rows[0]!
      const linkId = randomUUID()
      const createdLink = await client.query<CreatorAccountLinkRow>(
        `INSERT INTO catalog.creator_account_links (
           creator_account_link_id,user_id,creator_id,link_role,permission_profile_id,
           permission_profile_version,permission_profile_config_hash,status,
           source_verification_id,version,created_at,updated_at
         ) VALUES ($1,$2,$3,'owner',$4,$5,$6,'active',$7,1,$8,$8) RETURNING *`,
        [linkId,request.applicant_user_id,creatorId,profile.profile_id,profile.profile_version,
          profile.config_hash,request.verification_id,now],
      )
      link = createdLink.rows[0]!
    } else if (request.creator_resolution_mode === 'use_existing_link') {
      if (payload.approved_link_role !== undefined || payload.approved_permission_profile_ref !== undefined ||
        !request.creator_account_link_id || snapshot.reused_link_id !== request.creator_account_link_id) {
        throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
      }
      const linkResult = await client.query<CreatorAccountLinkRow>(
        `SELECT * FROM catalog.creator_account_links
         WHERE creator_account_link_id=$1 AND user_id=$2 FOR UPDATE`,
        [request.creator_account_link_id,request.applicant_user_id],
      )
      link = linkResult.rows[0]!
      if (!link || link.status !== 'active') throw workflowError('REUSED_LINK_CHANGED',409)
      if (Number(link.version) !== snapshot.reused_link_version) throw workflowError('REUSED_LINK_CHANGED',409)
      const creatorResult = await client.query<CreatorRow>(
        'SELECT * FROM catalog.creators WHERE creator_id=$1 FOR UPDATE',[link.creator_id],
      )
      creator = creatorResult.rows[0]!
      this.assertCreatorSnapshot(creator,snapshot)
      profile = await this.loadProfile(client,{
        profile_id:link.permission_profile_id,profile_version:link.permission_profile_version,
        config_hash:link.permission_profile_config_hash,
      })
      const updatedCreator = await client.query<CreatorRow>(
        `UPDATE catalog.creators SET aggregate_version=aggregate_version+1,
           updated_at=$2 WHERE creator_id=$1 RETURNING *`,[creator.creator_id,now],
      )
      creator = updatedCreator.rows[0]!
    } else {
      if (!request.target_creator_id || !payload.approved_link_role ||
        !payload.approved_permission_profile_ref) throw workflowError('REVIEW_DECISION_SCHEMA_INVALID',422)
      if (!snapshot.allowed_link_roles.includes(payload.approved_link_role)) {
        throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
      }
      profile = await this.profileFromSnapshot(client,snapshot,payload.approved_link_role,
        payload.approved_permission_profile_ref.profile_id,payload.approved_permission_profile_ref)
      const creatorResult = await client.query<CreatorRow>(
        'SELECT * FROM catalog.creators WHERE creator_id=$1 FOR UPDATE',[request.target_creator_id],
      )
      creator = creatorResult.rows[0]!
      this.assertCreatorSnapshot(creator,snapshot)
      const owner = await client.query<CreatorAccountLinkRow>(
        `SELECT * FROM catalog.creator_account_links WHERE creator_id=$1 AND link_role='owner'
         AND status IN ('active','suspended') ORDER BY creator_account_link_id LIMIT 1 FOR UPDATE`,
        [creator.creator_id],
      )
      if ((owner.rows[0]?.creator_account_link_id ?? null) !== snapshot.observed_owner_link_id ||
        (owner.rows[0] ? Number(owner.rows[0].version) : null) !== snapshot.observed_owner_link_version) {
        throw workflowError('OWNER_LINK_SET_CHANGED',409)
      }
      if (payload.approved_link_role === 'owner' && owner.rows[0]) {
        throw workflowError('OWNER_LINK_SET_CHANGED',409)
      }
      const linkId = randomUUID()
      const createdLink = await client.query<CreatorAccountLinkRow>(
        `INSERT INTO catalog.creator_account_links (
           creator_account_link_id,user_id,creator_id,link_role,permission_profile_id,
           permission_profile_version,permission_profile_config_hash,status,
           source_verification_id,version,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,1,$9,$9) RETURNING *`,
        [linkId,request.applicant_user_id,creator.creator_id,payload.approved_link_role,
          profile.profile_id,profile.profile_version,profile.config_hash,request.verification_id,now],
      )
      link = createdLink.rows[0]!
      const updatedCreator = await client.query<CreatorRow>(
        `UPDATE catalog.creators SET aggregate_version=aggregate_version+1,
           owner_link_set_version=owner_link_set_version+$2,updated_at=$3
         WHERE creator_id=$1 RETURNING *`,
        [creator.creator_id,payload.approved_link_role === 'owner' ? 1 : 0,now],
      )
      creator = updatedCreator.rows[0]!
    }

    const ceiling = this.stringArray(profile.field_path_ceiling_json,'LINK_PERMISSION_PROFILE_INVALID')
    const capabilities = this.stringArray(profile.capabilities_json,'LINK_PERMISSION_PROFILE_INVALID')
    if (payload.field_permissions.some((field) => !ceiling.includes(field))) {
      throw workflowError('LINK_PERMISSION_PROFILE_INVALID',422)
    }
    const relationId = randomUUID()
    await client.query(
      `INSERT INTO catalog.author_relations (
         author_relation_id,project_id,creator_id,status,author_role,field_permissions_json,
         source_verification_id,approved_via_creator_account_link_id,version,created_at,updated_at
       ) VALUES ($1,$2,$3,'active',$4,$5::jsonb,$6,$7,1,$8,$8)`,
      [relationId,request.project_id,creator.creator_id,payload.author_role,
        JSON.stringify(payload.field_permissions),request.verification_id,
        link.creator_account_link_id,now],
    )
    const updatedProject = await client.query<{ aggregate_version: string } & QueryResultRow>(
      `UPDATE catalog.projects SET review_status='published_author',author_link_status='linked',
         aggregate_version=aggregate_version+1,updated_at=$2
       WHERE project_id=$1 AND review_status<>'deleted' RETURNING aggregate_version`,
      [request.project_id,now],
    )
    if (!updatedProject.rows[0]) throw workflowError('PROJECT_NOT_FOUND',404)
    return Object.freeze({
      creatorId:creator.creator_id,linkId:link.creator_account_link_id,relationId,
      profileVersionId,linkRole:link.link_role,profile,
      effectiveFields:Object.freeze([...payload.field_permissions]),
      capabilities:Object.freeze([...capabilities]),
      creatorAggregateVersion:Number(creator.aggregate_version),
      ownerLinkSetVersion:Number(creator.owner_link_set_version),
      projectAggregateVersion:Number(updatedProject.rows[0].aggregate_version),
      firstProjectAuthorLink,
    })
  }

  private assertCreatorSnapshot(creator: CreatorRow | undefined,snapshot: VerificationPolicySnapshot): void {
    if (!creator || creator.canonical_creator_id !== null || creator.merge_status !== 'canonical') {
      throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
    }
    if (Number(creator.aggregate_version) !== snapshot.target_creator_aggregate_version) {
      throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
    }
    if (Number(creator.owner_link_set_version) !== snapshot.owner_link_set_version) {
      throw workflowError('OWNER_LINK_SET_CHANGED',409)
    }
  }

  private async profileFromSnapshot(
    client: PoolClient,
    snapshot: VerificationPolicySnapshot,
    role: 'owner' | 'manager',
    profileId: 'OWNER_V1' | 'MANAGER_V1',
    requested?: Readonly<{profile_id:'OWNER_V1'|'MANAGER_V1';profile_version:1;config_hash:string}>,
  ): Promise<LinkPermissionProfileRow> {
    const expected = snapshot.allowed_permission_profile_refs.find((ref) => ref.profile_id===profileId)
    if (!expected || (role==='owner' ? profileId!=='OWNER_V1' : profileId!=='MANAGER_V1') ||
      (requested && (requested.profile_version!==expected.profile_version ||
        requested.config_hash!==expected.config_hash))) {
      throw workflowError('LINK_PERMISSION_PROFILE_INVALID',422)
    }
    return this.loadProfile(client,expected)
  }

  private async loadProfile(
    client: PoolClient,
    ref: Readonly<{profile_id:'OWNER_V1'|'MANAGER_V1';profile_version:number;config_hash:string}>,
  ): Promise<LinkPermissionProfileRow> {
    const result = await client.query<LinkPermissionProfileRow>(
      `SELECT * FROM catalog.link_permission_profiles
       WHERE profile_id=$1 AND profile_version=$2 AND config_hash=$3`,
      [ref.profile_id,ref.profile_version,ref.config_hash],
    )
    if (!result.rows[0]) throw workflowError('LINK_PERMISSION_PROFILE_INVALID',409)
    return result.rows[0]
  }

  private newCreatorProfile(value: unknown): Readonly<{display_name:string;bio?:string}> {
    if (!value || typeof value!=='object' || Array.isArray(value)) {
      throw workflowError('REVIEW_TARGET_STATE_INVALID',500,true)
    }
    const record = value as Record<string,unknown>
    if (typeof record.display_name!=='string' || record.display_name.trim().length<1 ||
      record.display_name.trim().length>80 ||
      (record.bio!==undefined && (typeof record.bio!=='string' || record.bio.length>1000))) {
      throw workflowError('REVIEW_TARGET_STATE_INVALID',500,true)
    }
    return Object.freeze({display_name:record.display_name.trim(),
      ...(record.bio===undefined?{}:{bio:record.bio})})
  }

  private verificationPolicySnapshot(value: unknown): VerificationPolicySnapshot {
    if (!value || typeof value!=='object' || Array.isArray(value)) {
      throw workflowError('REVIEW_TARGET_STATE_INVALID',500,true)
    }
    return value as VerificationPolicySnapshot
  }

  private stringArray(value: unknown,code: string): readonly string[] {
    if (!Array.isArray(value) || value.some((item)=>typeof item!=='string')) throw workflowError(code,500,true)
    return value as readonly string[]
  }

  private async writeVerificationOutbox(
    client: PoolClient,
    transactionId: string,
    aggregateId: string,
    eventVersion: number,
    eventName: string,
    payload: Readonly<Record<string,unknown>>,
    now: Date,
    aggregateType='verification_request',
  ): Promise<void> {
    await client.query(
      `INSERT INTO ops.outbox_events (
         outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,
         payload_json,transaction_id,status,next_attempt_at,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9,$9)`,
      [randomUUID(),randomUUID(),aggregateType,aggregateId,eventName,eventVersion,
        JSON.stringify(payload),transactionId,now],
    )
  }

  private async activeSession(
    client: PoolClient,
    input: StoredReviewDecisionInput,
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
    input: StoredReviewDecisionInput,
    workItem: WorkItemRow,
    target: SubmissionRow | ProjectUpdateRow | VerificationRequestRow | OwnershipCaseRow,
    targetVersion: number,
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
    const isSubmission = workItem.work_type === 'submission'
    const isVerification = workItem.work_type === 'verification'
    const isOwnership = workItem.work_type === 'ownership_case'
    const expectedOperationType = isSubmission
      ? 'submission_review'
      : isVerification ? 'verification_review' : isOwnership ? 'ownership_review' : 'project_update_review'
    if (preview.operation_type !== expectedOperationType) {
      throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
    }
    if (!preview.claim_token_hash || !preview.claim_token_hash.equals(input.claimTokenHash)) {
      throw workflowError('PREVIEW_BINDING_MISMATCH', 403)
    }
    const targetId = isSubmission
      ? (target as SubmissionRow).submission_id
      : isVerification
        ? (target as VerificationRequestRow).verification_id
        : isOwnership ? (target as OwnershipCaseRow).case_id : (target as ProjectUpdateRow).update_id
    const targetType = isVerification ? 'verification_request' : workItem.work_type
    const targets = [{ target_type: targetType, target_id: targetId }]
    const expectedVersions = isSubmission
      ? { submission: targetVersion, work_item: workItem.version }
      : isVerification
        ? { verification_request: targetVersion, work_item: workItem.version }
        : isOwnership ? { ownership_case: targetVersion, work_item: workItem.version }
          : { project_update: targetVersion, work_item: workItem.version }
    const diff = isSubmission
      ? { review_status: input.resultingStatus }
      : isVerification
        ? { status: input.decision==='approve' ? 'verified' : input.decision==='reject' ? 'failed' : 'changes_requested' }
        : { status: input.resultingStatus }
    const ownershipPayload=isOwnership?input.decisionPayload as OwnershipDecisionPayload:null
    if (
      this.canonicalJson(preview.targets_json) !== this.canonicalJson(targets) ||
      this.canonicalJson(preview.expected_versions_json) !== this.canonicalJson(expectedVersions) ||
      this.canonicalJson(preview.proposed_diff_json) !== this.canonicalJson(diff) ||
      preview.reason_code !== input.reasonCode ||
      (isOwnership && preview.expected_conflict_principal_version!==ownershipPayload?.expected_conflict_principal_version)
    ) throw workflowError('PREVIEW_BINDING_STALE', 409)
  }

  private assertConfirm(
    confirm: ConfirmRow,
    preview: PreviewRow,
    input: StoredReviewDecisionInput,
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
      readonly input: StoredReviewDecisionInput
      readonly workItem: WorkItemRow
      readonly decidedWorkItem: WorkItemRow
      readonly target: SubmissionRow | ProjectUpdateRow
      readonly targetVersion: number
      readonly workType: 'submission' | 'project_update'
      readonly reviewDecisionId: string
      readonly transactionId: string
      readonly preview: PreviewRow
      readonly confirm: ConfirmRow
    },
  ): Promise<void> {
    const {
      input, workItem, decidedWorkItem, target, targetVersion, workType, reviewDecisionId,
      transactionId, preview, confirm,
    } = context
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
    const targetId = workType === 'submission'
      ? (target as SubmissionRow).submission_id
      : (target as ProjectUpdateRow).update_id
    const statusField = workType === 'submission' ? 'review_status' : 'status'
    const beforeStatus = workType === 'submission'
      ? (target as SubmissionRow).review_status
      : target.status
    const eventName = `${workType}_${input.decision === 'reject' ? 'rejected' : input.resultingStatus}`
    await client.query(
      `INSERT INTO ops.outbox_events (
         outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,
         payload_json,transaction_id,status,next_attempt_at,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9,$9)`,
      [randomUUID(), randomUUID(), workType, targetId, eventName, targetVersion + 1,
        JSON.stringify({
          review_decision_id: reviewDecisionId,
          [`${workType}_id`]: targetId,
          resulting_status: input.resultingStatus,
        }), transactionId, input.now],
    )
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at
       ) VALUES ($1,'OP-ADMIN-DECISION',$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,
         $10,$11,$12,'succeeded',$13)`,
      [randomUUID(), input.actor.roles.includes('admin') ? 'admin' : 'platform_editor',
        createHash('sha256').update(input.actor.userId).digest(), JSON.stringify(input.actor.roles),
        workType, targetId,
        this.hash(this.canonicalJson({ [statusField]: beforeStatus, version: targetVersion })),
        this.hash(this.canonicalJson({
          [statusField]: input.resultingStatus, version: targetVersion + 1,
        })),
        JSON.stringify({
          [statusField]: input.resultingStatus, review_decision_id: reviewDecisionId,
        }),
        input.reasonCode, input.requestId, transactionId, input.now],
    )
  }

  private projection(row: DecisionRow): ReviewDecisionProjection {
    return Object.freeze({
      review_decision_id: row.review_decision_id,
      work_item_id: row.work_item_id,
      work_type: row.work_type,
      target_type: row.target_type,
      target_id: row.target_id,
      decision: row.decision,
      project_id: row.project_id,
      base_version_id: row.base_version_id,
      resulting_status: row.resulting_status,
      work_item_status: 'decided',
      work_item_decision_ref_type: 'review_decision',
      transaction_id: row.transaction_id,
      committed_at: row.committed_at.toISOString(),
      schema_version: 'review_decision.v1',
      domain_status: row.resulting_status,
      outbox_status: 'pending',
      resulting_creator_id: null,
      resulting_link_id: null,
      resulting_author_relation_id: null,
      resulting_profile_version_id: null,
      approved_link_role: null,
      approved_permission_profile_ref: null,
      effective_capabilities: Object.freeze([]),
      effective_field_permissions: Object.freeze([]),
      creator_aggregate_version: null,
      owner_link_set_version: null,
    })
  }

  private verificationProjectionFromDecision(row: DecisionRow): ReviewDecisionProjection {
    return Object.freeze({
      review_decision_id:row.review_decision_id,work_item_id:row.work_item_id,
      work_type:'verification',target_type:'verification_request',target_id:row.target_id,
      decision:row.decision,project_id:row.project_id,base_version_id:null,
      resulting_status:row.resulting_status as 'changes_requested'|'failed',
      work_item_status:'decided',work_item_decision_ref_type:'review_decision',
      transaction_id:row.transaction_id,committed_at:row.committed_at.toISOString(),
      schema_version:'review_decision.v1',domain_status:row.resulting_status as 'changes_requested'|'failed',
      outbox_status:'pending',resulting_creator_id:null,resulting_link_id:null,
      resulting_author_relation_id:null,resulting_profile_version_id:null,approved_link_role:null,
      approved_permission_profile_ref:null,effective_capabilities:Object.freeze([]),
      effective_field_permissions:Object.freeze([]),creator_aggregate_version:null,
      owner_link_set_version:null,
    })
  }

  private verificationApprovalProjection(
    row: DecisionRow,
    approval: VerificationApprovalResult,
  ): ReviewDecisionProjection {
    return Object.freeze({
      review_decision_id:row.review_decision_id,work_item_id:row.work_item_id,
      work_type:'verification',target_type:'verification_request',target_id:row.target_id,
      decision:row.decision,project_id:row.project_id,base_version_id:null,
      resulting_status:'verified',work_item_status:'decided',
      work_item_decision_ref_type:'review_decision',transaction_id:row.transaction_id,
      committed_at:row.committed_at.toISOString(),schema_version:'review_decision.v1',
      domain_status:'verified',outbox_status:'pending',resulting_creator_id:approval.creatorId,
      resulting_link_id:approval.linkId,resulting_author_relation_id:approval.relationId,
      resulting_profile_version_id:approval.profileVersionId,approved_link_role:approval.linkRole,
      approved_permission_profile_ref:Object.freeze({
        profile_id:approval.profile.profile_id,profile_version:1,
        config_hash:approval.profile.config_hash,
      }),effective_capabilities:approval.capabilities,
      effective_field_permissions:approval.effectiveFields,
      creator_aggregate_version:approval.creatorAggregateVersion,
      owner_link_set_version:approval.ownerLinkSetVersion,
    })
  }

  private async verificationProjection(
    client: PoolClient,
    row: DecisionRow,
  ): Promise<ReviewDecisionProjection> {
    const result = await client.query<VerificationProjectionRow>(
      `SELECT request.resulting_creator_id,request.resulting_link_id,
         request.resulting_author_relation_id,request.resulting_profile_version_id,
         request.approved_link_role,request.approved_permission_profile_id,
         request.approved_permission_profile_version,request.approved_profile_config_hash,
         profile.capabilities_json,profile.field_path_ceiling_json,relation.field_permissions_json,
         creator.aggregate_version AS creator_aggregate_version,
         creator.owner_link_set_version
       FROM workflow.verification_requests request
       LEFT JOIN catalog.creators creator ON creator.creator_id=request.resulting_creator_id
       LEFT JOIN catalog.author_relations relation
         ON relation.author_relation_id=request.resulting_author_relation_id
       LEFT JOIN catalog.link_permission_profiles profile
         ON profile.profile_id=request.approved_permission_profile_id
        AND profile.profile_version=request.approved_permission_profile_version
        AND profile.config_hash=request.approved_profile_config_hash
       WHERE request.verification_id=$1`,[row.target_id],
    )
    const value = result.rows[0]
    if (!value?.resulting_creator_id) {
      if (row.resulting_status === 'verified') {
        throw workflowError('REVIEW_TARGET_STATE_INVALID', 500, true)
      }
      return this.verificationProjectionFromDecision(row)
    }
    const ceiling = this.stringArray(value.field_path_ceiling_json,'REVIEW_TARGET_STATE_INVALID')
    const requested = this.stringArray(value.field_permissions_json,'REVIEW_TARGET_STATE_INVALID')
    const fields = Object.freeze(requested.filter((field)=>ceiling.includes(field)))
    const capabilities = Object.freeze([...this.stringArray(value.capabilities_json,'REVIEW_TARGET_STATE_INVALID')])
    return Object.freeze({
      ...this.verificationProjectionFromDecision(row),resulting_status:'verified',domain_status:'verified',
      resulting_creator_id:value.resulting_creator_id,resulting_link_id:value.resulting_link_id,
      resulting_author_relation_id:value.resulting_author_relation_id,
      resulting_profile_version_id:value.resulting_profile_version_id,
      approved_link_role:value.approved_link_role,
      approved_permission_profile_ref:value.approved_permission_profile_id ? Object.freeze({
        profile_id:value.approved_permission_profile_id,profile_version:1 as const,
        config_hash:value.approved_profile_config_hash!,
      }) : null,effective_capabilities:capabilities,effective_field_permissions:fields,
      creator_aggregate_version:value.creator_aggregate_version===null?null:Number(value.creator_aggregate_version),
      owner_link_set_version:value.owner_link_set_version===null?null:Number(value.owner_link_set_version),
    })
  }

  private uuidArray(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw workflowError('REVIEW_TARGET_STATE_INVALID', 500, true)
    }
    return value as readonly string[]
  }

  private targetVersion(target: SubmissionRow | ProjectUpdateRow | VerificationRequestRow): number {
    const version = Number(target.version)
    if (!Number.isSafeInteger(version) || version < 1) {
      throw workflowError('REVIEW_TARGET_STATE_INVALID', 500, true)
    }
    return version
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

  private mapDatabaseConflict(error: unknown): unknown {
    if (!error || typeof error!=='object') return error
    const pg=error as {code?:string;constraint?:string;message?:string}
    if (pg.code!=='23505' && pg.code!=='23503' && pg.code!=='23514') return error
    if (pg.constraint==='creator_account_links_owner_nonterminal_uniq') {
      return workflowError('OWNER_LINK_SET_CHANGED',409)
    }
    if (pg.constraint==='creator_account_links_user_creator_nonterminal_uniq') {
      return workflowError('REUSED_LINK_CHANGED',409)
    }
    if (pg.constraint==='author_relations_creator_project_nonterminal_uniq' ||
      pg.constraint==='author_relations_creator_project_role_nonterminal_uniq') {
      return workflowError('AUTHOR_RELATION_EXISTS',409)
    }
    if (pg.constraint?.includes('permission_profile') || pg.message?.includes('PROFILE_MISMATCH')) {
      return workflowError('LINK_PERMISSION_PROFILE_INVALID',409)
    }
    return error
  }
}
