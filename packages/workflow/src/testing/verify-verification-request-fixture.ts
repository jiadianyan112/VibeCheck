import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

import pg from 'pg'

import { PostgresVerificationRequestStore } from '../verification-request-store.js'
import { VerificationRequestService } from '../verification-request-service.js'
import { PostgresWorkflowStore } from '../postgres-store.js'
import { WorkflowService } from '../service.js'
import { PostgresAdminOperationSecurityStore } from '../admin-operation-postgres-store.js'
import { AdminOperationSecurityService } from '../admin-operation-service.js'
import { PostgresReviewDecisionStore } from '../review-decision-postgres-store.js'
import { ReviewDecisionService } from '../review-decision-service.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')

const pool = new pg.Pool({ connectionString: databaseUrl })
const now = new Date('2026-08-13T16:00:00.000Z')
const applicantId = '52000000-0000-4000-8000-000000000001'
const otherUserId = '52000000-0000-4000-8000-000000000002'
const reviewerId = '52000000-0000-4000-8000-000000000003'
const materialId = '52000000-0000-4000-8000-000000000004'
const ownerClaimApplicantId = '52000000-0000-4000-8000-000000000006'
const managerClaimApplicantId = '52000000-0000-4000-8000-000000000007'
const sessionToken = 'v'.repeat(43)
const authSecret = 'verification-fixture-auth-secret-at-least-32'
const tokenSecret = 'verification-fixture-token-secret-at-least-32'

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$6,$6),($2,'active',$6,$6),($3,'active',$6,$6),
       ($4,'active',$6,$6),($5,'active',$6,$6)
     ON CONFLICT (user_id) DO NOTHING`,
    [applicantId,otherUserId,reviewerId,ownerClaimApplicantId,managerClaimApplicantId,now],
  )
  const project = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM catalog.projects
     WHERE review_status IN ('published_platform','published_author')
     ORDER BY project_id`,
  )
  const projectId = project.rows[0]?.project_id
  const secondProjectId = project.rows[1]?.project_id
  const thirdProjectId = project.rows[2]?.project_id
  if (!projectId) throw new Error('VERIFICATION_FIXTURE_PROJECT_REQUIRED')
  if (!secondProjectId || !thirdProjectId) throw new Error('VERIFICATION_FIXTURE_PROJECT_SET_REQUIRED')
  const store = new PostgresVerificationRequestStore(pool)
  const service = new VerificationRequestService(store, () => now)
  const createCommand = {
    userId: applicantId,
    projectId,
    supersedesVerificationId: null,
    creatorResolutionMode: 'create_new_creator',
    creatorAccountLinkId: null,
    targetCreatorId: null,
    newCreatorProfileInput: { display_name: 'Fixture Creator' },
    requestedLinkRole: null,
    idempotencyKey: 'verification-fixture-create-0001',
    requestId: 'verification-fixture-create',
  } as const
  const before = await counts()
  const created = await service.create(createCommand)
  const replayed = await service.create(createCommand)
  assert.equal(replayed.verification_id, created.verification_id)
  assert.equal(created.status, 'draft')
  assert.equal(created.requested_link_role, 'owner')
  assert.equal(created.provisional_link_policy!.allowed_permission_profile_refs[0]?.profile_id, 'OWNER_V1')
  assert.equal(Object.hasOwn(created, 'applicant_user_id'), false)

  const patched = await service.patch({
    userId: applicantId,
    verificationId: created.verification_id,
    expectedVersion: 1,
    creatorResolutionMode: 'create_new_creator',
    creatorAccountLinkId: null,
    targetCreatorId: null,
    newCreatorProfileInput: { display_name: 'Fixture Creator', bio: 'Private draft profile.' },
    requestedLinkRole: 'owner',
    method: 'official_domain_control',
    publicSummary: 'I control the official project domain.',
    operationId: 'verification-fixture-patch-0001',
    requestId: 'verification-fixture-patch',
  })
  assert.equal(patched.version, 2)
  assert.equal(patched.public_summary, 'I control the official project domain.')
  const patchReplay = await service.patch({
    userId: applicantId,
    verificationId: created.verification_id,
    expectedVersion: 1,
    creatorResolutionMode: 'create_new_creator',
    creatorAccountLinkId: null,
    targetCreatorId: null,
    newCreatorProfileInput: { display_name: 'Fixture Creator', bio: 'Private draft profile.' },
    requestedLinkRole: 'owner',
    method: 'official_domain_control',
    publicSummary: 'I control the official project domain.',
    operationId: 'verification-fixture-patch-0001',
    requestId: 'verification-fixture-patch-retry',
  })
  assert.equal(patchReplay.version, 2)

  await assert.rejects(
    service.get({ userId: otherUserId, verificationId: created.verification_id }),
    (error: unknown) => error instanceof Error && error.message === 'VERIFICATION_REQUEST_NOT_FOUND',
  )
  await assert.rejects(
    service.create({ ...createCommand, idempotencyKey: 'verification-fixture-create-0002' }),
    (error: unknown) => error instanceof Error && error.message === 'VERIFICATION_ACTIVE_REQUEST_EXISTS',
  )
  const after = await counts()
  assert.equal(after.creatorCount, before.creatorCount)
  assert.equal(after.linkCount, before.linkCount)
  assert.equal(after.relationCount, before.relationCount)
  await pool.query(
    `INSERT INTO private_material.verification_materials (
       material_id,verification_id,owner_user_id,storage_key_ciphertext,storage_key_nonce,
       storage_key_auth_tag,storage_key_version,declared_mime,detected_mime,byte_size,
       checksum_sha256,status,scan_result,idempotency_key,request_hash,version,created_at,
       updated_at,upload_expires_at,completed_at,processing_deadline_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'fixture-v1','application/pdf','application/pdf',4,$7,
       'ready','clean','verification-fixture-material',$7,1,$8::timestamptz,$8::timestamptz,
       $8::timestamptz+interval '30 minutes',$8::timestamptz,
       $8::timestamptz+interval '30 minutes')`,
    [materialId,created.verification_id,applicantId,Buffer.from('fixture-key'),
      Buffer.alloc(12,1),Buffer.alloc(16,2),'a'.repeat(64),now],
  )
  const submitted=await service.submit({
    userId:applicantId,verificationId:created.verification_id,expectedVersion:2,
    materialIds:[materialId],submissionKey:'verification-fixture-submit-0001',
    requestId:'verification-fixture-submit',
  })
  assert.equal(submitted.status,'pending')
  const pending=await pool.query<{review_work_item_id:string;version:string}>(
    'SELECT review_work_item_id,version FROM workflow.verification_requests WHERE verification_id=$1',
    [created.verification_id],
  )
  const workItemId=pending.rows[0]!.review_work_item_id
  const sessionHash=createHmac('sha256',authSecret).update(sessionToken).digest()
  await pool.query(
    `INSERT INTO iam.sessions (
       session_id_hash,user_id,anonymous_subject_id,csrf_token_hash,roles_version,status,recent_auth_at,
       expires_at,created_at
     ) VALUES ($1,$2,$3,$5,1,'active',$4::timestamptz,
       $4::timestamptz+interval '1 hour',$4::timestamptz)
     ON CONFLICT (session_id_hash) DO NOTHING`,
    [sessionHash,reviewerId,'52000000-0000-4000-8000-000000000005',now,Buffer.alloc(32,7)],
  )
  const actor=Object.freeze({userId:reviewerId,roles:Object.freeze(['admin'] as const),permissions:Object.freeze([])})
  const workflow=new WorkflowService(new PostgresWorkflowStore(pool),{
    cursorSecret:tokenSecret,leaseSeconds:600,maximumClaimSeconds:3600,queuePageSize:25,
  },()=>now)
  const claim=await workflow.claimWorkItem({actor,workItemId,expectedVersion:1,
    expectedConflictPrincipalVersion:null,requestId:'verification_fixture_claim'})
  const security=new AdminOperationSecurityService(new PostgresAdminOperationSecurityStore(pool),{
    tokenSecret,authTokenSecret:authSecret,previewTtlSeconds:600,confirmTtlSeconds:120,
    recentAuthWindowSeconds:300,
  },()=>now)
  const preview=await security.preview({actor,sessionToken,operationType:'verification_review',
    targets:[{target_type:'verification_request',target_id:created.verification_id}],
    expectedVersions:{verification_request:Number(pending.rows[0]!.version),work_item:claim.version},
    proposedDiff:{status:'verified'},reasonCode:'verification_approved',claimToken:claim.claim_token,
    expectedConflictPrincipalVersion:null,requestId:'verification_fixture_preview'})
  const confirm=await security.confirm({actor,sessionToken,previewToken:preview.preview_token,
    confirmationSummaryHash:preview.confirmation_summary_hash,
    confirmRequestId:'verification_fixture_confirm',reauthGrantId:null,
    expectedConflictPrincipalVersion:null,requestId:'verification_fixture_confirm_request'})
  const currentVersion=await pool.query<{current_version_id:string|null}>(
    'SELECT current_version_id FROM catalog.projects WHERE project_id=$1',[projectId],
  )
  const decisionService=new ReviewDecisionService(new PostgresReviewDecisionStore(pool),{
    tokenSecret,authTokenSecret:authSecret,
  },()=>now)
  const decision=await decisionService.decideReview({actor,sessionToken,workItemId,
    previewToken:preview.preview_token,claimToken:claim.claim_token,
    confirmToken:confirm.confirm_token,decision:'approve',reasonCode:'verification_approved',
    fieldPaths:[],decisionEvidenceRefs:[],expectedVersion:claim.version,
    decisionRequestId:'verification_fixture_decision',decisionPayload:{
      author_role:'owner',field_permissions:['/project_core/current_name'],
      policy_version:'creator_link.v1',expected_creator_aggregate_version:null,
      expected_owner_link_set_version:null,expected_reused_link_version:null,
    },requestId:'verification_fixture_decision_request'})
  assert.equal(decision.domain_status,'verified')
  assert.equal(decision.creator_aggregate_version,2)
  assert.equal(decision.owner_link_set_version,1)
  assert.ok(decision.resulting_creator_id)
  assert.ok(decision.resulting_link_id)
  assert.ok(decision.resulting_author_relation_id)
  assert.ok(decision.resulting_profile_version_id)
  const completed=await service.get({userId:applicantId,verificationId:created.verification_id})
  assert.equal(completed.status,'verified')
  const finalCounts=await counts()
  assert.equal(finalCounts.creatorCount,before.creatorCount+1)
  assert.equal(finalCounts.linkCount,before.linkCount+1)
  assert.equal(finalCounts.relationCount,before.relationCount+1)
  const unchangedVersion=await pool.query<{current_version_id:string|null}>(
    'SELECT current_version_id FROM catalog.projects WHERE project_id=$1',[projectId],
  )
  assert.equal(unchangedVersion.rows[0]!.current_version_id,currentVersion.rows[0]!.current_version_id)

  const approveAdditional = async (input: Readonly<{
    label:string
    applicantUserId:string
    targetProjectId:string
    mode:'use_existing_link'|'claim_existing_creator'
    creatorAccountLinkId:string|null
    targetCreatorId:string|null
    requestedLinkRole:'owner'|'manager'|null
    authorRole:'owner'|'co_creator'|'maintainer'
  }>) => {
    const createdRequest=await service.create({
      userId:input.applicantUserId,projectId:input.targetProjectId,
      supersedesVerificationId:null,creatorResolutionMode:input.mode,
      creatorAccountLinkId:input.creatorAccountLinkId,targetCreatorId:input.targetCreatorId,
      newCreatorProfileInput:null,requestedLinkRole:input.requestedLinkRole,
      idempotencyKey:`verification-fixture-${input.label}-create`,
      requestId:`verification-fixture-${input.label}-create`,
    })
    const patchedRequest=await service.patch({
      userId:input.applicantUserId,verificationId:createdRequest.verification_id,expectedVersion:1,
      creatorResolutionMode:input.mode,creatorAccountLinkId:input.creatorAccountLinkId,
      targetCreatorId:input.targetCreatorId,newCreatorProfileInput:null,
      requestedLinkRole:input.requestedLinkRole,method:'official_account_control',
      publicSummary:`Fixture ${input.label} verification summary.`,
      operationId:`verification-fixture-${input.label}-patch`,
      requestId:`verification-fixture-${input.label}-patch`,
    })
    const additionalMaterialId=randomUUID()
    await pool.query(
      `INSERT INTO private_material.verification_materials (
         material_id,verification_id,owner_user_id,storage_key_ciphertext,storage_key_nonce,
         storage_key_auth_tag,storage_key_version,declared_mime,detected_mime,byte_size,
         checksum_sha256,status,scan_result,idempotency_key,request_hash,version,created_at,
         updated_at,upload_expires_at,completed_at,processing_deadline_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'fixture-v1','application/pdf','application/pdf',4,$7,
         'ready','clean',$8,$7,1,$9::timestamptz,$9::timestamptz,
         $9::timestamptz+interval '30 minutes',$9::timestamptz,
         $9::timestamptz+interval '30 minutes')`,
      [additionalMaterialId,createdRequest.verification_id,input.applicantUserId,
        Buffer.from(`fixture-${input.label}`),Buffer.alloc(12,3),Buffer.alloc(16,4),
        'b'.repeat(64),`verification-fixture-${input.label}-material`,now],
    )
    const submittedRequest=await service.submit({
      userId:input.applicantUserId,verificationId:createdRequest.verification_id,
      expectedVersion:patchedRequest.version,materialIds:[additionalMaterialId],
      submissionKey:`verification-fixture-${input.label}-submit`,
      requestId:`verification-fixture-${input.label}-submit`,
    })
    const snapshot=submittedRequest.link_policy_snapshot
    if(!snapshot)throw new Error('VERIFICATION_FIXTURE_SNAPSHOT_REQUIRED')
    const pendingRequest=await pool.query<{review_work_item_id:string;version:string}>(
      'SELECT review_work_item_id,version FROM workflow.verification_requests WHERE verification_id=$1',
      [createdRequest.verification_id],
    )
    const additionalWorkItemId=pendingRequest.rows[0]!.review_work_item_id
    const additionalClaim=await workflow.claimWorkItem({actor,workItemId:additionalWorkItemId,
      expectedVersion:1,expectedConflictPrincipalVersion:null,
      requestId:`verification_fixture_${input.label}_claim`})
    const additionalPreview=await security.preview({actor,sessionToken,
      operationType:'verification_review',
      targets:[{target_type:'verification_request',target_id:createdRequest.verification_id}],
      expectedVersions:{verification_request:Number(pendingRequest.rows[0]!.version),
        work_item:additionalClaim.version},proposedDiff:{status:'verified'},
      reasonCode:'verification_approved',claimToken:additionalClaim.claim_token,
      expectedConflictPrincipalVersion:null,
      requestId:`verification_fixture_${input.label}_preview`})
    const additionalConfirm=await security.confirm({actor,sessionToken,
      previewToken:additionalPreview.preview_token,
      confirmationSummaryHash:additionalPreview.confirmation_summary_hash,
      confirmRequestId:`verification_fixture_${input.label}_confirm`,reauthGrantId:null,
      expectedConflictPrincipalVersion:null,
      requestId:`verification_fixture_${input.label}_confirm_request`})
    const approvedRef=input.requestedLinkRole
      ? snapshot.allowed_permission_profile_refs.find((ref)=>
          ref.profile_id===(input.requestedLinkRole==='owner'?'OWNER_V1':'MANAGER_V1'))
      : undefined
    if(input.mode==='claim_existing_creator'&&!approvedRef){
      throw new Error('VERIFICATION_FIXTURE_PROFILE_REF_REQUIRED')
    }
    const additionalDecision=await decisionService.decideReview({actor,sessionToken,
      workItemId:additionalWorkItemId,previewToken:additionalPreview.preview_token,
      claimToken:additionalClaim.claim_token,confirmToken:additionalConfirm.confirm_token,
      decision:'approve',reasonCode:'verification_approved',fieldPaths:[],decisionEvidenceRefs:[],
      expectedVersion:additionalClaim.version,
      decisionRequestId:`verification_fixture_${input.label}_decision`,decisionPayload:{
        author_role:input.authorRole,field_permissions:['/project_core/current_name'],
        policy_version:snapshot.policy_version,
        expected_creator_aggregate_version:snapshot.target_creator_aggregate_version,
        expected_owner_link_set_version:snapshot.owner_link_set_version,
        expected_reused_link_version:snapshot.reused_link_version,
        ...(input.mode==='claim_existing_creator'?{
          approved_link_role:input.requestedLinkRole!,
          approved_permission_profile_ref:approvedRef!,
        }:{}),
      },requestId:`verification_fixture_${input.label}_decision_request`})
    assert.equal(additionalDecision.domain_status,'verified')
    assert.equal(additionalDecision.resulting_creator_id,
      input.targetCreatorId??decision.resulting_creator_id)
    if(input.mode==='use_existing_link'){
      assert.equal(additionalDecision.resulting_link_id,input.creatorAccountLinkId)
    }else{
      assert.equal(additionalDecision.approved_link_role,input.requestedLinkRole)
    }
    return additionalDecision
  }

  const submitExistingRequest = async (input:Readonly<{
    label:string;applicantUserId:string;targetProjectId:string;creatorAccountLinkId:string
  }>)=>{
    const request=await service.create({userId:input.applicantUserId,
      projectId:input.targetProjectId,supersedesVerificationId:null,
      creatorResolutionMode:'use_existing_link',creatorAccountLinkId:input.creatorAccountLinkId,
      targetCreatorId:null,newCreatorProfileInput:null,requestedLinkRole:null,
      idempotencyKey:`verification-fixture-${input.label}-create`,
      requestId:`verification-fixture-${input.label}-create`})
    const patchedRequest=await service.patch({userId:input.applicantUserId,
      verificationId:request.verification_id,expectedVersion:1,
      creatorResolutionMode:'use_existing_link',creatorAccountLinkId:input.creatorAccountLinkId,
      targetCreatorId:null,newCreatorProfileInput:null,requestedLinkRole:null,
      method:'official_account_control',publicSummary:`Fixture ${input.label} lifecycle summary.`,
      operationId:`verification-fixture-${input.label}-patch`,
      requestId:`verification-fixture-${input.label}-patch`})
    const readyMaterialId=randomUUID()
    await pool.query(
      `INSERT INTO private_material.verification_materials (
         material_id,verification_id,owner_user_id,storage_key_ciphertext,storage_key_nonce,
         storage_key_auth_tag,storage_key_version,declared_mime,detected_mime,byte_size,
         checksum_sha256,status,scan_result,idempotency_key,request_hash,version,created_at,
         updated_at,upload_expires_at,completed_at,processing_deadline_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'fixture-v1','application/pdf','application/pdf',4,$7,
         'ready','clean',$8,$7,1,$9::timestamptz,$9::timestamptz,
         $9::timestamptz+interval '30 minutes',$9::timestamptz,
         $9::timestamptz+interval '30 minutes')`,
      [readyMaterialId,request.verification_id,input.applicantUserId,
        Buffer.from(`fixture-${input.label}`),Buffer.alloc(12,5),Buffer.alloc(16,6),
        'c'.repeat(64),`verification-fixture-${input.label}-material`,now],
    )
    const submittedRequest=await service.submit({userId:input.applicantUserId,
      verificationId:request.verification_id,expectedVersion:patchedRequest.version,
      materialIds:[readyMaterialId],submissionKey:`verification-fixture-${input.label}-submit`,
      requestId:`verification-fixture-${input.label}-submit`})
    return Object.freeze({request:submittedRequest,materialId:readyMaterialId})
  }

  const decidePending = async(input:Readonly<{
    label:string;verificationId:string;decision:'changes_requested'|'reject';fieldPaths:readonly string[]
  }>)=>{
    const pendingRequest=await pool.query<{review_work_item_id:string;version:string}>(
      'SELECT review_work_item_id,version FROM workflow.verification_requests WHERE verification_id=$1',
      [input.verificationId],
    )
    const pendingWorkItemId=pendingRequest.rows[0]!.review_work_item_id
    const pendingClaim=await workflow.claimWorkItem({actor,workItemId:pendingWorkItemId,
      expectedVersion:1,expectedConflictPrincipalVersion:null,
      requestId:`verification_fixture_${input.label}_claim`})
    const resultingStatus=input.decision==='reject'?'failed':'changes_requested'
    const pendingPreview=await security.preview({actor,sessionToken,
      operationType:'verification_review',
      targets:[{target_type:'verification_request',target_id:input.verificationId}],
      expectedVersions:{verification_request:Number(pendingRequest.rows[0]!.version),
        work_item:pendingClaim.version},proposedDiff:{status:resultingStatus},
      reasonCode:`verification_${input.decision}`,claimToken:pendingClaim.claim_token,
      expectedConflictPrincipalVersion:null,
      requestId:`verification_fixture_${input.label}_preview`})
    const pendingConfirm=await security.confirm({actor,sessionToken,
      previewToken:pendingPreview.preview_token,
      confirmationSummaryHash:pendingPreview.confirmation_summary_hash,
      confirmRequestId:`verification_fixture_${input.label}_confirm`,reauthGrantId:null,
      expectedConflictPrincipalVersion:null,
      requestId:`verification_fixture_${input.label}_confirm_request`})
    return decisionService.decideReview({actor,sessionToken,workItemId:pendingWorkItemId,
      previewToken:pendingPreview.preview_token,claimToken:pendingClaim.claim_token,
      confirmToken:pendingConfirm.confirm_token,decision:input.decision,
      reasonCode:`verification_${input.decision}`,fieldPaths:input.fieldPaths,
      decisionEvidenceRefs:[],expectedVersion:pendingClaim.version,
      decisionRequestId:`verification_fixture_${input.label}_decision`,decisionPayload:{},
      requestId:`verification_fixture_${input.label}_decision_request`})
  }

  const reused=await approveAdditional({label:'use-existing',applicantUserId:applicantId,
    targetProjectId:secondProjectId,mode:'use_existing_link',
    creatorAccountLinkId:decision.resulting_link_id,targetCreatorId:null,requestedLinkRole:null,
    authorRole:'co_creator'})

  const ownerClaimCreatorId=randomUUID()
  const ownerClaimProfileId=randomUUID()
  await pool.query(
    `INSERT INTO catalog.creators (
       creator_id,current_profile_version_id,aggregate_version,owner_link_set_version,
       canonical_creator_id,merge_status,created_at,updated_at
     ) VALUES ($1,NULL,1,0,NULL,'canonical',$2,$2)`,[ownerClaimCreatorId,now],
  )
  await pool.query(
    `INSERT INTO catalog.creator_profile_versions (
       creator_profile_version_id,creator_id,base_version_id,source_creator_profile_draft_id,
       source_verification_request_id,profile_snapshot_json,avatar_media_reference_id,
       published_by_admin_id,created_at
     ) VALUES ($1,$2,NULL,NULL,NULL,$3::jsonb,NULL,NULL,$4)`,
    [ownerClaimProfileId,ownerClaimCreatorId,JSON.stringify({display_name:'Unclaimed Fixture Creator',
      bio:'Existing canonical creator without an owner.',avatar_url:null,contacts:[],external_links:[],
      verification_status:'unverified'}),now],
  )
  await pool.query(
    `UPDATE catalog.creators SET current_profile_version_id=$2,aggregate_version=2,
       updated_at=$3::timestamptz+interval '1 microsecond' WHERE creator_id=$1`,
    [ownerClaimCreatorId,ownerClaimProfileId,now],
  )
  const claimedOwner=await approveAdditional({label:'claim-owner',
    applicantUserId:ownerClaimApplicantId,targetProjectId:thirdProjectId,
    mode:'claim_existing_creator',creatorAccountLinkId:null,targetCreatorId:ownerClaimCreatorId,
    requestedLinkRole:'owner',authorRole:'owner'})
  const claimedManager=await approveAdditional({label:'claim-manager',
    applicantUserId:managerClaimApplicantId,targetProjectId:thirdProjectId,
    mode:'claim_existing_creator',creatorAccountLinkId:null,
    targetCreatorId:decision.resulting_creator_id,requestedLinkRole:'manager',
    authorRole:'maintainer'})

  const lifecycle=await submitExistingRequest({label:'changes-supplement-reject',
    applicantUserId:managerClaimApplicantId,targetProjectId:secondProjectId,
    creatorAccountLinkId:claimedManager.resulting_link_id!})
  const lifecycleWorkItem=await pool.query<{review_work_item_id:string}>(
    'SELECT review_work_item_id FROM workflow.verification_requests WHERE verification_id=$1',
    [lifecycle.request.verification_id],
  )
  await assert.rejects(
    workflow.claimWorkItem({actor:Object.freeze({userId:managerClaimApplicantId,
      roles:Object.freeze(['admin'] as const),permissions:Object.freeze([])}),
      workItemId:lifecycleWorkItem.rows[0]!.review_work_item_id,expectedVersion:1,
      expectedConflictPrincipalVersion:null,requestId:'verification_fixture_self_review'}),
    (error:unknown)=>error instanceof Error&&error.message==='CONFLICT_OF_INTEREST',
  )
  await decidePending({label:'changes-requested',verificationId:lifecycle.request.verification_id,
    decision:'changes_requested',fieldPaths:['/public_summary']})
  const changesRequested=await service.get({userId:managerClaimApplicantId,
    verificationId:lifecycle.request.verification_id})
  assert.equal(changesRequested.status,'changes_requested')
  assert.equal(changesRequested.latest_public_review_message?.message_key,
    'verification_changes_requested')
  const resubmitted=await service.supplement({userId:managerClaimApplicantId,
    verificationId:lifecycle.request.verification_id,expectedVersion:changesRequested.version,
    materialIds:[lifecycle.materialId],evidenceRefs:[],
    operationId:'verification-fixture-supplement-0001',
    requestId:'verification-fixture-supplement'})
  assert.equal(resubmitted.status,'pending')
  await decidePending({label:'supplement-reject',verificationId:lifecycle.request.verification_id,
    decision:'reject',fieldPaths:[]})
  const rejectedRequest=await service.get({userId:managerClaimApplicantId,
    verificationId:lifecycle.request.verification_id})
  assert.equal(rejectedRequest.status,'failed')

  const draftWithdrawal=await service.create({userId:otherUserId,projectId:thirdProjectId,
    supersedesVerificationId:null,creatorResolutionMode:'create_new_creator',
    creatorAccountLinkId:null,targetCreatorId:null,
    newCreatorProfileInput:{display_name:'Withdrawn Draft Creator'},requestedLinkRole:null,
    idempotencyKey:'verification-fixture-draft-withdraw-create',
    requestId:'verification-fixture-draft-withdraw-create'})
  const draftWithdrawn=await service.withdraw({userId:otherUserId,
    verificationId:draftWithdrawal.verification_id,expectedVersion:draftWithdrawal.version,
    operationId:'verification-fixture-draft-withdraw',reasonCode:null,
    requestId:'verification-fixture-draft-withdraw'})
  assert.equal(draftWithdrawn.status,'withdrawn')
  const draftCompletedEvent=await pool.query<{count:number}>(
    `SELECT count(*)::int AS count FROM ops.outbox_events
     WHERE aggregate_id=$1 AND event_name='author_verification_completed'`,
    [draftWithdrawal.verification_id],
  )
  assert.equal(draftCompletedEvent.rows[0]!.count,0)

  const pendingWithdrawal=await submitExistingRequest({label:'pending-withdraw',
    applicantUserId:managerClaimApplicantId,targetProjectId:secondProjectId,
    creatorAccountLinkId:claimedManager.resulting_link_id!})
  const pendingWithdrawn=await service.withdraw({userId:managerClaimApplicantId,
    verificationId:pendingWithdrawal.request.verification_id,
    expectedVersion:pendingWithdrawal.request.version,
    operationId:'verification-fixture-pending-withdraw',reasonCode:'applicant_changed_mind',
    requestId:'verification-fixture-pending-withdraw'})
  assert.equal(pendingWithdrawn.status,'withdrawn')
  const cancelledWorkItem=await pool.query<{status:string}>(
    `SELECT item.status FROM workflow.review_work_items item
     JOIN workflow.verification_requests request
       ON request.review_work_item_id=item.work_item_id
     WHERE request.verification_id=$1`,[pendingWithdrawal.request.verification_id],
  )
  assert.equal(cancelledWorkItem.rows[0]!.status,'cancelled')

  const changesWithdrawal=await submitExistingRequest({label:'changes-withdraw',
    applicantUserId:ownerClaimApplicantId,targetProjectId:projectId,
    creatorAccountLinkId:claimedOwner.resulting_link_id!})
  await decidePending({label:'changes-before-withdraw',
    verificationId:changesWithdrawal.request.verification_id,
    decision:'changes_requested',fieldPaths:['/method']})
  const changesWithdrawalState=await service.get({userId:ownerClaimApplicantId,
    verificationId:changesWithdrawal.request.verification_id})
  const changesWithdrawn=await service.withdraw({userId:ownerClaimApplicantId,
    verificationId:changesWithdrawal.request.verification_id,
    expectedVersion:changesWithdrawalState.version,
    operationId:'verification-fixture-changes-withdraw',reasonCode:null,
    requestId:'verification-fixture-changes-withdraw'})
  assert.equal(changesWithdrawn.status,'withdrawn')
  assert.equal(claimedOwner.owner_link_set_version,1)
  assert.equal(claimedManager.owner_link_set_version,reused.owner_link_set_version)
  console.info(JSON.stringify({
    verification_id: created.verification_id,
    status: completed.status,
    version: completed.version,
    idempotent: true,
    atomic_creator_link_relation: true,
    create_new_creator: true,
    use_existing_link: true,
    claim_existing_owner: true,
    claim_existing_manager: true,
    changes_supplement_reject: true,
    draft_pending_changes_withdraw: true,
    conflict_of_interest_rejected: true,
    project_version_created: false,
  }))

  async function counts() {
    const result = await pool.query<{
      creator_count: number
      link_count: number
      relation_count: number
    }>(`SELECT
      (SELECT count(*)::int FROM catalog.creators) AS creator_count,
      (SELECT count(*)::int FROM catalog.creator_account_links) AS link_count,
      (SELECT count(*)::int FROM catalog.author_relations) AS relation_count`)
    return {
      creatorCount: result.rows[0]!.creator_count,
      linkCount: result.rows[0]!.link_count,
      relationCount: result.rows[0]!.relation_count,
    }
  }
} finally {
  await pool.end()
}
