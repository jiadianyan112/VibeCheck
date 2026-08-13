import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresVerificationRequestStore } from '../verification-request-store.js'
import { VerificationRequestService } from '../verification-request-service.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')

const pool = new pg.Pool({ connectionString: databaseUrl })
const now = new Date('2026-08-13T16:00:00.000Z')
const applicantId = '52000000-0000-4000-8000-000000000001'
const otherUserId = '52000000-0000-4000-8000-000000000002'

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$3,$3),($2,'active',$3,$3)
     ON CONFLICT (user_id) DO NOTHING`,
    [applicantId, otherUserId, now],
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
  assert.equal(created.provisional_link_policy.allowed_permission_profile_refs[0]?.profile_id, 'OWNER_V1')
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
  console.info(JSON.stringify({
    verification_id: created.verification_id,
    status: patched.status,
    version: patched.version,
    idempotent: true,
    public_fact_writes: 0,
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
