import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

import pg from 'pg'

import { AdminOperationSecurityService } from '../admin-operation-service.js'
import { PostgresAdminOperationSecurityStore } from '../admin-operation-postgres-store.js'
import { OwnershipCaseService } from '../ownership-case-service.js'
import { PostgresOwnershipCaseStore } from '../ownership-case-postgres-store.js'
import { PostgresReviewDecisionStore } from '../review-decision-postgres-store.js'
import { ReviewDecisionService } from '../review-decision-service.js'
import { PostgresWorkflowStore } from '../postgres-store.js'
import { WorkflowService } from '../service.js'

const databaseUrl=process.env.DATABASE_URL
if(!databaseUrl)throw new Error('DATABASE_URL_REQUIRED')
const pool=new pg.Pool({connectionString:databaseUrl})
const now=new Date('2026-08-20T12:00:00.000Z')
const openerId='56000000-0000-4000-8000-000000000001'
const appealedId='56000000-0000-4000-8000-000000000002'
const reviewerId='56000000-0000-4000-8000-000000000003'
const sessionToken='o'.repeat(43)
const authSecret='ownership-fixture-auth-secret-at-least-32'
const tokenSecret='ownership-fixture-token-secret-at-least-32'
const opener={userId:openerId,roles:['editor'] as const,permissions:['admin:identity_review'] as const}
const reviewer={userId:reviewerId,roles:['admin'] as const,permissions:[] as const}

