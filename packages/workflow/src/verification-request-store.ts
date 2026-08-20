import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { workflowError } from './errors.js'
import type {
  CreatorResolutionMode,
  LinkPolicySnapshot,
  NewCreatorProfileInput,
  ProvisionalLinkPolicy,
  RequestedLinkRole,
  VerificationApplicantMaterialSummary,
  VerificationPublicReviewMessage,
  VerificationRequestProjection,
  VerificationRequestReviewerProjection,
} from './verification-request-types.js'

interface VerificationRequestRow extends QueryResultRow {
  readonly verification_id: string
  readonly project_id: string
  readonly applicant_user_id: string
  readonly creator_resolution_mode: CreatorResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input_json: unknown
  readonly requested_link_role: RequestedLinkRole | null
  readonly link_policy_snapshot_json: unknown
  readonly method: string | null
  readonly public_summary: string | null
  readonly material_ids_json: unknown
  readonly status: VerificationRequestProjection['status']
  readonly status_history_json: unknown
  readonly review_work_item_id: string | null
  readonly decision: 'approve' | 'reject' | 'withdraw' | null
  readonly resulting_creator_id: string | null
  readonly resulting_link_id: string | null
  readonly resulting_author_relation_id: string | null
  readonly resulting_profile_version_id: string | null
  readonly approved_link_role: RequestedLinkRole | null
  readonly approved_permission_profile_id: 'OWNER_V1' | 'MANAGER_V1' | null
  readonly approved_permission_profile_version: number | null
  readonly approved_profile_config_hash: string | null
  readonly supersedes_verification_id: string | null
  readonly version: string
  readonly created_at: Date
  readonly updated_at: Date
  readonly request_hash: string
}

export interface ResolutionSelection {
  readonly mode: CreatorResolutionMode
  readonly creatorAccountLinkId: string | null
  readonly targetCreatorId: string | null
  readonly newCreatorProfileInput: NewCreatorProfileInput | null
  readonly requestedLinkRole: RequestedLinkRole | null
  readonly provisionalPolicy: ProvisionalLinkPolicy
  readonly observedOwnerLinkId: string | null
  readonly observedOwnerLinkVersion: number | null
  readonly reusedLinkVersion: number | null
}

export class PostgresVerificationRequestStore {
  constructor(private readonly pool: Pool) {}

  async findCreateReplay(userId: string, idempotencyKey: string) {
    const result = await this.pool.query<VerificationRequestRow>(
      `SELECT * FROM workflow.verification_requests
       WHERE applicant_user_id=$1 AND idempotency_key=$2`,
      [userId, idempotencyKey],
    )
    return result.rows[0] ?? null
  }

  async getOwned(userId: string, verificationId: string) {
    const result = await this.pool.query<VerificationRequestRow>(
      `SELECT * FROM workflow.verification_requests
       WHERE verification_id=$1 AND applicant_user_id=$2`,
      [verificationId, userId],
    )
    return result.rows[0] ?? null
  }

  async getForReviewer(input: Readonly<{
    reviewerUserId:string;primarySessionIdHash:Buffer;verificationId:string;
    claimTokenHash:Buffer;now:Date
  }>):Promise<VerificationRequestReviewerProjection>{
    const result=await this.pool.query<VerificationRequestRow & {
      revision_number:number;evidence_refs_json:unknown;submission_material_ids_json:unknown
    }>(
      `SELECT request.*,submission.revision_number,submission.evidence_refs_json,
         submission.material_ids_json AS submission_material_ids_json
       FROM workflow.verification_requests request
       JOIN workflow.review_work_items item ON item.work_item_id=request.review_work_item_id
        AND item.work_type='verification' AND item.target_type='verification_request'
        AND item.target_id=request.verification_id AND item.status='claimed'
        AND item.assignee_user_id=$2 AND item.claim_token_hash=$4 AND item.lease_expires_at>$5
       JOIN iam.sessions session ON session.session_id_hash=$3 AND session.user_id=$2
        AND session.status='active' AND session.expires_at>$5
       JOIN iam.users reviewer ON reviewer.user_id=$2 AND reviewer.status='active'
        AND reviewer.role_version=session.roles_version
       JOIN workflow.verification_request_submissions submission
        ON submission.review_work_item_id=item.work_item_id
       WHERE request.verification_id=$1 AND request.status='pending'`,
      [input.verificationId,input.reviewerUserId,input.primarySessionIdHash,input.claimTokenHash,input.now],
    )
    const row=result.rows[0]
    if(!row)throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN',403)
    const snapshot=nullablePolicySnapshot(row.link_policy_snapshot_json)
    if(!snapshot||!row.method||!row.public_summary)throw workflowError('REVIEW_TARGET_STATE_INVALID',500,true)
    return Object.freeze({viewer_schema:'reviewer',verification_id:row.verification_id,
      project_id:row.project_id,creator_resolution_mode:row.creator_resolution_mode,
      creator_account_link_id:row.creator_account_link_id,target_creator_id:row.target_creator_id,
      new_creator_profile_input:nullableProfile(row.new_creator_profile_input_json),
      requested_link_role:row.requested_link_role,link_policy_snapshot:snapshot,method:row.method,
      public_summary:row.public_summary,material_ids:Object.freeze([...stringArray(row.submission_material_ids_json)]),
      evidence_refs:Object.freeze([...stringArray(row.evidence_refs_json)]),
      submission_revision:row.revision_number,status:'pending',review_work_item_id:row.review_work_item_id!,
      version:positiveInteger(row.version)})
  }

