import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import pg from 'pg'
import { CatalogService, DeveloperAccountService, PostgresCatalogStore, PostgresAuthorAuthorizationResolver } from '@vibecheck/catalog'
import { PostgresVerificationRequestStore } from '../verification-request-store.js'
import { VerificationRequestService } from '../verification-request-service.js'
import { PostgresWorkflowStore } from '../postgres-store.js'
import { WorkflowService } from '../service.js'
import { PostgresAdminOperationSecurityStore } from '../admin-operation-postgres-store.js'
import { AdminOperationSecurityService } from '../admin-operation-service.js'
import { PostgresReviewDecisionStore } from '../review-decision-postgres-store.js'
import { ReviewDecisionService } from '../review-decision-service.js'

const databaseUrl = process.env.DATABASE_URL
if (process.env.NODE_ENV !== 'test' || !databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('LOCAL_TEST_DATABASE_REQUIRED')
const pool = new pg.Pool({ connectionString: databaseUrl })
const now = new Date('2026-10-08T00:00:00Z')
const authSecret = 'developer-v1-test-auth-secret-at-least-32'
const tokenSecret = 'developer-v1-test-token-secret-at-least-32'
const users = [randomUUID(), randomUUID(), randomUUID()]
const reviewerId = users[2]!
const sessionToken = randomUUID() + randomUUID()
const actor = { userId: reviewerId, roles: ['admin'] as const, permissions: [] }
const verification = new VerificationRequestService(new PostgresVerificationRequestStore(pool), () => now)
const workflow = new WorkflowService(new PostgresWorkflowStore(pool), { cursorSecret: tokenSecret, leaseSeconds: 60, maximumClaimSeconds: 3600, queuePageSize: 25 }, () => now)
const security = new AdminOperationSecurityService(new PostgresAdminOperationSecurityStore(pool), { tokenSecret, authTokenSecret: authSecret, previewTtlSeconds: 600, confirmTtlSeconds: 120, recentAuthWindowSeconds: 300 }, () => now)
const decisions = new ReviewDecisionService(new PostgresReviewDecisionStore(pool), { tokenSecret, authTokenSecret: authSecret }, () => now)
const authorization = new PostgresAuthorAuthorizationResolver(pool)
const catalog = new CatalogService({ store: new PostgresCatalogStore(pool), cursorSecret: tokenSecret, now: () => now })
const accounts = new DeveloperAccountService({ pool, catalog, authorization, cursorSecret: tokenSecret })

async function seedProject(kind: 'individual' | 'team') {
  const id = randomUUID(), version = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    await client.query(`INSERT INTO catalog.projects (
      project_id,current_version_id,current_name,category_id,category_schema_version,canonical_public_url,canonical_url_hash,
      review_status,access_status,http_check_status,author_link_status,completeness_level,freshness_status,record_source,
      first_seen_at,last_verified_at,created_at,updated_at,developer_management_v1
    ) SELECT $1,$2,'Developer v1 integration',category_id,category_schema_version,$3::text,digest($3::text,'sha256'),
      'published_platform','normal','normal','unlinked',completeness_level,freshness_status,record_source,$4,$4,$4,$4,true
      FROM catalog.projects WHERE project_id='10000000-0000-4000-8000-000000000001'`, [id, version, `https://example.com/developer-v1/${id}`, now])
    await client.query(`INSERT INTO catalog.project_versions (
      version_id,project_id,version_number,category_id,category_schema_version,snapshot_json,source_decision_type,source_decision_id,transaction_id,effective_at,created_at
    ) SELECT $1,$2,1,category_id,category_schema_version,jsonb_set(jsonb_set(snapshot_json,'{project_core,publication_details}',
      jsonb_build_object('developer',jsonb_build_object('kind',$3::text,'displayName','Self declared developer'))),'{project_core,current_name}','"Developer v1 integration"'),
      'admin_fact_decision',$4,$5,$6,$6 FROM catalog.project_versions WHERE version_id='11000000-0000-4000-8000-000000000001'`, [version, id, kind, randomUUID(), randomUUID(), now])
    await client.query('COMMIT')
    return id
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function create(userId: string, projectId: string, kind: 'individual' | 'team') {
  return verification.create({ userId, projectId, creatorResolutionMode: 'create_new_creator', creatorAccountLinkId: null, targetCreatorId: null,
    newCreatorProfileInput: { kind, display_name: 'Reviewed developer', website_url: 'https://example.com' }, requestedLinkRole: 'owner',
    supersedesVerificationId: null, idempotencyKey: randomUUID() })
}

async function submit(userId: string, request: Awaited<ReturnType<typeof create>>) {
  const profile = request.new_creator_profile_input!
  const patched = await verification.patch({ userId, verificationId: request.verification_id, expectedVersion: request.version,
    creatorResolutionMode: 'create_new_creator', creatorAccountLinkId: null, targetCreatorId: null, newCreatorProfileInput: profile,
    requestedLinkRole: 'owner', method: 'manual_material_review', publicSummary: 'I developed and manage this project.', operationId: randomUUID() })
  const materialId = randomUUID()
  await pool.query(`INSERT INTO private_material.verification_materials (
    material_id,verification_id,owner_user_id,storage_key_ciphertext,storage_key_nonce,storage_key_auth_tag,storage_key_version,
    declared_mime,detected_mime,byte_size,checksum_sha256,status,scan_result,idempotency_key,request_hash,version,created_at,updated_at,
    upload_expires_at,completed_at,processing_deadline_at
  ) VALUES ($1,$2,$3,$4,$5,$6,'test-v1','application/pdf','application/pdf',4,$7,'ready','clean',$8,$7,1,$9,$9,
    $9::timestamptz+interval '30 minutes',$9,$9::timestamptz+interval '30 minutes')`,
    [materialId, request.verification_id, userId, Buffer.from('test-private-material'), Buffer.alloc(12, 1), Buffer.alloc(16, 2), 'a'.repeat(64), randomUUID(), now])
  return verification.submit({ userId, verificationId: request.verification_id, expectedVersion: patched.version, materialIds: [materialId], submissionKey: randomUUID() })
}

async function prepareApproval(request: Awaited<ReturnType<typeof create>>) {
  const item = await pool.query<{ review_work_item_id: string }>('SELECT review_work_item_id FROM workflow.verification_requests WHERE verification_id=$1', [request.verification_id])
  const workItemId = item.rows[0]!.review_work_item_id
  const claim = await workflow.claimWorkItem({ actor, workItemId, expectedVersion: 1, expectedConflictPrincipalVersion: null, requestId: randomUUID() })
  const preview = await security.preview({ actor, sessionToken, operationType: 'verification_review', targets: [{ target_type: 'verification_request', target_id: request.verification_id }],
    expectedVersions: { verification_request: request.version, work_item: claim.version }, proposedDiff: { status: 'verified' }, reasonCode: 'verification_approved', claimToken: claim.claim_token,
    expectedConflictPrincipalVersion: null, requestId: randomUUID() })
  const confirm = await security.confirm({ actor, sessionToken, previewToken: preview.preview_token, confirmationSummaryHash: preview.confirmation_summary_hash,
    confirmRequestId: randomUUID(), reauthGrantId: null, expectedConflictPrincipalVersion: null, requestId: randomUUID() })
  return () => decisions.decideReview({ actor, sessionToken, workItemId, previewToken: preview.preview_token, claimToken: claim.claim_token, confirmToken: confirm.confirm_token,
    decision: 'approve', reasonCode: 'verification_approved', fieldPaths: [], decisionEvidenceRefs: [], expectedVersion: claim.version, decisionRequestId: randomUUID(), requestId: randomUUID(),
    decisionPayload: { author_role: 'owner', field_permissions: ['/project_core/current_name'], policy_version: 'creator_link.v1', expected_creator_aggregate_version: null, expected_owner_link_set_version: null, expected_reused_link_version: null } })
}

try {
  await pool.query(`INSERT INTO iam.users(user_id,status,created_at,updated_at) SELECT value,'active',$2,$2 FROM unnest($1::uuid[]) value`, [users, now])
  await pool.query(`INSERT INTO iam.sessions(session_id_hash,user_id,anonymous_subject_id,csrf_token_hash,roles_version,status,recent_auth_at,expires_at,created_at)
    VALUES($1,$2,$3,$4,1,'active',$5,$5::timestamptz+interval '1 hour',$5)`, [createHmac('sha256', authSecret).update(sessionToken).digest(), reviewerId, randomUUID(), Buffer.alloc(32, 7), now])
  const projectId = await seedProject('team')
  const otherProjectId = await seedProject('individual')
  assert.equal((await catalog.getProject(projectId)).developer?.verification_status, 'unverified')
  await assert.rejects(create(users[0]!, projectId, 'individual'), { code: 'VERIFICATION_KIND_MISMATCH' })
  const first = await create(users[0]!, projectId, 'team')
  await assert.rejects(verification.patch({ userId: users[0]!, verificationId: first.verification_id, expectedVersion: first.version,
    creatorResolutionMode: 'create_new_creator', creatorAccountLinkId: null, targetCreatorId: null, newCreatorProfileInput: { display_name: 'No kind' },
    requestedLinkRole: 'owner', method: null, publicSummary: null, operationId: randomUUID() }), { code: 'NEW_CREATOR_PROFILE_INVALID' })
  assert.equal((await accounts.list({ userId: users[0]!, limit: 20, cursor: null, projectId })).items[0]?.can_manage, false)
  assert.equal((await authorization.resolveProjectAuthorization({ userId: users[0]!, projectId })).grants.length, 0)
  const second = await create(users[1]!, projectId, 'team')
  const pending = await Promise.all([submit(users[0]!, first), submit(users[1]!, second)])
  const firstItem = await pool.query<{ review_work_item_id: string }>('SELECT review_work_item_id FROM workflow.verification_requests WHERE verification_id=$1', [pending[0]!.verification_id])
  await assert.rejects(workflow.claimWorkItem({ actor: { ...actor, userId: users[0]! }, workItemId: firstItem.rows[0]!.review_work_item_id, expectedVersion: 1,
    expectedConflictPrincipalVersion: null, requestId: randomUUID() }), { code: 'CONFLICT_OF_INTEREST' })
  const approvals = await Promise.all(pending.map(prepareApproval))
  const outcomes = await Promise.allSettled(approvals.map(approve => approve()))
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.equal(rejected.reason.code, 'PROJECT_DEVELOPER_ALREADY_CLAIMED')
  const winnerIndex = outcomes.findIndex(result => result.status === 'fulfilled')
  const winner = users[winnerIndex]!, loser = users[1 - winnerIndex]!
  const verified = await catalog.getProject(projectId)
  assert.equal(verified.developer?.verification_status, 'verified')
  assert.equal(verified.developer?.kind, 'team')
  assert.equal('applicant_user_id' in verified.developer!, false)
  assert.equal((await accounts.list({ userId: winner, limit: 20, cursor: null, projectId })).items[0]?.can_manage, true)
  assert.equal((await accounts.list({ userId: loser, limit: 20, cursor: null, projectId })).items[0]?.can_manage, false)
  assert.equal((await accounts.list({ userId: reviewerId, limit: 20, cursor: null, projectId })).items.length, 0)
  assert.equal((await authorization.resolveProjectAuthorization({ userId: loser, projectId })).grants.length, 0)
  await create(winner, otherProjectId, 'individual')
  const page = await accounts.list({ userId: winner, limit: 1, cursor: null, projectId: null })
  assert.ok(page.next_cursor)
  const next = await accounts.list({ userId: winner, limit: 1, cursor: page.next_cursor, projectId: null })
  assert.equal(next.items.length, 1)
  assert.notEqual(page.items[0]?.project_id, next.items[0]?.project_id)
  await assert.rejects(accounts.list({ userId: loser, limit: 1, cursor: page.next_cursor, projectId: null }), { code: 'CURSOR_INVALID' })
  await assert.rejects(create(reviewerId, projectId, 'team'), { code: 'PROJECT_DEVELOPER_ALREADY_CLAIMED' })
  const pointer = await pool.query<{ primary_developer_relation_id: string }>('SELECT primary_developer_relation_id FROM catalog.projects WHERE project_id=$1', [projectId])
  await assert.rejects(pool.query('UPDATE catalog.projects SET primary_developer_relation_id=$2 WHERE project_id=$1', [otherProjectId, pointer.rows[0]!.primary_developer_relation_id]), /project_primary_developer_relation_fk/)
  await pool.query(`UPDATE catalog.author_relations SET status='suspended',version=version+1,updated_at=updated_at+interval '1 microsecond' WHERE author_relation_id=$1`, [pointer.rows[0]!.primary_developer_relation_id])
  assert.equal((await catalog.getProject(projectId)).developer?.verification_status, 'disputed')
  assert.equal((await accounts.list({ userId: winner, limit: 20, cursor: null, projectId })).items[0]?.can_manage, false)
  assert.equal((await authorization.resolveProjectAuthorization({ userId: winner, projectId })).grants.length, 0)
  console.info('developer_identity_v1_ok real_postgres=true concurrent_owner=true private_projection=true permission_revocation=true')
} finally { await pool.end() }
