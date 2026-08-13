import assert from 'node:assert/strict'

import pg from 'pg'

import { SubmissionError } from '../errors.js'
import { PostgresSubmissionStore } from '../postgres-store.js'
import { SubmissionService } from '../service.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const userId = '82000000-0000-4000-8000-000000000001'
const fixtureUrl = 'https://submission-fixture.example/work'
const now = new Date('2026-08-13T10:00:00.000Z')
const service = new SubmissionService({
  store: new PostgresSubmissionStore(pool),
  urlSafetyResolver: Object.freeze({
    async resolve(rawUrl: string) {
      return Object.freeze({
        result: 'allowed' as const,
        safeWebUrl: rawUrl,
        redirectChain: Object.freeze([rawUrl]),
        reasonCode: null,
        httpStatusCode: 200,
      })
    },
  }),
  config: Object.freeze({
    enabled: true,
    urlCheckTtlSeconds: 1_800,
    draftTtlSeconds: 2_592_000,
  }),
  now: () => now,
})

async function run(): Promise<void> {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',now(),now()) ON CONFLICT (user_id) DO UPDATE SET status='active'`,
    [userId],
  )
  await cleanup()

  const checked = await service.checkUrl({
    userId,
    rawUrl: `${fixtureUrl}/#section`,
    categoryHint: 'personal_site_portfolio',
    clientRequestId: 'submission-fixture-check-0001',
    requestId: 'fixture-http-check-0001',
  })
  assert.equal(checked.canonical_url, fixtureUrl)
  assert.equal(checked.can_create_draft, true)
  assert.equal(checked.duplicate_result, 'none')
  const checkReplay = await service.checkUrl({
    userId,
    rawUrl: `${fixtureUrl}/#section`,
    categoryHint: 'personal_site_portfolio',
    clientRequestId: 'submission-fixture-check-0001',
    requestId: 'fixture-http-check-0002',
  })
  assert.deepEqual(checkReplay, checked)

  const draft = await service.createDraft({
    userId,
    checkId: checked.check_id,
    categoryId: 'personal_site_portfolio',
    clientRequestId: 'submission-fixture-draft-0001',
    requestId: 'fixture-http-draft-0001',
  })
  assert.equal(draft.status, 'editing')
  assert.equal(draft.version, 1)
  assert.deepEqual(draft.payload_snapshot, {
    project_core: { public_url: fixtureUrl },
    category_id: 'personal_site_portfolio',
    category_schema_version: 'portfolio.v1',
    category_data: {},
  })
  const draftReplay = await service.createDraft({
    userId,
    checkId: checked.check_id,
    categoryId: 'personal_site_portfolio',
    clientRequestId: 'submission-fixture-draft-0001',
    requestId: 'fixture-http-draft-0002',
  })
  assert.deepEqual(draftReplay, draft)

  const patched = await service.patchDraft({
    userId,
    draftId: draft.draft_id,
    expectedVersion: 1,
    patch: Object.freeze({
      project_core: Object.freeze({
        current_name: 'Submission Fixture',
        one_line_definition: 'A fixture that never becomes a public project.',
      }),
      category_data: Object.freeze({ site_type: 'portfolio' }),
    }),
    operationId: 'submission-fixture-patch-0001',
    requestId: 'fixture-http-patch-0001',
  })
  assert.equal(patched.version, 2)
  assert.deepEqual(patched.payload_snapshot.project_core, {
    public_url: fixtureUrl,
    current_name: 'Submission Fixture',
    one_line_definition: 'A fixture that never becomes a public project.',
  })
  const patchReplay = await service.patchDraft({
    userId,
    draftId: draft.draft_id,
    expectedVersion: 1,
    patch: Object.freeze({
      project_core: Object.freeze({
        current_name: 'Submission Fixture',
        one_line_definition: 'A fixture that never becomes a public project.',
      }),
      category_data: Object.freeze({ site_type: 'portfolio' }),
    }),
    operationId: 'submission-fixture-patch-0001',
    requestId: 'fixture-http-patch-replay',
  })
  assert.deepEqual(patchReplay, patched)
  await assert.rejects(
    () => service.patchDraft({
      userId,
      draftId: draft.draft_id,
      expectedVersion: 1,
      patch: Object.freeze({ project_core: Object.freeze({ current_name: 'Stale' }) }),
      operationId: 'submission-fixture-patch-0002',
      requestId: 'fixture-http-patch-stale',
    }),
    (error: unknown) => error instanceof SubmissionError &&
      error.code === 'SUBMISSION_DRAFT_VERSION_CONFLICT' && error.httpStatus === 409,
  )
  await assert.rejects(
    () => service.patchDraft({
      userId,
      draftId: draft.draft_id,
      expectedVersion: 2,
      patch: Object.freeze({ project_core: Object.freeze({ public_url: 'https://changed.example' }) }),
      operationId: 'submission-fixture-patch-0003',
      requestId: 'fixture-http-patch-url',
    }),
    (error: unknown) => error instanceof SubmissionError &&
      error.code === 'DRAFT_PUBLIC_URL_IMMUTABLE' && error.httpStatus === 422,
  )

  const publicCount = await pool.query<{ readonly count: number }>(
    `SELECT count(*)::int AS count FROM catalog.projects
     WHERE canonical_url_hash=digest($1,'sha256')`,
    [fixtureUrl],
  )
  assert.equal(publicCount.rows[0]?.count, 0)
  await pool.query(
    `UPDATE workflow.submission_drafts SET status='submitted',version=version+1
     WHERE draft_id=$1`,
    [draft.draft_id],
  )
  await assert.rejects(
    () => pool.query(
      `UPDATE workflow.submission_drafts SET status='editing',version=version+1
       WHERE draft_id=$1`,
      [draft.draft_id],
    ),
    /SUBMISSION_DRAFT_REOPEN_FORBIDDEN|SUBMISSION_DRAFT_SUBMITTED_IMMUTABLE/,
  )

  const existingProject = await pool.query<{
    readonly canonical_public_url: string
    readonly project_id: string
  }>(
    `SELECT canonical_public_url,project_id FROM catalog.projects
     WHERE review_status<>'deleted' AND category_id='personal_site_portfolio'
     ORDER BY project_id LIMIT 1`,
  )
  assert.ok(existingProject.rows[0])
  const duplicate = await service.checkUrl({
    userId,
    rawUrl: existingProject.rows[0]!.canonical_public_url,
    categoryHint: 'personal_site_portfolio',
    clientRequestId: 'submission-fixture-check-duplicate',
    requestId: 'fixture-http-check-duplicate',
  })
  assert.equal(duplicate.duplicate_result, 'exact')
  assert.equal(duplicate.can_create_draft, false)
  assert.equal(duplicate.duplicate_candidates[0]?.project_id, existingProject.rows[0]!.project_id)

  console.info(JSON.stringify({
    fixture: 'submission-entry-and-drafts',
    status: 'ok',
    check_id: checked.check_id,
    draft_id: draft.draft_id,
  }))
}

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM workflow.submission_draft_operation_receipts
     WHERE draft_id IN (SELECT draft_id FROM workflow.submission_drafts WHERE owner_user_id=$1)`,
    [userId],
  )
  await pool.query(`DELETE FROM workflow.submission_drafts WHERE owner_user_id=$1`, [userId])
  await pool.query(`DELETE FROM workflow.submission_url_check_receipts WHERE owner_user_id=$1`, [userId])
  await pool.query(`DELETE FROM workflow.submission_url_checks WHERE owner_user_id=$1`, [userId])
}

await run().finally(async () => pool.end())
