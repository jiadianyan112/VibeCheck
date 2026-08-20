import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

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
const sessionToken = 'v'.repeat(43)
const authSecret = 'verification-fixture-auth-secret-at-least-32'
const tokenSecret = 'verification-fixture-token-secret-at-least-32'

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$4,$4),($2,'active',$4,$4),($3,'active',$4,$4)
     ON CONFLICT (user_id) DO NOTHING`,
    [applicantId, otherUserId,reviewerId, now],
  )
  const project = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM catalog.projects
     WHERE review_status IN ('published_platform','published_author')
     ORDER BY project_id LIMIT 1`,
  )
  const projectId = project.rows[0]?.project_id
  if (!projectId) throw new Error('VERIFICATION_FIXTURE_PROJECT_REQUIRED')
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
       'ready','clean','verification-fixture-material',$7,1,$8,$8,$8+interval '30 minutes',
       $8,$8+interval '30 minutes')`,
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
       session_id_hash,user_id,anonymous_subject_id,roles_version,status,recent_auth_at,
       expires_at,created_at
     ) VALUES ($1,$2,$3,1,'active',$4,$4+interval '1 hour',$4)
     ON CONFLICT (session_id_hash) DO NOTHING`,
    [sessionHash,reviewerId,'52000000-0000-4000-8000-000000000005',now],
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
  console.info(JSON.stringify({
    verification_id: created.verification_id,
    status: completed.status,
    version: completed.version,
    idempotent: true,
    atomic_creator_link_relation: true,
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
