import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { workflowError } from './errors.js'
import type { OwnershipCaseStore } from './ownership-case-store.js'
import type {
  OwnershipMutationProjection,
  OwnershipPartyCaseProjection,
  OwnershipPartyRole,
  OwnershipReviewerCaseProjection,
  OwnershipWithdrawalStatus,
} from './ownership-case-types.js'

interface CaseRow extends QueryResultRow {
  readonly case_id:string; readonly project_id:string; readonly author_relation_id:string
  readonly opened_by_user_id:string; readonly appealed_user_id:string|null; readonly reason_code:string
  readonly status:'open'|'investigating'|'resolved_upheld'|'resolved_revoked'|'withdrawn'
  readonly review_work_item_id:string; readonly decision:'uphold'|'revoke'|'withdraw'|null
  readonly decided_by_user_id:string|null; readonly active_withdrawal_request_id:string|null
  readonly latest_withdrawal_request_id:string|null; readonly conflict_principal_version:number
  readonly conflict_principal_hash:string; readonly resulting_author_relation_status:'active'|'suspended'|'terminated'|null
  readonly resulting_project_status:string|null; readonly version:string; readonly created_at:Date
  readonly updated_at:Date; readonly decided_at:Date|null
}
interface WorkRow extends QueryResultRow { readonly work_item_id:string;readonly status:'queued'|'claimed'|'decided'|'cancelled';readonly assignee_user_id:string|null;readonly claim_token_hash:Buffer|null;readonly lease_expires_at:Date|null;readonly version:number }
interface Principal { readonly userId:string;readonly reason:string;readonly sourceId:string }

export class PostgresOwnershipCaseStore implements OwnershipCaseStore {
  constructor(private readonly pool:Pool) {}