try{
  await pool.query(`INSERT INTO iam.users (user_id,status,created_at,updated_at) VALUES ($1,'active',$4,$4),($2,'active',$4,$4),($3,'active',$4,$4) ON CONFLICT (user_id) DO NOTHING`,[openerId,appealedId,reviewerId,now])
  const sessionHash=createHmac('sha256',authSecret).update(sessionToken).digest()
  await pool.query(`INSERT INTO iam.sessions (session_id_hash,user_id,anonymous_subject_id,csrf_token_hash,roles_version,status,recent_auth_at,expires_at,created_at) VALUES ($1,$2,$3,$4,1,'active',$5::timestamptz,$5::timestamptz+interval '1 hour',$5::timestamptz) ON CONFLICT (session_id_hash) DO NOTHING`,[sessionHash,reviewerId,'56000000-0000-4000-8000-000000000004',Buffer.alloc(32,8),now])
  const relations=await pool.query<{author_relation_id:string;project_id:string}>("SELECT author_relation_id,project_id FROM catalog.author_relations WHERE status='active' ORDER BY created_at DESC,author_relation_id LIMIT 3")
  if(relations.rows.length<3)throw new Error('OWNERSHIP_FIXTURE_RELATIONS_REQUIRED')
  const ownership=new OwnershipCaseService(new PostgresOwnershipCaseStore(pool),tokenSecret,()=>now)
  const workflow=new WorkflowService(new PostgresWorkflowStore(pool),{cursorSecret:tokenSecret,leaseSeconds:60,maximumClaimSeconds:3600,queuePageSize:25},()=>now)
  const security=new AdminOperationSecurityService(new PostgresAdminOperationSecurityStore(pool),{tokenSecret,authTokenSecret:authSecret,previewTtlSeconds:600,confirmTtlSeconds:120,recentAuthWindowSeconds:300},()=>now)
  const decisions=new ReviewDecisionService(new PostgresReviewDecisionStore(pool),{tokenSecret,authTokenSecret:authSecret},()=>now)

  const open=async(relation:{author_relation_id:string;project_id:string},label:string)=>{
    const created=await ownership.create({actor:opener,authorRelationId:relation.author_relation_id,appealedUserId:appealedId,reasonCode:'ownership_claim_conflict',evidenceIds:[],clientRequestId:`ownership-${label}-create`,requestId:`ownership_${label}_create`})
    const replay=await ownership.create({actor:opener,authorRelationId:relation.author_relation_id,appealedUserId:appealedId,reasonCode:'ownership_claim_conflict',evidenceIds:[],clientRequestId:`ownership-${label}-create`,requestId:`ownership_${label}_replay`})
    assert.equal(replay.case_id,created.case_id);assert.equal(created.status,'open');assert.equal(created.resulting_author_relation_status,'suspended')
    const relationState=await pool.query<{status:string}>('SELECT status FROM catalog.author_relations WHERE author_relation_id=$1',[relation.author_relation_id]);assert.equal(relationState.rows[0]?.status,'suspended')
    const verificationState=await pool.query<{status:string}>(`SELECT verification.status FROM catalog.author_relations relation JOIN workflow.verification_requests verification ON verification.verification_id=relation.source_verification_id WHERE relation.author_relation_id=$1`,[relation.author_relation_id]);assert.equal(verificationState.rows[0]?.status,'verified')
    return created
  }
  const claim=async(caseId:string)=>{const state=await pool.query<{review_work_item_id:string;conflict_principal_version:number}>(`SELECT review_work_item_id,conflict_principal_version FROM workflow.ownership_cases WHERE case_id=$1`,[caseId]);const work=await pool.query<{version:number}>('SELECT version FROM workflow.review_work_items WHERE work_item_id=$1',[state.rows[0]!.review_work_item_id]);return workflow.claimWorkItem({actor:reviewer,workItemId:state.rows[0]!.review_work_item_id,expectedVersion:work.rows[0]!.version,expectedConflictPrincipalVersion:state.rows[0]!.conflict_principal_version,requestId:`ownership_claim_${randomUUID().slice(0,8)}`})}
  const decide=async(caseId:string,decision:'uphold'|'revoke'|'withdraw',withdrawalId:string|null)=>{const claimResult=await claim(caseId);const state=await pool.query<{version:string;conflict_principal_version:number}>(`SELECT version,conflict_principal_version FROM workflow.ownership_cases WHERE case_id=$1`,[caseId]);const resulting=decision==='uphold'?'resolved_upheld':decision==='revoke'?'resolved_revoked':'withdrawn';const preview=await security.preview({actor:reviewer,sessionToken,operationType:'ownership_review',targets:[{target_type:'ownership_case',target_id:caseId}],expectedVersions:{ownership_case:Number(state.rows[0]!.version),work_item:claimResult.version},proposedDiff:{status:resulting},reasonCode:`ownership_${decision}`,claimToken:claimResult.claim_token,expectedConflictPrincipalVersion:state.rows[0]!.conflict_principal_version,requestId:`ownership_preview_${decision}`});const confirm=await security.confirm({actor:reviewer,sessionToken,previewToken:preview.preview_token,confirmationSummaryHash:preview.confirmation_summary_hash,confirmRequestId:`ownership_confirm_${decision}`,reauthGrantId:null,expectedConflictPrincipalVersion:state.rows[0]!.conflict_principal_version,requestId:`ownership_confirm_req_${decision}`});return decisions.decideReview({actor:reviewer,sessionToken,workItemId:claimResult.work_item_id,previewToken:preview.preview_token,claimToken:claimResult.claim_token,confirmToken:confirm.confirm_token,decision,reasonCode:`ownership_${decision}`,fieldPaths:[],decisionEvidenceRefs:[],expectedVersion:claimResult.version,decisionRequestId:`ownership_decide_${decision}`,decisionPayload:{expected_conflict_principal_version:state.rows[0]!.conflict_principal_version,withdrawal_request_id:withdrawalId},requestId:`ownership_decide_req_${decision}`})}

  const withdrawCase=await open(relations.rows[0]!,'withdraw')
  const openerQueue=await workflow.listWorkItems({actor:opener,workType:'ownership_case',targetType:'ownership_case',status:'queued',cursor:null,requestId:'ownership_opener_queue'})
  assert.equal(openerQueue.items.some(x=>x.target_id===withdrawCase.case_id),false)
  const reviewerQueue=await workflow.listWorkItems({actor:reviewer,workType:'ownership_case',targetType:'ownership_case',status:'queued',cursor:null,requestId:'ownership_reviewer_queue'})
  assert.equal(reviewerQueue.items.some(x=>x.target_id===withdrawCase.case_id),true)
  const firstClaim=await claim(withdrawCase.case_id)
  const evidenceId=randomUUID()
  await pool.query(`INSERT INTO catalog.evidence (evidence_id,object_type,object_id,project_id,field_path,evidence_type,source_channel,source_summary,captured_at,collected_by,confidence,visibility,validity_status,freshness_status,dispute_status,created_at) VALUES ($1,'author_relation',$2,$3,NULL,'verified_author_statement','author_statement','Ownership fixture evidence',$4,'user','medium','reviewer_only','pending_review','valid','in_review',$4)`,[evidenceId,relations.rows[0]!.author_relation_id,relations.rows[0]!.project_id,now])
  const caseAfterClaim=await pool.query<{version:string}>('SELECT version FROM workflow.ownership_cases WHERE case_id=$1',[withdrawCase.case_id])
  const afterEvidence=await ownership.addEvidence({actor:{userId:appealedId,roles:['user'],permissions:[]},caseId:withdrawCase.case_id,expectedCaseVersion:Number(caseAfterClaim.rows[0]!.version),evidenceIds:[evidenceId],reasonCode:'appeal_supporting_evidence',clientRequestId:'ownership-evidence-0001',requestId:'ownership_evidence_add'})
  assert.equal(afterEvidence.conflict_principal_version,2);assert.equal(afterEvidence.work_item_status,'queued')
  await assert.rejects(workflow.heartbeatWorkItem({actor:reviewer,workItemId:firstClaim.work_item_id,claimToken:firstClaim.claim_token,requestId:'ownership_stale_heartbeat'}))
  const wr1=await ownership.requestWithdrawal({actor:opener,caseId:withdrawCase.case_id,expectedVersion:afterEvidence.version,reasonCode:'opened_in_error',evidenceIds:[],supersedesRequestId:null,clientRequestId:'ownership-withdraw-0001',requestId:'ownership_withdraw_1'})
  const rejectClaim=await claim(withdrawCase.case_id)
  const caseForReject=await pool.query<{version:string}>('SELECT version FROM workflow.ownership_cases WHERE case_id=$1',[withdrawCase.case_id])
  await ownership.rejectWithdrawal({actor:reviewer,caseId:withdrawCase.case_id,withdrawalRequestId:wr1.withdrawal_request_id!,claimToken:rejectClaim.claim_token,expectedCaseVersion:Number(caseForReject.rows[0]!.version),expectedRequestVersion:1,reasonCode:'review_must_continue',decisionId:randomUUID(),requestId:'ownership_withdraw_reject'})
  const caseAfterReject=await pool.query<{version:string}>('SELECT version FROM workflow.ownership_cases WHERE case_id=$1',[withdrawCase.case_id])
  const wr2=await ownership.requestWithdrawal({actor:opener,caseId:withdrawCase.case_id,expectedVersion:Number(caseAfterReject.rows[0]!.version),reasonCode:'new_evidence_resolves_case',evidenceIds:[evidenceId],supersedesRequestId:wr1.withdrawal_request_id!,clientRequestId:'ownership-withdraw-0002',requestId:'ownership_withdraw_2'})
  const withdrawn=await decide(withdrawCase.case_id,'withdraw',wr2.withdrawal_request_id!);assert.equal(withdrawn.resulting_status,'withdrawn')
  const history=await pool.query<{status:string}>('SELECT status FROM workflow.ownership_withdrawal_requests WHERE case_id=$1 ORDER BY created_at,withdrawal_request_id',[withdrawCase.case_id]);assert.deepEqual(history.rows.map(x=>x.status),['rejected','accepted'])
  const party=await ownership.getParty({userId:openerId,caseId:withdrawCase.case_id});assert.equal(party.decision_summary?.decision,'withdraw');assert.equal(Object.hasOwn(party,'opened_by_user_id'),false)

  const upholdCase=await open(relations.rows[1]!,'uphold');const upheld=await decide(upholdCase.case_id,'uphold',null);assert.equal(upheld.resulting_status,'resolved_upheld')
  const revokeCase=await open(relations.rows[2]!,'revoke');const revoked=await decide(revokeCase.case_id,'revoke',null);assert.equal(revoked.resulting_status,'resolved_revoked')
  const revokedFacts=await pool.query<{relation_status:string;verification_status:string}>(`SELECT relation.status relation_status,verification.status verification_status FROM catalog.author_relations relation JOIN workflow.verification_requests verification ON verification.verification_id=relation.source_verification_id WHERE relation.author_relation_id=$1`,[relations.rows[2]!.author_relation_id]);assert.deepEqual(revokedFacts.rows[0],{relation_status:'terminated',verification_status:'verified'})
  const eventCounts=await pool.query<{event_name:string;count:string}>(`SELECT event_name,count(*)::text count FROM ops.outbox_events WHERE aggregate_type='ownership_case' AND aggregate_id=ANY($1::text[]) GROUP BY event_name`,[[withdrawCase.case_id,upholdCase.case_id,revokeCase.case_id]]);assert.ok(eventCounts.rows.some(x=>x.event_name==='ownership_dispute_withdrawn'));assert.ok(eventCounts.rows.some(x=>x.event_name==='ownership_dispute_resolved'))
  console.log(JSON.stringify({status:'ok',cases:3,withdrawal_history:history.rows.length,principal_rotation:afterEvidence.conflict_principal_version}))
}finally{await pool.end()}