  async create(input: Readonly<{
    userId: string
    projectId: string
    supersedesVerificationId: string | null
    selection: ResolutionSelection
    idempotencyKey: string
    requestHash: string
    now: Date
    requestId: string
  }>): Promise<VerificationRequestRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${input.userId}:${input.projectId}`,
      ])
      const replay = await client.query<VerificationRequestRow>(
        `SELECT * FROM workflow.verification_requests
         WHERE applicant_user_id=$1 AND idempotency_key=$2`,
        [input.userId, input.idempotencyKey],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw workflowError('VERIFICATION_IDEMPOTENCY_KEY_REUSED', 409)
        }
        await client.query('COMMIT')
        return replay.rows[0]
      }
      const project = await client.query<{ review_status: string }>(
        `SELECT review_status FROM catalog.projects WHERE project_id=$1`, [input.projectId],
      )
      if (!project.rows[0] || project.rows[0].review_status === 'deleted') {
        throw workflowError('PROJECT_NOT_FOUND', 404)
      }
      const latest = await client.query<VerificationRequestRow>(
        `SELECT * FROM workflow.verification_requests
         WHERE applicant_user_id=$1 AND project_id=$2
         ORDER BY created_at DESC,verification_id DESC LIMIT 1 FOR UPDATE`,
        [input.userId, input.projectId],
      )
      if (input.supersedesVerificationId !== null) {
        const supplied = await client.query<{ applicant_user_id: string; project_id: string }>(
          `SELECT applicant_user_id,project_id FROM workflow.verification_requests
           WHERE verification_id=$1`,
          [input.supersedesVerificationId],
        )
        if (!supplied.rows[0]) throw workflowError('VERIFICATION_SUPERSEDES_INVALID', 409)
        if (supplied.rows[0].applicant_user_id !== input.userId) {
          throw workflowError('VERIFICATION_SUPERSEDES_FORBIDDEN', 403)
        }
        if (supplied.rows[0].project_id !== input.projectId) {
          throw workflowError('VERIFICATION_SUPERSEDES_PROJECT_MISMATCH', 409)
        }
      }
      validateSupersedes(latest.rows[0] ?? null, input.supersedesVerificationId)
      const row = await insertRequest(client, input)
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           after_hash,reason_code,request_id,result,created_at
         ) VALUES (
           'verification_draft_create','registered_user',digest($1::text,'sha256'),'[]'::jsonb,
           'verification_request',$2,$3,'applicant_created',left($4,64),'success',$5
         )`,
        [input.userId, row.verification_id, input.requestHash, input.requestId, input.now],
      )
      await client.query('COMMIT')
      return row
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async patch(input: Readonly<{
    userId: string
    verificationId: string
    expectedVersion: number
    selection: ResolutionSelection
    method: string | null
    publicSummary: string | null
    operationId: string
    requestHash: string
    now: Date
    requestId: string
  }>): Promise<VerificationRequestRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash,response_json FROM workflow.verification_request_operations
         WHERE verification_id=$1 AND applicant_user_id=$2 AND operation_id=$3`,
        [input.verificationId, input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw workflowError('VERIFICATION_OPERATION_REUSED', 409)
        }
        await client.query('COMMIT')
        return hydrate(receipt.rows[0].response_json as VerificationRequestRow)
      }
      const updated = await client.query<VerificationRequestRow>(
        `UPDATE workflow.verification_requests SET
           creator_resolution_mode=$4,creator_account_link_id=$5,target_creator_id=$6,
           new_creator_profile_input_json=$7::jsonb,requested_link_role=$8,
           method=$9,public_summary=$10,version=version+1,
           updated_at=GREATEST($11,updated_at+interval '1 microsecond')
         WHERE verification_id=$1 AND applicant_user_id=$2 AND version=$3
           AND status IN ('draft','changes_requested')
         RETURNING *`,
        [input.verificationId, input.userId, input.expectedVersion, input.selection.mode,
          input.selection.creatorAccountLinkId, input.selection.targetCreatorId,
          input.selection.newCreatorProfileInput === null
            ? null
            : JSON.stringify(input.selection.newCreatorProfileInput),
          input.selection.requestedLinkRole, input.method, input.publicSummary, input.now],
      )
      let row = updated.rows[0]
      if (!row) {
        const concurrentReceipt = await client.query<{ request_hash: string; response_json: unknown }>(
          `SELECT request_hash,response_json FROM workflow.verification_request_operations
           WHERE verification_id=$1 AND applicant_user_id=$2 AND operation_id=$3`,
          [input.verificationId, input.userId, input.operationId],
        )
        if (concurrentReceipt.rows[0]) {
          if (concurrentReceipt.rows[0].request_hash !== input.requestHash) {
            throw workflowError('VERIFICATION_OPERATION_REUSED', 409)
          }
          row = hydrate(concurrentReceipt.rows[0].response_json as VerificationRequestRow)
          await client.query('COMMIT')
          return row
        }
        await this.explainPatchFailure(client, input)
      }
      await client.query(
        `INSERT INTO workflow.verification_request_operations (
           verification_id,applicant_user_id,operation_id,operation_type,request_hash,
           resulting_version,response_json,created_at
         ) VALUES ($1,$2,$3,'patch',$4,$5,$6::jsonb,$7)`,
        [input.verificationId, input.userId, input.operationId, input.requestHash,
          row!.version, JSON.stringify(row), input.now],
      )
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           before_hash,after_hash,diff_json,reason_code,request_id,result,created_at
         ) VALUES (
           'verification_draft_patch','registered_user',digest($1::text,'sha256'),'[]'::jsonb,
           'verification_request',$2,encode(digest($3::text,'sha256'),'hex'),$4,$5::jsonb,
           'applicant_saved',left($6,64),'success',$7
         )`,
        [input.userId, input.verificationId, String(input.expectedVersion), input.requestHash,
          JSON.stringify({ changed_fields: ['creator_resolution','method','public_summary'] }),
          input.requestId, input.now],
      )
      await client.query('COMMIT')
      return row!
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async submit(input: Readonly<{
    userId: string
    verificationId: string
    expectedVersion: number
    materialIds: readonly string[]
    evidenceRefs: readonly string[]
    operationId: string
    operationType: 'submit' | 'supplement'
    requestHash: string
    selection: ResolutionSelection
    now: Date
    requestId: string
  }>): Promise<VerificationRequestRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.operationReplay(client, input)
      if (replay) {
        await client.query('COMMIT')
        return replay
      }
      const locked = await client.query<VerificationRequestRow>(
        `SELECT * FROM workflow.verification_requests
         WHERE verification_id=$1 AND applicant_user_id=$2 FOR UPDATE`,
        [input.verificationId,input.userId],
      )
      const row = locked.rows[0]
      if (!row) throw workflowError('VERIFICATION_REQUEST_NOT_FOUND',404)
      const requiredStatus = input.operationType==='submit' ? 'draft' : 'changes_requested'
      if (row.status!==requiredStatus) {
        throw workflowError(input.operationType==='submit'
          ? 'VERIFICATION_REQUEST_NOT_SUBMITTABLE' : 'VERIFICATION_REQUEST_NOT_SUPPLEMENTABLE',409)
      }
      if (positiveInteger(row.version)!==input.expectedVersion) {
        throw workflowError('VERIFICATION_VERSION_CONFLICT',409,false,{
          expected_version: input.expectedVersion,current_version: positiveInteger(row.version),
        })
      }
      if (!row.method) throw workflowError('VERIFICATION_METHOD_REQUIRED',422)
      if (!row.public_summary || row.public_summary.length<10) {
        throw workflowError('VERIFICATION_SUMMARY_REQUIRED',422)
      }
      await this.assertMaterialSnapshot(client,row,input.materialIds)
      await this.assertEvidenceRefs(client,row.project_id,input.evidenceRefs)
      await this.assertSelectionStillCurrent(client,row,input.selection)
      const snapshot = linkPolicySnapshot(input.selection)
      const workItemId = randomUUID()
      await client.query(
        `INSERT INTO workflow.review_work_items (
           work_item_id,work_type,target_type,target_id,status,version,created_at,updated_at
         ) VALUES ($1,'verification','verification_request',$2,'queued',1,$3,$3)`,
        [workItemId,row.verification_id,input.now],
      )
      await client.query(
        `INSERT INTO workflow.review_work_item_conflict_principals (
           work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
         ) VALUES ($1,$2,'verification_applicant',$3,1,$4)`,
        [workItemId,row.applicant_user_id,row.verification_id,input.now],
      )
      const revision = await client.query<{ revision_number: number }>(
        `SELECT COALESCE(max(revision_number),0)::int+1 AS revision_number
         FROM workflow.verification_request_submissions WHERE verification_id=$1`,
        [row.verification_id],
      )
      await client.query(
        `INSERT INTO workflow.verification_request_submissions (
           verification_id,revision_number,submission_kind,material_ids_json,evidence_refs_json,
           link_policy_snapshot_json,review_work_item_id,operation_id,request_hash,created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10)`,
        [row.verification_id,revision.rows[0]!.revision_number,
          input.operationType==='submit' ? 'initial' : 'supplement',
          JSON.stringify(input.materialIds),JSON.stringify(input.evidenceRefs),
          JSON.stringify(snapshot),workItemId,input.operationId,input.requestHash,input.now],
      )
      const updated = await client.query<VerificationRequestRow>(
        `UPDATE workflow.verification_requests SET status='pending',material_ids_json=$3::jsonb,
           link_policy_snapshot_json=$4::jsonb,review_work_item_id=$5,
           status_history_json=status_history_json||jsonb_build_array(
             jsonb_build_object('status','pending','at',$6::timestamptz)
           ),submitted_at=COALESCE(submitted_at,$6),version=version+1,
           updated_at=GREATEST($6,updated_at+interval '1 microsecond')
         WHERE verification_id=$1 AND applicant_user_id=$2 AND version=$7 RETURNING *`,
        [row.verification_id,row.applicant_user_id,JSON.stringify(input.materialIds),
          JSON.stringify(snapshot),workItemId,input.now,input.expectedVersion],
      )
      const result = updated.rows[0]
      if (!result) throw workflowError('VERIFICATION_VERSION_CONFLICT',409)
      await this.recordOperation(client,input,result)
      await this.writeOutbox(client,{
        aggregateId: row.verification_id,
        eventName: input.operationType==='submit' ? 'author_verification_started' : 'verification_resubmitted',
        eventVersion: positiveInteger(result.version),
        payload: {
          verification_id: row.verification_id,project_id: row.project_id,
          material_count: input.materialIds.length,result: 'success',
        }, now: input.now,
      })
      await this.writeApplicantAudit(client,input,row.verification_id,
        input.operationType==='submit' ? 'verification_submit' : 'verification_supplement')
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async withdraw(input: Readonly<{
    userId: string
    verificationId: string
    expectedVersion: number
    operationId: string
    requestHash: string
    reasonCode: string
    now: Date
    requestId: string
  }>): Promise<VerificationRequestRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.operationReplay(client,input)
      if (replay) {
        await client.query('COMMIT')
        return replay
      }
      const locked = await client.query<VerificationRequestRow>(
        `SELECT * FROM workflow.verification_requests
         WHERE verification_id=$1 AND applicant_user_id=$2 FOR UPDATE`,
        [input.verificationId,input.userId],
      )
      const row = locked.rows[0]
      if (!row) throw workflowError('VERIFICATION_REQUEST_NOT_FOUND',404)
      if (!['draft','pending','changes_requested'].includes(row.status)) {
        throw workflowError('VERIFICATION_REQUEST_NOT_WITHDRAWABLE',409)
      }
      if (positiveInteger(row.version)!==input.expectedVersion) {
        throw workflowError('VERIFICATION_VERSION_CONFLICT',409,false,{
          expected_version: input.expectedVersion,current_version: positiveInteger(row.version),
        })
      }
      if (row.status==='pending' && row.review_work_item_id) {
        const cancelled = await client.query<{ version: number; from_status: string }>(
          `WITH current_item AS (
             SELECT work_item_id,status AS from_status FROM workflow.review_work_items
             WHERE work_item_id=$1 AND status IN ('queued','claimed') FOR UPDATE
           )
           UPDATE workflow.review_work_items item SET status='cancelled',assignee_user_id=NULL,
             claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,
             conflict_principal_version_at_claim=NULL,cancel_reason='applicant_withdrawn',
             version=version+1,updated_at=$2
           FROM current_item
           WHERE item.work_item_id=current_item.work_item_id
           RETURNING item.version,current_item.from_status`,
          [row.review_work_item_id,input.now],
        )
        if (cancelled.rows[0]) {
          await client.query(
            `INSERT INTO workflow.review_work_item_events (
               event_id,work_item_id,event_type,actor_user_id,from_status,to_status,
               work_item_version,reason_code,metadata_json,occurred_at
             ) VALUES ($1,$2,'cancelled',$3,$4,'cancelled',$5,'applicant_withdrawn','{}'::jsonb,$6)`,
            [randomUUID(),row.review_work_item_id,row.applicant_user_id,
              cancelled.rows[0].from_status,cancelled.rows[0].version,input.now],
          )
        }
      }
      await client.query(
        `UPDATE private_material.material_read_grants grant SET invalidated_at=$2
         FROM private_material.verification_materials material
         WHERE grant.material_id=material.material_id AND material.verification_id=$1
           AND grant.consumed_at IS NULL AND grant.invalidated_at IS NULL`,
        [row.verification_id,input.now],
      )
      const materialIds = await client.query<{ material_id: string; version: string }>(
        `UPDATE private_material.verification_materials SET
           status='revoked',pre_terminal_scan_result=scan_result,
           applicant_terminal_state_json=jsonb_build_object(
             'material_id',material_id,'verification_id',verification_id,
             'applicant_scan_state',CASE
               WHEN status IN ('prepared','uploaded','scanning') THEN 'pending'
               WHEN status='ready' THEN 'accepted' ELSE 'rejected' END,
             'reason_key',CASE
               WHEN status='abandoned' THEN 'upload_expired'
               WHEN rejection_reason_code IN ('SCAN_RETRY_EXHAUSTED','SCAN_DEADLINE_EXCEEDED')
                 THEN 'processing_unavailable'
               WHEN status='rejected' THEN 'file_rejected' ELSE NULL END,
             'next_action',CASE
               WHEN status='prepared' THEN 'complete_upload'
               WHEN status IN ('uploaded','scanning') THEN 'wait'
               WHEN status='ready' THEN 'continue_submission'
               ELSE 'upload_new_material' END,
             'upload_expires_at',CASE WHEN status='prepared' THEN upload_expires_at ELSE NULL END,
             'version',version
           ),revoked_at=$2,version=version+1,
           updated_at=GREATEST($2,updated_at+interval '1 microsecond')
         WHERE verification_id=$1 AND status NOT IN ('revoked','deleted')
         RETURNING material_id,version`,
        [row.verification_id,input.now],
      )
      for (const material of materialIds.rows) {
        await this.writeOutbox(client,{
          aggregateId: material.material_id,eventName: 'verification_material_access_revoke_requested',
          eventVersion: positiveInteger(material.version),payload: {
            material_id: material.material_id,reason: 'verification_withdrawn',
          },
          now: input.now,aggregateType: 'verification_material',
        })
      }
      const updated = await client.query<VerificationRequestRow>(
        `UPDATE workflow.verification_requests SET status='withdrawn',decision='withdraw',
           status_history_json=status_history_json||jsonb_build_array(
             jsonb_build_object('status','withdrawn','at',$3::timestamptz)
           ),decided_at=$3,version=version+1,
           updated_at=GREATEST($3,updated_at+interval '1 microsecond')
         WHERE verification_id=$1 AND applicant_user_id=$2 AND version=$4 RETURNING *`,
        [row.verification_id,row.applicant_user_id,input.now,input.expectedVersion],
      )
      const result = updated.rows[0]
      if (!result) throw workflowError('VERIFICATION_VERSION_CONFLICT',409)
      await this.recordOperation(client,{ ...input, operationType: 'withdraw' },result)
      if (row.status!=='draft') {
        await this.writeOutbox(client,{
          aggregateId: row.verification_id,eventName: 'author_verification_completed',
          eventVersion: positiveInteger(result.version),payload: {
            verification_id: row.verification_id,project_id: row.project_id,
            decision: 'withdraw',resulting_status: 'withdrawn',result: 'success',
          },now: input.now,
        })
      }
      await this.writeApplicantAudit(client,input,row.verification_id,'verification_withdraw')
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async resolveSelection(input: Readonly<{
    userId: string
    mode: CreatorResolutionMode
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (input.mode === 'use_existing_link') return this.resolveExistingLink(input)
    if (input.mode === 'create_new_creator') return this.resolveNewCreator(input)
    return this.resolveExistingCreator(input)
  }

  async projection(
    row: VerificationRequestRow,
    policy: ProvisionalLinkPolicy | null,
  ): Promise<VerificationRequestProjection> {
    const materials = await this.pool.query<{
      material_id: string
      verification_id: string
      status: string
      rejection_reason_code: string | null
      applicant_terminal_state_json: unknown
      upload_expires_at: Date
      version: string
    }>(
      `SELECT material_id,verification_id,status,rejection_reason_code,
         applicant_terminal_state_json,upload_expires_at,version
       FROM private_material.verification_materials
       WHERE verification_id=$1 AND owner_user_id=$2 AND status<>'deleted'
       ORDER BY created_at,material_id`,
      [row.verification_id,row.applicant_user_id],
    )
    const reviewMessage = await this.latestPublicReviewMessage(row.verification_id)
    const profileRef = row.approved_permission_profile_id === null
      ? null
      : Object.freeze({
          profile_id: row.approved_permission_profile_id,
          profile_version: row.approved_permission_profile_version === 1 ? 1 as const : invalid(),
          config_hash: row.approved_profile_config_hash ?? invalid(),
        })
    return Object.freeze({
      verification_id: row.verification_id,
      project_id: row.project_id,
      creator_resolution_mode: row.creator_resolution_mode,
      creator_account_link_id: row.creator_account_link_id,
      target_creator_id: row.target_creator_id,
      new_creator_profile_input: nullableProfile(row.new_creator_profile_input_json),
      requested_link_role: row.requested_link_role,
      provisional_link_policy: row.status === 'draft' || row.status === 'changes_requested' ? policy : null,
      link_policy_snapshot: nullablePolicySnapshot(row.link_policy_snapshot_json),
      method: row.method,
      public_summary: row.public_summary,
      material_summaries: Object.freeze(materials.rows.map(applicantMaterialSummary)),
      status: row.status,
      status_history: statusHistory(row.status_history_json),
      latest_public_review_message: reviewMessage,
      supersedes_verification_id: row.supersedes_verification_id,
      resulting_creator_id: row.resulting_creator_id,
      resulting_link_id: row.resulting_link_id,
      resulting_author_relation_id: row.resulting_author_relation_id,
      resulting_profile_version_id: row.resulting_profile_version_id,
      approved_link_role: row.approved_link_role,
      approved_permission_profile_ref: profileRef,
      version: positiveInteger(row.version),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private async latestPublicReviewMessage(
    verificationId: string,
  ): Promise<VerificationPublicReviewMessage | null> {
    const result = await this.pool.query<{
      decision: string
      field_paths_json: unknown
      committed_at: Date
    }>(
      `SELECT decision,field_paths_json,committed_at FROM workflow.review_decisions
       WHERE target_type='verification_request' AND target_id=$1
         AND decision IN ('changes_requested','reject')
       ORDER BY committed_at DESC,review_decision_id DESC LIMIT 1`,
      [verificationId],
    )
    const row = result.rows[0]
    if (!row) return null
    if (!Array.isArray(row.field_paths_json) || row.field_paths_json.some((value) => typeof value!=='string')) invalid()
    return Object.freeze({
      message_key: row.decision==='reject' ? 'verification_rejected' : 'verification_changes_requested',
      field_paths: Object.freeze([...(row.field_paths_json as string[])]),
      created_at: row.committed_at.toISOString(),
    })
  }

  private async resolveExistingLink(input: Readonly<{
    userId: string
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (!input.creatorAccountLinkId || input.targetCreatorId || input.newCreatorProfileInput || input.requestedLinkRole) {
      throw workflowError('VERIFICATION_RESOLUTION_INVALID', 422)
    }
    const result = await this.pool.query<{
      creator_id: string
      link_role: RequestedLinkRole
      profile_id: 'OWNER_V1' | 'MANAGER_V1'
      profile_version: number
      config_hash: string
      aggregate_version: string
      owner_link_set_version: string
      link_version: string
    }>(
      `SELECT link.creator_id,link.link_role,profile.profile_id,profile.profile_version,
         profile.config_hash,creator.aggregate_version,creator.owner_link_set_version,
         link.version AS link_version
       FROM catalog.creator_account_links link
       JOIN catalog.creators creator ON creator.creator_id=link.creator_id
       JOIN catalog.link_permission_profiles profile
         ON profile.profile_id=link.permission_profile_id
        AND profile.profile_version=link.permission_profile_version
        AND profile.config_hash=link.permission_profile_config_hash
       WHERE link.creator_account_link_id=$1 AND link.user_id=$2 AND link.status='active'
         AND creator.canonical_creator_id IS NULL`,
      [input.creatorAccountLinkId, input.userId],
    )
    const row = result.rows[0]
    if (!row) throw workflowError('CREATOR_ACCOUNT_LINK_NOT_FOUND', 404)
    return Object.freeze({
      mode: 'use_existing_link', creatorAccountLinkId: input.creatorAccountLinkId,
      targetCreatorId: null, newCreatorProfileInput: null, requestedLinkRole: null,
      provisionalPolicy: policy(row.aggregate_version, row.owner_link_set_version, [row.link_role],
        row.link_role, [{ profile_id: row.profile_id, profile_version: 1, config_hash: row.config_hash }]),
      observedOwnerLinkId: null, observedOwnerLinkVersion: null,
      reusedLinkVersion: positiveInteger(row.link_version),
    })
  }

  private async resolveNewCreator(input: Readonly<{
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (input.creatorAccountLinkId || input.targetCreatorId || !input.newCreatorProfileInput ||
        (input.requestedLinkRole !== null && input.requestedLinkRole !== 'owner')) {
      throw workflowError('VERIFICATION_RESOLUTION_INVALID', 422)
    }
    const owner = await this.profile('OWNER_V1')
    return Object.freeze({
      mode: 'create_new_creator', creatorAccountLinkId: null, targetCreatorId: null,
      newCreatorProfileInput: input.newCreatorProfileInput, requestedLinkRole: 'owner',
      provisionalPolicy: policy(null, null, ['owner'], 'owner', [owner]),
      observedOwnerLinkId: null, observedOwnerLinkVersion: null, reusedLinkVersion: null,
    })
  }

  private async resolveExistingCreator(input: Readonly<{
    userId: string
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (input.creatorAccountLinkId || !input.targetCreatorId || input.newCreatorProfileInput) {
      throw workflowError('VERIFICATION_RESOLUTION_INVALID', 422)
    }
    const creator = await this.pool.query<{
      aggregate_version: string
      owner_link_set_version: string
      owner_count: number
      applicant_link_count: number
      observed_owner_link_id: string | null
      observed_owner_link_version: string | null
    }>(
      `SELECT creator.aggregate_version,creator.owner_link_set_version,
         (SELECT count(*)::int FROM catalog.creator_account_links owner_link
           WHERE owner_link.creator_id=creator.creator_id AND owner_link.link_role='owner'
             AND owner_link.status IN ('active','suspended')) AS owner_count,
         (SELECT count(*)::int FROM catalog.creator_account_links applicant_link
           WHERE applicant_link.creator_id=creator.creator_id AND applicant_link.user_id=$2
             AND applicant_link.status='active') AS applicant_link_count,
         (SELECT owner_link.creator_account_link_id FROM catalog.creator_account_links owner_link
           WHERE owner_link.creator_id=creator.creator_id AND owner_link.link_role='owner'
             AND owner_link.status IN ('active','suspended') LIMIT 1) AS observed_owner_link_id,
         (SELECT owner_link.version::text FROM catalog.creator_account_links owner_link
           WHERE owner_link.creator_id=creator.creator_id AND owner_link.link_role='owner'
             AND owner_link.status IN ('active','suspended') LIMIT 1) AS observed_owner_link_version
       FROM catalog.creators creator
       WHERE creator.creator_id=$1 AND creator.canonical_creator_id IS NULL
         AND creator.merge_status='canonical' AND creator.current_profile_version_id IS NOT NULL
       `,
      [input.targetCreatorId, input.userId],
    )
    const row = creator.rows[0]
    if (!row) throw workflowError('CREATOR_NOT_FOUND', 404)
    if (row.applicant_link_count > 0) throw workflowError('CREATOR_ALREADY_LINKED', 409)
    const roles: RequestedLinkRole[] = row.owner_count === 0 ? ['owner', 'manager'] : ['manager']
    const requested = input.requestedLinkRole ?? roles[0]!
    if (!roles.includes(requested)) throw workflowError('VERIFICATION_LINK_ROLE_NOT_ALLOWED', 422)
    const refs = await Promise.all(roles.map((role) => this.profile(role === 'owner' ? 'OWNER_V1' : 'MANAGER_V1')))
    return Object.freeze({
      mode: 'claim_existing_creator', creatorAccountLinkId: null,
      targetCreatorId: input.targetCreatorId, newCreatorProfileInput: null,
      requestedLinkRole: requested,
      provisionalPolicy: policy(row.aggregate_version, row.owner_link_set_version, roles, roles[0]!, refs),
      observedOwnerLinkId: row.observed_owner_link_id,
      observedOwnerLinkVersion: row.observed_owner_link_version===null ? null : positiveInteger(row.observed_owner_link_version),
      reusedLinkVersion: null,
    })
  }

  private async profile(profileId: 'OWNER_V1' | 'MANAGER_V1') {
    const result = await this.pool.query<{ profile_id: 'OWNER_V1' | 'MANAGER_V1'; profile_version: number; config_hash: string }>(
      `SELECT profile_id,profile_version,config_hash FROM catalog.link_permission_profiles
       WHERE profile_id=$1 AND profile_version=1`, [profileId],
    )
    const row = result.rows[0]
    if (!row || row.profile_version !== 1) throw workflowError('LINK_POLICY_BASELINE_UNAVAILABLE', 503)
    return Object.freeze({ profile_id: row.profile_id, profile_version: 1 as const, config_hash: row.config_hash })
  }

  private async operationReplay(
    client: PoolClient,
    input: Readonly<{
      verificationId: string
      userId: string
      operationId: string
      requestHash: string
    }>,
  ): Promise<VerificationRequestRow | null> {
    const receipt = await client.query<{ request_hash: string; response_json: unknown }>(
      `SELECT request_hash,response_json FROM workflow.verification_request_operations
       WHERE verification_id=$1 AND applicant_user_id=$2 AND operation_id=$3`,
      [input.verificationId,input.userId,input.operationId],
    )
    if (!receipt.rows[0]) return null
    if (receipt.rows[0].request_hash!==input.requestHash) {
      throw workflowError('VERIFICATION_OPERATION_REUSED',409)
    }
    return hydrate(receipt.rows[0].response_json as VerificationRequestRow)
  }

  private async recordOperation(
    client: PoolClient,
    input: Readonly<{
      verificationId: string
      userId: string
      operationId: string
      operationType: 'submit' | 'supplement' | 'withdraw'
      requestHash: string
      now: Date
    }>,
    row: VerificationRequestRow,
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow.verification_request_operations (
         verification_id,applicant_user_id,operation_id,operation_type,request_hash,
         resulting_version,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [input.verificationId,input.userId,input.operationId,input.operationType,input.requestHash,
        row.version,JSON.stringify(row),input.now],
    )
  }

  private async assertMaterialSnapshot(
    client: PoolClient,
    row: VerificationRequestRow,
    materialIds: readonly string[],
  ): Promise<void> {
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM private_material.verification_materials
       WHERE material_id=ANY($1::uuid[]) AND verification_id=$2 AND owner_user_id=$3
         AND status='ready' AND scan_result='clean' AND revoked_at IS NULL
         AND (content_retention_until IS NULL OR content_retention_until>=now())`,
      [materialIds,row.verification_id,row.applicant_user_id],
    )
    if (result.rows[0]?.count!==materialIds.length) {
      throw workflowError('VERIFICATION_MATERIAL_NOT_READY',409)
    }
  }

  private async assertEvidenceRefs(
    client: PoolClient,
    projectId: string,
    evidenceRefs: readonly string[],
  ): Promise<void> {
    if (evidenceRefs.length===0) return
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM catalog.evidence
       WHERE evidence_id=ANY($1::uuid[]) AND project_id=$2 AND visibility='public'
         AND validity_status='valid' AND freshness_status<>'expired'`,
      [evidenceRefs,projectId],
    )
    if (result.rows[0]?.count!==evidenceRefs.length) {
      throw workflowError('VERIFICATION_EVIDENCE_REFS_INVALID',422)
    }
  }

  private async assertSelectionStillCurrent(
    client: PoolClient,
    row: VerificationRequestRow,
    selection: ResolutionSelection,
  ): Promise<void> {
    const refs = selection.provisionalPolicy.allowed_permission_profile_refs
    const deployed = await client.query<{ profile_id: string; profile_version: number; config_hash: string }>(
      `SELECT profile_id,profile_version,config_hash FROM catalog.link_permission_profiles
       WHERE (profile_id,profile_version,config_hash) IN (
         SELECT value->>'profile_id',(value->>'profile_version')::int,value->>'config_hash'
         FROM jsonb_array_elements($1::jsonb) value
       )`,
      [JSON.stringify(refs)],
    )
    if (deployed.rows.length!==refs.length) throw workflowError('LINK_PERMISSION_PROFILE_INVALID',503,true)
    if (selection.mode==='create_new_creator') return
    const creatorId = selection.mode==='use_existing_link'
      ? (await client.query<{ creator_id: string }>(
          `SELECT creator_id FROM catalog.creator_account_links
           WHERE creator_account_link_id=$1 AND user_id=$2 AND status='active'
             AND version=$3 FOR UPDATE`,
          [selection.creatorAccountLinkId,row.applicant_user_id,selection.reusedLinkVersion],
        )).rows[0]?.creator_id
      : selection.targetCreatorId
    if (!creatorId) throw workflowError('REUSED_LINK_CHANGED',409)
    const creator = await client.query<{ aggregate_version: string; owner_link_set_version: string }>(
      `SELECT aggregate_version,owner_link_set_version FROM catalog.creators
       WHERE creator_id=$1 AND canonical_creator_id IS NULL AND merge_status='canonical' FOR UPDATE`,
      [creatorId],
    )
    const current = creator.rows[0]
    if (!current || positiveInteger(current.aggregate_version)!==selection.provisionalPolicy.target_creator_aggregate_version) {
      throw workflowError('VERIFICATION_LINK_POLICY_CHANGED',409)
    }
    if (positiveInteger(current.owner_link_set_version)!==selection.provisionalPolicy.owner_link_set_version) {
      throw workflowError('OWNER_LINK_SET_CHANGED',409)
    }
    if (selection.observedOwnerLinkId) {
      const owner = await client.query<{ version: string }>(
        `SELECT version FROM catalog.creator_account_links
         WHERE creator_account_link_id=$1 AND creator_id=$2 AND link_role='owner'
           AND status IN ('active','suspended')`,
        [selection.observedOwnerLinkId,creatorId],
      )
      if (!owner.rows[0] || positiveInteger(owner.rows[0].version)!==selection.observedOwnerLinkVersion) {
        throw workflowError('OWNER_LINK_SET_CHANGED',409)
      }
    } else if (selection.mode==='claim_existing_creator') {
      const owner = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM catalog.creator_account_links
         WHERE creator_id=$1 AND link_role='owner' AND status IN ('active','suspended')`,
        [creatorId],
      )
      if ((owner.rows[0]?.count ?? 0)!==0) throw workflowError('OWNER_LINK_SET_CHANGED',409)
    }
  }

  private async writeOutbox(
    client: PoolClient,
    input: Readonly<{
      aggregateId: string
      aggregateType?: string
      eventName: string
      eventVersion: number
      payload: Readonly<Record<string,unknown>>
      now: Date
    }>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ops.outbox_events (
         outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
         transaction_id,status,next_attempt_at,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9,$9)`,
      [randomUUID(),randomUUID(),input.aggregateType ?? 'verification_request',input.aggregateId,
        input.eventName,input.eventVersion,JSON.stringify(input.payload),randomUUID(),input.now],
    )
  }

  private async writeApplicantAudit(
    client: PoolClient,
    input: Readonly<{ userId: string; requestHash: string; requestId: string; now: Date }>,
    verificationId: string,
    operationId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.audit_logs (
         operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         after_hash,reason_code,request_id,result,created_at
       ) VALUES ($1,'registered_user',digest($2::text,'sha256'),'[]'::jsonb,
         'verification_request',$3,$4,'applicant_action',left($5,64),'success',$6)`,
      [operationId,input.userId,verificationId,input.requestHash,input.requestId,input.now],
    )
  }

  private async explainPatchFailure(client: PoolClient, input: Readonly<{
    verificationId: string
    userId: string
    expectedVersion: number
  }>): Promise<never> {
    const current = await client.query<{ applicant_user_id: string; status: string; version: string }>(
      `SELECT applicant_user_id,status,version FROM workflow.verification_requests WHERE verification_id=$1`,
      [input.verificationId],
    )
    if (!current.rows[0] || current.rows[0].applicant_user_id !== input.userId) {
      throw workflowError('VERIFICATION_REQUEST_NOT_FOUND', 404)
    }
    if (!['draft','changes_requested'].includes(current.rows[0].status)) {
      throw workflowError('VERIFICATION_REQUEST_NOT_EDITABLE', 409)
    }
    throw workflowError('VERIFICATION_VERSION_CONFLICT', 409, false, {
      expected_version: input.expectedVersion,
      current_version: positiveInteger(current.rows[0].version),
    })
  }
}

async function insertRequest(client: PoolClient, input: Readonly<{
  userId: string
  projectId: string
  supersedesVerificationId: string | null
  selection: ResolutionSelection
  idempotencyKey: string
  requestHash: string
  now: Date
}>): Promise<VerificationRequestRow> {
  const result = await client.query<VerificationRequestRow>(
    `INSERT INTO workflow.verification_requests (
       project_id,applicant_user_id,creator_resolution_mode,creator_account_link_id,
       target_creator_id,new_creator_profile_input_json,requested_link_role,status_history_json,
       supersedes_verification_id,idempotency_key,request_hash,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$12) RETURNING *`,
    [input.projectId, input.userId, input.selection.mode, input.selection.creatorAccountLinkId,
      input.selection.targetCreatorId, input.selection.newCreatorProfileInput === null
        ? null
        : JSON.stringify(input.selection.newCreatorProfileInput),
      input.selection.requestedLinkRole,
      JSON.stringify([{ status: 'draft', at: input.now.toISOString() }]),
      input.supersedesVerificationId, input.idempotencyKey, input.requestHash, input.now],
  )
  return result.rows[0]!
}

function validateSupersedes(latest: VerificationRequestRow | null, supplied: string | null): void {
  if (!latest) {
    if (supplied !== null) throw workflowError('VERIFICATION_SUPERSEDES_INVALID', 409)
    return
  }
  if (['draft','pending','changes_requested'].includes(latest.status)) {
    throw workflowError('VERIFICATION_ACTIVE_REQUEST_EXISTS', 409)
  }
  if (latest.status === 'verified') throw workflowError('VERIFICATION_ALREADY_VERIFIED', 422)
  if (!['failed','withdrawn'].includes(latest.status) || supplied !== latest.verification_id) {
    throw workflowError('VERIFICATION_SUPERSEDES_STALE', 409)
  }
}

function policy(
  aggregateVersion: string | null,
  ownerSetVersion: string | null,
  roles: readonly RequestedLinkRole[],
  defaultRole: RequestedLinkRole,
  refs: ProvisionalLinkPolicy['allowed_permission_profile_refs'],
): ProvisionalLinkPolicy {
  return Object.freeze({
    policy_version: 'creator_link.v1',
    target_creator_aggregate_version: aggregateVersion === null ? null : positiveInteger(aggregateVersion),
    owner_link_set_version: ownerSetVersion === null ? null : positiveInteger(ownerSetVersion),
    allowed_link_roles: Object.freeze([...roles]),
    default_link_role: defaultRole,
    allowed_permission_profile_refs: Object.freeze([...refs]),
  })
}

function linkPolicySnapshot(selection: ResolutionSelection): LinkPolicySnapshot {
  return Object.freeze({
    ...selection.provisionalPolicy,
    observed_owner_link_id: selection.observedOwnerLinkId,
    observed_owner_link_version: selection.observedOwnerLinkVersion,
    reused_link_id: selection.mode==='use_existing_link' ? selection.creatorAccountLinkId : null,
    reused_link_version: selection.reusedLinkVersion,
  })
}

function nullablePolicySnapshot(value: unknown): LinkPolicySnapshot | null {
  if (value === null) return null
  if (!value || typeof value!=='object' || Array.isArray(value)) invalid()
  const snapshot = value as Record<string, unknown>
  if (
    snapshot.policy_version!=='creator_link.v1' ||
    !Array.isArray(snapshot.allowed_link_roles) ||
    !Array.isArray(snapshot.allowed_permission_profile_refs)
  ) invalid()
  return Object.freeze({ ...(snapshot as unknown as LinkPolicySnapshot) })
}

function applicantMaterialSummary(row: {
  material_id: string
  verification_id: string
  status: string
  rejection_reason_code: string | null
  applicant_terminal_state_json: unknown
  upload_expires_at: Date
  version: string
}): VerificationApplicantMaterialSummary {
  if ((row.status==='revoked' || row.status==='deleted') && row.applicant_terminal_state_json) {
    const stored = row.applicant_terminal_state_json
    if (!stored || typeof stored!=='object' || Array.isArray(stored)) invalid()
    return Object.freeze({
      ...(stored as VerificationApplicantMaterialSummary),
      next_action: 'none', upload_expires_at: null, version: positiveInteger(row.version),
    })
  }
  const base = { material_id: row.material_id, verification_id: row.verification_id, version: positiveInteger(row.version) }
  if (row.status==='prepared') return Object.freeze({ ...base, applicant_scan_state: 'pending', reason_key: null, next_action: 'complete_upload', upload_expires_at: row.upload_expires_at.toISOString() })
  if (row.status==='uploaded' || row.status==='scanning') return Object.freeze({ ...base, applicant_scan_state: 'pending', reason_key: null, next_action: 'wait', upload_expires_at: null })
  if (row.status==='ready') return Object.freeze({ ...base, applicant_scan_state: 'accepted', reason_key: null, next_action: 'continue_submission', upload_expires_at: null })
  if (row.status==='abandoned') return Object.freeze({ ...base, applicant_scan_state: 'rejected', reason_key: 'upload_expired', next_action: 'upload_new_material', upload_expires_at: null })
  const processing = row.rejection_reason_code==='SCAN_RETRY_EXHAUSTED' || row.rejection_reason_code==='SCAN_DEADLINE_EXCEEDED'
  return Object.freeze({ ...base, applicant_scan_state: 'rejected', reason_key: processing ? 'processing_unavailable' : 'file_rejected', next_action: 'upload_new_material', upload_expires_at: null })
}

function nullableProfile(value: unknown): NewCreatorProfileInput | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as NewCreatorProfileInput
}

function statusHistory(value: unknown): VerificationRequestProjection['status_history'] {
  if (!Array.isArray(value)) invalid()
  return Object.freeze(value as VerificationRequestProjection['status_history'])
}

function stringArray(value:unknown):readonly string[]{
  if(!Array.isArray(value)||value.some((item)=>typeof item!=='string'))invalid()
  return value as readonly string[]
}

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid()
  return parsed
}

function hydrate(row: VerificationRequestRow): VerificationRequestRow {
  return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) }
}

function invalid(): never {
  throw workflowError('VERIFICATION_REQUEST_DATA_INVALID', 503)
}