  async create(input:Parameters<OwnershipCaseStore['create']>[0]):Promise<OwnershipMutationProjection> {
    const client=await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`ownership:create:${input.actor.userId}:${input.clientRequestId}`])
      const replay=await client.query<{response_json:unknown;request_hash:string}&QueryResultRow>(
        `SELECT response_json,request_hash FROM workflow.ownership_operation_receipts
         WHERE actor_user_id=$1 AND operation_type='create' AND client_request_id=$2`,
        [input.actor.userId,input.clientRequestId])
      const requestHash=this.hash(this.canonical({appealed_user_id:input.appealedUserId,author_relation_id:input.authorRelationId,evidence_ids:input.evidenceIds,reason_code:input.reasonCode}))
      if(replay.rows[0]) { this.replay(replay.rows[0],requestHash);await client.query('COMMIT');return replay.rows[0].response_json as OwnershipMutationProjection }

      const relation=(await client.query<{
        author_relation_id:string;project_id:string;creator_id:string;source_verification_id:string;status:string;version:string
      }&QueryResultRow>('SELECT author_relation_id,project_id,creator_id,source_verification_id,status,version FROM catalog.author_relations WHERE author_relation_id=$1 FOR UPDATE',[input.authorRelationId])).rows[0]
      if(!relation)throw workflowError('AUTHOR_RELATION_NOT_FOUND',404)
      if(relation.status!=='active')throw workflowError('AUTHOR_RELATION_NOT_ACTIVE',409)
      await this.assertEvidence(client,input.evidenceIds,relation.project_id,relation.author_relation_id)
      const caseId=randomUUID(),workItemId=randomUUID()
      const evidenceRows=input.evidenceIds.map(id=>({evidenceId:id,submissionId:randomUUID()}))
      const principals=await this.principals(client,{caseId,openedBy:input.actor.userId,appealed:input.appealedUserId,
        creatorId:relation.creator_id,sourceVerificationId:relation.source_verification_id,
        additionalEvidenceSubmitters:input.evidenceIds.length?[[input.actor.userId,evidenceRows[0]!.submissionId] as const]:[]})
      const principalHash=this.principalHash(principals)
      await client.query(`INSERT INTO workflow.review_work_items (
        work_item_id,work_type,target_type,target_id,status,version,created_at,updated_at
      ) VALUES ($1,'ownership_case','ownership_case',$2,'queued',1,$3,$3)`,[workItemId,caseId,input.now])
      const relationUpdated=await client.query(`UPDATE catalog.author_relations SET status='suspended',version=version+1,updated_at=GREATEST($2,updated_at+interval '1 microsecond') WHERE author_relation_id=$1 AND status='active' AND version=$3`,[relation.author_relation_id,input.now,relation.version])
      if(relationUpdated.rowCount!==1)throw workflowError('AUTHOR_RELATION_VERSION_CONFLICT',409)
      const projectStatus=await this.recomputeProject(client,relation.project_id,'disputed',input.now)
      await client.query(`INSERT INTO workflow.ownership_cases (
        case_id,project_id,author_relation_id,opened_by_user_id,appealed_user_id,reason_code,status,
        review_work_item_id,conflict_principal_version,conflict_principal_hash,
        resulting_author_relation_status,resulting_project_status,version,created_at,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,1,$8,'suspended',$9,1,$10,$10)`,
      [caseId,relation.project_id,relation.author_relation_id,input.actor.userId,input.appealedUserId,input.reasonCode,workItemId,principalHash,projectStatus,input.now])
      for(const row of evidenceRows) await client.query(`INSERT INTO workflow.ownership_case_evidence_submissions (
        evidence_submission_id,case_id,evidence_id,submitted_by_user_id,summary,reason_code,client_request_id,request_hash,submitted_at
      ) SELECT $1,$2,evidence_id,$3,left(source_summary,1000),$4,$5,$6,$7 FROM catalog.evidence WHERE evidence_id=$8`,
      [row.submissionId,caseId,input.actor.userId,input.reasonCode,input.clientRequestId,requestHash,input.now,row.evidenceId])
      await this.savePrincipalSnapshot(client,caseId,workItemId,1,principalHash,principals,{
        case_version:1,author_relation_version:Number(relation.version),evidence_submission_count:evidenceRows.length,
      },input.now)
      const projection:object=Object.freeze({case_id:caseId,status:'open',review_work_item_id:workItemId,
        work_item_status:'queued',resulting_author_relation_status:'suspended',resulting_project_status:projectStatus,
        conflict_principal_version:1,version:1})
      await this.receipt(client,caseId,input.actor.userId,'create',input.clientRequestId,requestHash,projection,input.now)
      await this.outbox(client,'ownership_dispute_opened',caseId,relation.project_id,{case_id:caseId,author_relation_id:relation.author_relation_id,project_id:relation.project_id,case_status:'open',resulting_author_relation_status:'suspended',resulting_project_status:projectStatus,result:'succeeded'},input.now)
      await this.audit(client,'OP-OWNERSHIP-CREATE',input.actor.userId,input.actor.roles,caseId,null,this.hash(this.canonical(projection)),input.reasonCode,input.requestId,input.now)
      await client.query('COMMIT');return projection as OwnershipMutationProjection
    } catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw this.map(error)} finally{client.release()}
  }

  async getParty(input:Parameters<OwnershipCaseStore['getParty']>[0]):Promise<OwnershipPartyCaseProjection>{
    const client=await this.pool.connect();try{
      const row=await this.case(client,input.caseId);if(!row)throw workflowError('OWNERSHIP_CASE_NOT_FOUND',404)
      const roles=await this.partyRoles(client,row,input.userId);if(roles.length===0)throw workflowError('OWNERSHIP_CASE_NOT_FOUND',404)
      const evidence=await client.query<{evidence_id:string;submitted_at:Date}&QueryResultRow>('SELECT evidence_id,submitted_at FROM workflow.ownership_case_evidence_submissions WHERE case_id=$1 AND submitted_by_user_id=$2 ORDER BY submitted_at,evidence_id',[row.case_id,input.userId])
      const withdrawals=await client.query<{withdrawal_request_id:string;status:OwnershipWithdrawalStatus;reason_code:string;created_at:Date;decided_at:Date|null;decision_reason_code:string|null}&QueryResultRow>('SELECT withdrawal_request_id,status,reason_code,created_at,decided_at,decision_reason_code FROM workflow.ownership_withdrawal_requests WHERE case_id=$1 AND requested_by_user_id=$2 ORDER BY created_at,withdrawal_request_id',[row.case_id,input.userId])
      const terminal=['resolved_upheld','resolved_revoked','withdrawn'].includes(row.status)
      const actions:string[]=[];if(!terminal&&(roles.includes('opened_by')||roles.includes('appealed_account')||roles.includes('relation_principal')))actions.push('add_evidence');if(!terminal&&roles.includes('opened_by')&&row.active_withdrawal_request_id===null)actions.push('request_withdrawal')
      return Object.freeze({viewer_schema:'party',case_id:row.case_id,project_id:row.project_id,author_relation_id:row.author_relation_id,status:row.status,reason_code:row.reason_code,party_roles:Object.freeze(roles),my_evidence_submissions:Object.freeze(evidence.rows.map(x=>Object.freeze({evidence_id:x.evidence_id,submitted_at:x.submitted_at.toISOString()}))),my_withdrawal_requests:Object.freeze(withdrawals.rows.map(x=>Object.freeze({withdrawal_request_id:x.withdrawal_request_id,status:x.status,reason_code:x.reason_code,created_at:x.created_at.toISOString(),...(x.decided_at?{decided_at:x.decided_at.toISOString()}:{}),...(x.decision_reason_code?{decision_reason_key:`ownership.${x.decision_reason_code}`}:{})}))),...(terminal&&row.decision&&row.decided_at&&row.resulting_author_relation_status&&row.resulting_project_status?{decision_summary:Object.freeze({case_status:row.status as 'resolved_upheld'|'resolved_revoked'|'withdrawn',decision:row.decision,resulting_author_relation_status:row.resulting_author_relation_status as 'active'|'terminated',resulting_project_status:row.resulting_project_status,reason_key:`ownership.${row.reason_code}`,decided_at:row.decided_at.toISOString()})}:{}),allowed_actions:Object.freeze(actions as ('add_evidence'|'request_withdrawal')[]),version:Number(row.version),created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString()})
    }finally{client.release()}
  }

  async getReviewer(input:Parameters<OwnershipCaseStore['getReviewer']>[0]):Promise<OwnershipReviewerCaseProjection>{
    const client=await this.pool.connect();try{
      const row=await this.case(client,input.caseId);if(!row)throw workflowError('OWNERSHIP_CASE_NOT_FOUND',404)
      const work=await this.claimedWork(client,row.review_work_item_id,input.actorUserId,input.claimTokenHash,input.now)
      await this.assertActorNotConflict(client,row,input.actorUserId,work)
      const evidence=await client.query<{evidence_id:string;submitted_by_user_id:string;submitted_at:Date;summary:string}&QueryResultRow>('SELECT evidence_id,submitted_by_user_id,submitted_at,summary FROM workflow.ownership_case_evidence_submissions WHERE case_id=$1 ORDER BY submitted_at,evidence_id',[row.case_id])
      const withdrawal=await client.query<{withdrawal_request_id:string;requested_by_user_id:string;status:OwnershipWithdrawalStatus;reason_code:string;evidence_ids_json:unknown;created_at:Date;decided_at:Date|null;decision_reason_code:string|null}&QueryResultRow>('SELECT withdrawal_request_id,requested_by_user_id,status,reason_code,evidence_ids_json,created_at,decided_at,decision_reason_code FROM workflow.ownership_withdrawal_requests WHERE case_id=$1 ORDER BY created_at,withdrawal_request_id',[row.case_id])
      return Object.freeze({viewer_schema:'reviewer',case_id:row.case_id,project_id:row.project_id,author_relation_id:row.author_relation_id,opened_by_user_id:row.opened_by_user_id,...(row.appealed_user_id?{appealed_user_id:row.appealed_user_id}:{}),reason_code:row.reason_code,status:row.status,evidence_submissions:Object.freeze(evidence.rows.map(x=>Object.freeze({...x,submitted_at:x.submitted_at.toISOString()}))),withdrawal_requests:Object.freeze(withdrawal.rows.map(x=>Object.freeze({withdrawal_request_id:x.withdrawal_request_id,requested_by_user_id:x.requested_by_user_id,status:x.status,reason_code:x.reason_code,evidence_ids:this.stringArray(x.evidence_ids_json),created_at:x.created_at.toISOString(),...(x.decided_at?{decided_at:x.decided_at.toISOString()}:{}),...(x.decision_reason_code?{decision_reason_code:x.decision_reason_code}:{})}))),review_work_item_summary:Object.freeze({work_item_id:work.work_item_id,status:work.status,...(work.assignee_user_id?{assignee_user_id:work.assignee_user_id}:{}),...(work.lease_expires_at?{lease_expires_at:work.lease_expires_at.toISOString()}:{}),version:work.version}),conflict_principal_version:row.conflict_principal_version,...(row.decision?{decision:row.decision}:{}),...(row.decided_by_user_id?{decided_by_user_id:row.decided_by_user_id}:{}),...(row.resulting_author_relation_status?{resulting_author_relation_status:row.resulting_author_relation_status as 'active'|'terminated'}:{}),...(row.resulting_project_status?{resulting_project_status:row.resulting_project_status}:{}),allowed_actions:Object.freeze(['preview','request_more_evidence','decide','release'] as const),version:Number(row.version),created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString()})
    }finally{client.release()}
  }

  async addEvidence(input:Parameters<OwnershipCaseStore['addEvidence']>[0]):Promise<OwnershipMutationProjection>{
    return this.mutate(input.caseId,input.actor.userId,input.clientRequestId,'add_evidence',input.now,async(client,row,requestHash)=>{
      this.active(row);this.expected(row,input.expectedCaseVersion);await this.authorizeEvidenceActor(client,row,input.actor)
      await this.assertEvidence(client,input.evidenceIds,row.project_id,row.author_relation_id)
      for(const id of input.evidenceIds) await client.query(`INSERT INTO workflow.ownership_case_evidence_submissions (evidence_submission_id,case_id,evidence_id,submitted_by_user_id,summary,reason_code,client_request_id,request_hash,submitted_at) SELECT $1,$2,evidence_id,$3,left(source_summary,1000),$4,$5,$6,$7 FROM catalog.evidence WHERE evidence_id=$8`,[randomUUID(),row.case_id,input.actor.userId,input.reasonCode,input.clientRequestId,requestHash,input.now,id])
      const updated=await this.recomputePrincipals(client,row,input.now)
      return this.mutation(client,updated)
    },this.hash(this.canonical({evidence_ids:input.evidenceIds,expected_case_version:input.expectedCaseVersion,reason_code:input.reasonCode})),input.requestId,input.actor.roles,input.reasonCode)
  }

  async requestWithdrawal(input:Parameters<OwnershipCaseStore['requestWithdrawal']>[0]):Promise<OwnershipMutationProjection>{
    return this.mutate(input.caseId,input.actor.userId,input.clientRequestId,'request_withdrawal',input.now,async(client,row,requestHash)=>{
      this.active(row);this.expected(row,input.expectedVersion)
      if(input.actor.userId!==row.opened_by_user_id&&!input.actor.roles.includes('admin'))throw workflowError('OWNERSHIP_WITHDRAWAL_FORBIDDEN',403)
      if(row.active_withdrawal_request_id)throw workflowError('OWNERSHIP_WITHDRAWAL_ALREADY_REQUESTED',409)
      await this.assertEvidence(client,input.evidenceIds,row.project_id,row.author_relation_id)
      if(row.latest_withdrawal_request_id===null&&input.supersedesRequestId!==null)throw workflowError('OWNERSHIP_WITHDRAWAL_SUPERSEDES_INVALID',422)
      if(row.latest_withdrawal_request_id!==null){const latest=(await client.query<{status:string}&QueryResultRow>('SELECT status FROM workflow.ownership_withdrawal_requests WHERE withdrawal_request_id=$1 AND case_id=$2',[input.supersedesRequestId,row.case_id])).rows[0];if(input.supersedesRequestId!==row.latest_withdrawal_request_id||latest?.status!=='rejected')throw workflowError('OWNERSHIP_WITHDRAWAL_SUPERSEDES_INVALID',409)}
      const withdrawalId=randomUUID()
      await client.query(`INSERT INTO workflow.ownership_withdrawal_requests (withdrawal_request_id,case_id,requested_by_user_id,reason_code,evidence_ids_json,client_request_id,request_hash,status,supersedes_request_id,version,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'requested',$8,1,$9)`,[withdrawalId,row.case_id,input.actor.userId,input.reasonCode,JSON.stringify(input.evidenceIds),input.clientRequestId,requestHash,input.supersedesRequestId,input.now])
      const updated=await this.recomputePrincipals(client,row,input.now,withdrawalId)
      return {...await this.mutation(client,updated),withdrawal_request_id:withdrawalId,withdrawal_request_status:'requested'}
    },this.hash(this.canonical({evidence_ids:input.evidenceIds,expected_version:input.expectedVersion,reason_code:input.reasonCode,supersedes_request_id:input.supersedesRequestId})),input.requestId,input.actor.roles,input.reasonCode)
  }

  async rejectWithdrawal(input:Parameters<OwnershipCaseStore['rejectWithdrawal']>[0]):Promise<OwnershipMutationProjection>{
    const client=await this.pool.connect();try{await client.query('BEGIN')
      const row=await this.lockCase(client,input.caseId);if(!row)throw workflowError('OWNERSHIP_CASE_NOT_FOUND',404)
      const replay=await client.query<{withdrawal_request_id:string;status:OwnershipWithdrawalStatus;decided_by_user_id:string}&QueryResultRow>('SELECT withdrawal_request_id,status,decided_by_user_id FROM workflow.ownership_withdrawal_requests WHERE case_id=$1 AND decision_id=$2',[row.case_id,input.decisionId]);if(replay.rows[0]){if(replay.rows[0].withdrawal_request_id!==input.withdrawalRequestId||replay.rows[0].decided_by_user_id!==input.actor.userId)throw workflowError('OWNERSHIP_IDEMPOTENCY_CONFLICT',409);const result={...await this.mutation(client,row),withdrawal_request_id:input.withdrawalRequestId,withdrawal_request_status:replay.rows[0].status};await client.query('COMMIT');return Object.freeze(result)}
      this.active(row);this.expected(row,input.expectedCaseVersion)
      const work=await this.claimedWork(client,row.review_work_item_id,input.actor.userId,input.claimTokenHash,input.now);await this.assertActorNotConflict(client,row,input.actor.userId,work)
      if(row.active_withdrawal_request_id!==input.withdrawalRequestId)throw workflowError('OWNERSHIP_WITHDRAWAL_NOT_ACTIVE',409)
      const request=(await client.query<{status:string;version:string}&QueryResultRow>('SELECT status,version FROM workflow.ownership_withdrawal_requests WHERE withdrawal_request_id=$1 FOR UPDATE',[input.withdrawalRequestId])).rows[0]
      if(!request)throw workflowError('OWNERSHIP_WITHDRAWAL_NOT_FOUND',404);if(request.status!=='requested'||Number(request.version)!==input.expectedRequestVersion)throw workflowError('OWNERSHIP_WITHDRAWAL_VERSION_CONFLICT',409)
      await client.query(`UPDATE workflow.ownership_withdrawal_requests SET status='rejected',decision_id=$2,decided_by_user_id=$3,decision_reason_code=$4,version=version+1,decided_at=$5 WHERE withdrawal_request_id=$1`,[input.withdrawalRequestId,input.decisionId,input.actor.userId,input.reasonCode,input.now])
      const updated=(await client.query<CaseRow>(`UPDATE workflow.ownership_cases SET active_withdrawal_request_id=NULL,version=version+1,updated_at=$2 WHERE case_id=$1 RETURNING *`,[row.case_id,input.now])).rows[0]!
      const projection={...await this.mutation(client,updated),withdrawal_request_id:input.withdrawalRequestId,withdrawal_request_status:'rejected' as const}
      await this.audit(client,'OP-OWNERSHIP-WITHDRAW-REJECT',input.actor.userId,input.actor.roles,row.case_id,this.hash(this.canonical(row)),this.hash(this.canonical(projection)),input.reasonCode,input.requestId,input.now)
      await client.query('COMMIT');return Object.freeze(projection)
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw this.map(error)}finally{client.release()}
  }

  private async mutate(caseId:string,actorUserId:string,requestId:string,operation:string,now:Date,fn:(c:PoolClient,r:CaseRow,h:string)=>Promise<OwnershipMutationProjection>,requestHash:string,auditRequestId:string,roles:readonly string[],reason:string):Promise<OwnershipMutationProjection>{
    const client=await this.pool.connect();try{await client.query('BEGIN');const row=await this.lockCase(client,caseId);if(!row)throw workflowError('OWNERSHIP_CASE_NOT_FOUND',404)
      const replay=await client.query<{response_json:unknown;request_hash:string}&QueryResultRow>('SELECT response_json,request_hash FROM workflow.ownership_operation_receipts WHERE case_id=$1 AND actor_user_id=$2 AND operation_type=$3 AND client_request_id=$4',[caseId,actorUserId,operation,requestId]);if(replay.rows[0]){this.replay(replay.rows[0],requestHash);await client.query('COMMIT');return replay.rows[0].response_json as OwnershipMutationProjection}
      const result=await fn(client,row,requestHash);await this.receipt(client,caseId,actorUserId,operation,requestId,requestHash,result,now);await this.audit(client,`OP-OWNERSHIP-${operation.toUpperCase()}`,actorUserId,roles,caseId,this.hash(this.canonical(row)),this.hash(this.canonical(result)),reason,auditRequestId,now);await client.query('COMMIT');return Object.freeze(result)
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw this.map(error)}finally{client.release()}}

  private async recomputePrincipals(client:PoolClient,row:CaseRow,now:Date,withdrawalId:string|null=null):Promise<CaseRow>{
    const relation=(await client.query<{creator_id:string;source_verification_id:string}&QueryResultRow>('SELECT creator_id,source_verification_id FROM catalog.author_relations WHERE author_relation_id=$1',[row.author_relation_id])).rows[0]!
    const principals=await this.principals(client,{caseId:row.case_id,openedBy:row.opened_by_user_id,appealed:row.appealed_user_id,creatorId:relation.creator_id,sourceVerificationId:relation.source_verification_id,additionalEvidenceSubmitters:[]})
    const version=row.conflict_principal_version+1,hash=this.principalHash(principals)
    await this.releaseClaimAndTokens(client,row.review_work_item_id,now)
    await this.savePrincipalSnapshot(client,row.case_id,row.review_work_item_id,version,hash,principals,{case_version:Number(row.version)+1},now)
    return (await client.query<CaseRow>(`UPDATE workflow.ownership_cases SET conflict_principal_version=$2,conflict_principal_hash=$3,
      active_withdrawal_request_id=COALESCE($6,active_withdrawal_request_id),latest_withdrawal_request_id=COALESCE($6,latest_withdrawal_request_id),
      version=version+1,updated_at=GREATEST($4,updated_at+interval '1 microsecond') WHERE case_id=$1 AND version=$5 RETURNING *`,[row.case_id,version,hash,now,row.version,withdrawalId])).rows[0] ?? (()=>{throw workflowError('OWNERSHIP_CASE_VERSION_CONFLICT',409)})()
  }

  private async principals(client:PoolClient,x:{caseId:string;openedBy:string;appealed:string|null;creatorId:string;sourceVerificationId:string;additionalEvidenceSubmitters:readonly(readonly[string,string])[]}):Promise<readonly Principal[]>{
    const list:Principal[]=[{userId:x.openedBy,reason:'opened_by',sourceId:x.caseId}];if(x.appealed)list.push({userId:x.appealed,reason:'appealed_account',sourceId:x.caseId})
    const applicant=await client.query<{applicant_user_id:string}&QueryResultRow>('SELECT applicant_user_id FROM workflow.verification_requests WHERE verification_id=$1',[x.sourceVerificationId]);if(applicant.rows[0])list.push({userId:applicant.rows[0].applicant_user_id,reason:'original_applicant',sourceId:x.sourceVerificationId})
    const links=await client.query<{user_id:string;creator_account_link_id:string}&QueryResultRow>("SELECT user_id,creator_account_link_id FROM catalog.creator_account_links WHERE creator_id=$1 AND status IN ('active','suspended')",[x.creatorId]);for(const v of links.rows)list.push({userId:v.user_id,reason:'creator_link_principal',sourceId:v.creator_account_link_id})
    const evidence=await client.query<{submitted_by_user_id:string;evidence_submission_id:string}&QueryResultRow>('SELECT submitted_by_user_id,evidence_submission_id FROM workflow.ownership_case_evidence_submissions WHERE case_id=$1',[x.caseId]);for(const v of evidence.rows)list.push({userId:v.submitted_by_user_id,reason:'case_evidence_submitter',sourceId:v.evidence_submission_id});for(const [u,s] of x.additionalEvidenceSubmitters)list.push({userId:u,reason:'case_evidence_submitter',sourceId:s})
    const withdrawals=await client.query<{requested_by_user_id:string;withdrawal_request_id:string}&QueryResultRow>('SELECT requested_by_user_id,withdrawal_request_id FROM workflow.ownership_withdrawal_requests WHERE case_id=$1',[x.caseId]);for(const v of withdrawals.rows)list.push({userId:v.requested_by_user_id,reason:'withdrawal_requester',sourceId:v.withdrawal_request_id})
    const unique=new Map<string,Principal>();for(const p of list)unique.set(`${p.userId}|${p.reason}|${p.sourceId}`,p);return Object.freeze([...unique.values()].sort((a,b)=>`${a.userId}|${a.reason}|${a.sourceId}`.localeCompare(`${b.userId}|${b.reason}|${b.sourceId}`)))
  }

  private async savePrincipalSnapshot(client:PoolClient,caseId:string,workItemId:string,version:number,hash:string,principals:readonly Principal[],sourceVersions:unknown,now:Date):Promise<void>{
    await client.query('INSERT INTO workflow.ownership_conflict_principal_snapshots (case_id,conflict_principal_version,principal_hash,source_versions_json,calculated_at) VALUES ($1,$2,$3,$4::jsonb,$5)',[caseId,version,hash,JSON.stringify(sourceVersions),now])
    for(const p of principals)await client.query('INSERT INTO workflow.ownership_conflict_principal_members (case_id,conflict_principal_version,principal_user_id,principal_reason,source_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[caseId,version,p.userId,p.reason,p.sourceId,now])
    await client.query('UPDATE workflow.review_work_item_conflict_principals SET revoked_at=$2 WHERE work_item_id=$1 AND revoked_at IS NULL',[workItemId,now])
    for(const p of principals)await client.query(`INSERT INTO workflow.review_work_item_conflict_principals (work_item_id,principal_user_id,source_type,source_id,principal_version,created_at,revoked_at) VALUES ($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT (work_item_id,principal_user_id,source_type,source_id) DO UPDATE SET principal_version=EXCLUDED.principal_version,created_at=EXCLUDED.created_at,revoked_at=NULL`,[workItemId,p.userId,p.reason,p.sourceId,version,now])
  }

  private async releaseClaimAndTokens(client:PoolClient,workItemId:string,now:Date):Promise<void>{const work=(await client.query<WorkRow>('SELECT * FROM workflow.review_work_items WHERE work_item_id=$1 FOR UPDATE',[workItemId])).rows[0];if(work?.status==='claimed'){const previews=await client.query<{preview_id:string}&QueryResultRow>("UPDATE workflow.admin_operation_previews SET status='revoked',revoked_at=$2 WHERE claim_token_hash=$1 AND status IN ('active','reauth_required') RETURNING preview_id",[work.claim_token_hash,now]);if(previews.rows.length)await client.query("UPDATE workflow.admin_operation_confirm_grants SET status='revoked',revoked_at=$2 WHERE preview_id=ANY($1::uuid[]) AND status='active'",[previews.rows.map(x=>x.preview_id),now]);const updated=(await client.query<WorkRow>(`UPDATE workflow.review_work_items SET status='queued',assignee_user_id=NULL,claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,conflict_principal_version_at_claim=NULL,version=version+1,updated_at=$2 WHERE work_item_id=$1 RETURNING *`,[workItemId,now])).rows[0]!;await client.query(`INSERT INTO workflow.review_work_item_events (event_id,work_item_id,event_type,actor_user_id,from_status,to_status,work_item_version,reason_code,metadata_json,occurred_at) VALUES ($1,$2,'conflict_released',NULL,'claimed','queued',$3,'ownership_principals_changed','{}'::jsonb,$4)`,[randomUUID(),workItemId,updated.version,now])}}

  private async claimedWork(client:PoolClient,id:string,actor:string,token:Buffer,now:Date):Promise<WorkRow>{const w=(await client.query<WorkRow>('SELECT * FROM workflow.review_work_items WHERE work_item_id=$1',[id])).rows[0];if(!w||w.status!=='claimed')throw workflowError('WORK_ITEM_NOT_CLAIMED',409);if(w.assignee_user_id!==actor||!w.claim_token_hash?.equals(token))throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN',403);if(!w.lease_expires_at||w.lease_expires_at<=now)throw workflowError('WORK_ITEM_LEASE_EXPIRED',410);return w}
  private async assertActorNotConflict(client:PoolClient,row:CaseRow,user:string,work:WorkRow):Promise<void>{const found=await client.query(`SELECT 1 FROM workflow.ownership_cases ownership JOIN catalog.author_relations relation ON relation.author_relation_id=ownership.author_relation_id WHERE ownership.case_id=$1 AND (ownership.opened_by_user_id=$3 OR ownership.appealed_user_id=$3 OR EXISTS (SELECT 1 FROM workflow.ownership_conflict_principal_members member WHERE member.case_id=$1 AND member.conflict_principal_version=$2 AND member.principal_user_id=$3) OR EXISTS (SELECT 1 FROM workflow.verification_requests verification WHERE verification.verification_id=relation.source_verification_id AND verification.applicant_user_id=$3) OR EXISTS (SELECT 1 FROM catalog.creator_account_links link WHERE link.creator_id=relation.creator_id AND link.user_id=$3 AND link.status IN ('active','suspended')) OR EXISTS (SELECT 1 FROM workflow.ownership_case_evidence_submissions evidence WHERE evidence.case_id=$1 AND evidence.submitted_by_user_id=$3) OR EXISTS (SELECT 1 FROM workflow.ownership_withdrawal_requests withdrawal WHERE withdrawal.case_id=$1 AND withdrawal.requested_by_user_id=$3)) LIMIT 1`,[row.case_id,row.conflict_principal_version,user]);if(found.rowCount)throw workflowError('CONFLICT_OF_INTEREST',403);if(work.conflict_principal_version_at_claim!==row.conflict_principal_version)throw workflowError('CONFLICT_PRINCIPAL_VERSION_CONFLICT',409)}
  private async authorizeEvidenceActor(client:PoolClient,row:CaseRow,actor:{userId:string;roles:readonly string[]}):Promise<void>{if(actor.roles.includes('admin')||actor.roles.includes('editor'))return;const roles=await this.partyRoles(client,row,actor.userId);if(!roles.includes('appealed_account')&&!roles.includes('relation_principal')&&!roles.includes('opened_by'))throw workflowError('OWNERSHIP_EVIDENCE_FORBIDDEN',403)}
  private async partyRoles(client:PoolClient,row:CaseRow,user:string):Promise<OwnershipPartyRole[]>{const roles:OwnershipPartyRole[]=[];if(row.opened_by_user_id===user)roles.push('opened_by');if(row.appealed_user_id===user)roles.push('appealed_account');const relation=await client.query('SELECT 1 FROM catalog.author_relations relation JOIN catalog.creator_account_links link ON link.creator_id=relation.creator_id AND link.user_id=$2 AND link.status IN (\'active\',\'suspended\') WHERE relation.author_relation_id=$1',[row.author_relation_id,user]);if(relation.rowCount)roles.push('relation_principal');const evidence=await client.query('SELECT 1 FROM workflow.ownership_case_evidence_submissions WHERE case_id=$1 AND submitted_by_user_id=$2 LIMIT 1',[row.case_id,user]);if(evidence.rowCount)roles.push('evidence_submitter');const order:OwnershipPartyRole[]=['opened_by','appealed_account','relation_principal','evidence_submitter'];return order.filter(x=>roles.includes(x))}
  private async assertEvidence(client:PoolClient,ids:readonly string[],projectId:string,relationId:string):Promise<void>{if(ids.length===0)return;const r=await client.query<{count:string}&QueryResultRow>(`SELECT count(DISTINCT evidence_id)::text count FROM catalog.evidence WHERE evidence_id=ANY($1::uuid[]) AND validity_status IN ('pending_review','valid','suspended') AND (project_id=$2 OR (object_type='author_relation' AND object_id=$3))`,[ids,projectId,relationId]);if(Number(r.rows[0]?.count)!==ids.length)throw workflowError('OWNERSHIP_EVIDENCE_INVALID',422)}
  private async recomputeProject(client:PoolClient,projectId:string,authorLinkStatus:string,now:Date):Promise<string>{const count=await client.query<{count:string}&QueryResultRow>("SELECT count(*)::text count FROM catalog.author_relations WHERE project_id=$1 AND status='active'",[projectId]);const status=Number(count.rows[0]?.count)>0?'published_author':'published_platform';const current=await client.query<{review_status:string}&QueryResultRow>('SELECT review_status FROM catalog.projects WHERE project_id=$1 FOR UPDATE',[projectId]);const review=['restricted','archived','deleted'].includes(current.rows[0]?.review_status??'')?current.rows[0]!.review_status:status;await client.query(`UPDATE catalog.projects SET review_status=$2,author_link_status=$3::varchar,completeness_level=CASE WHEN $3::varchar='disputed' THEN 'disputed' ELSE completeness_level END,aggregate_version=aggregate_version+1,updated_at=$4 WHERE project_id=$1`,[projectId,review,authorLinkStatus,now]);return review}
  private async mutation(client:PoolClient,row:CaseRow):Promise<OwnershipMutationProjection>{const w=(await client.query<WorkRow>('SELECT * FROM workflow.review_work_items WHERE work_item_id=$1',[row.review_work_item_id])).rows[0]!;return Object.freeze({case_id:row.case_id,status:row.status,review_work_item_id:row.review_work_item_id,work_item_status:w.status as 'queued'|'claimed',resulting_author_relation_status:row.resulting_author_relation_status??'suspended',resulting_project_status:row.resulting_project_status??'published_platform',conflict_principal_version:row.conflict_principal_version,version:Number(row.version)})}
  private async case(c:PoolClient,id:string):Promise<CaseRow|undefined>{return (await c.query<CaseRow>('SELECT * FROM workflow.ownership_cases WHERE case_id=$1',[id])).rows[0]}
  private async lockCase(c:PoolClient,id:string):Promise<CaseRow|undefined>{return (await c.query<CaseRow>('SELECT * FROM workflow.ownership_cases WHERE case_id=$1 FOR UPDATE',[id])).rows[0]}
  private active(r:CaseRow):void{if(!['open','investigating'].includes(r.status))throw workflowError('OWNERSHIP_CASE_TERMINAL',410)}
  private expected(r:CaseRow,v:number):void{if(Number(r.version)!==v)throw workflowError('OWNERSHIP_CASE_VERSION_CONFLICT',409,false,{expected_version:v,current_version:Number(r.version)})}
  private principalHash(p:readonly Principal[]):string{return this.hash(p.map(x=>`${x.userId}|${x.reason}|${x.sourceId}`).join('\n'))}
  private stringArray(v:unknown):readonly string[]{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw workflowError('OWNERSHIP_STORED_JSON_INVALID',500);return Object.freeze([...v] as string[])}
  private replay(r:{request_hash:string;response_json:unknown},h:string):void{if(r.request_hash!==h)throw workflowError('OWNERSHIP_IDEMPOTENCY_CONFLICT',409)}
  private async receipt(c:PoolClient,caseId:string,actor:string,op:string,req:string,h:string,response:unknown,now:Date):Promise<void>{await c.query('INSERT INTO workflow.ownership_operation_receipts (case_id,actor_user_id,operation_type,client_request_id,request_hash,response_json,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',[caseId,actor,op,req,h,JSON.stringify(response),now])}
  private async outbox(c:PoolClient,event:string,caseId:string,projectId:string,payload:unknown,now:Date):Promise<void>{await c.query(`INSERT INTO ops.outbox_events (outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,transaction_id,status,next_attempt_at,created_at) VALUES ($1,$2,'ownership_case',$3,$4,1,$5::jsonb,$6,'pending',$7,$7)`,[randomUUID(),randomUUID(),caseId,event,JSON.stringify(payload),randomUUID(),now])}
  private async audit(c:PoolClient,op:string,actor:string,roles:readonly string[],target:string,before:string|null,after:string,reason:string,request:string,now:Date):Promise<void>{await c.query(`INSERT INTO audit.audit_logs (audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,before_hash,after_hash,reason_code,request_id,result,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,'ownership_case',$6,$7,$8,$9,$10,'succeeded',$11)`,[randomUUID(),op,roles.includes('admin')?'admin':'platform_editor',createHash('sha256').update(actor).digest(),JSON.stringify(roles),target,before,after,reason,request.slice(0,64),now])}
  private canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(x=>this.canonical(x)).join(',')}]`;const o=v as Record<string,unknown>;return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${this.canonical(o[k])}`).join(',')}}`}
  private hash(v:string):string{return createHash('sha256').update(v).digest('hex')}
  private map(e:unknown):unknown{if(e&&typeof e==='object'&&'code'in e){const code=String((e as {code:unknown}).code);if(code==='23505')return workflowError('OWNERSHIP_CONCURRENT_CONFLICT',409);if(code==='23514')return workflowError('OWNERSHIP_INVARIANT_VIOLATION',409)}return e}
}
