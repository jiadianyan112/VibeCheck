import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresAuthorAuthorizationResolver } from '../author-authorization.js'
import { CatalogError } from '../errors.js'
import { ProjectUpdateService } from '../project-update-service.js'
import { PostgresProjectUpdateStore } from '../project-update-store.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const pool = new Pool({ connectionString: databaseUrl })

const userId = '51000000-0000-4000-8000-000000000001'
const projectId = '10000000-0000-4000-8000-000000000001'
const versionId = '11000000-0000-4000-8000-000000000001'

async function run(): Promise<void> {
  await pool.query(
    `UPDATE catalog.projects SET review_status='published_author',updated_at=updated_at
     WHERE project_id=$1`,
    [projectId],
  )
  const service = new ProjectUpdateService({
    store: new PostgresProjectUpdateStore(pool),
    authorization: new PostgresAuthorAuthorizationResolver(pool),
    now: () => new Date('2026-08-13T00:00:00.000Z'),
  })
  const created = await service.create({
    userId,
    projectId,
    baseVersionId: versionId,
    updateType: 'description',
    clientRequestId: 'project-update-fixture-create-v1',
  })
  assert.equal(created.status, 'editing')
  assert.equal(created.current_version_id, versionId)
  const patched = await service.patch({
    userId,
    updateId: created.update_id,
    expectedVersion: created.version,
    diff: [{ field_path: '/project_core/current_name', after_value: 'Recall Garden Next' }],
    evidenceDraftIds: [],
    mediaReferenceIds: [],
    operationId: 'project-update-fixture-patch-v1',
  })
  assert.equal(patched.version, created.version + 1)
  assert.equal(patched.before_after[0]?.before_value, 'Recall Garden')
  const replay = await service.patch({
    userId,
    updateId: created.update_id,
    expectedVersion: created.version,
    diff: [{ field_path: '/project_core/current_name', after_value: 'Recall Garden Next' }],
    evidenceDraftIds: [],
    mediaReferenceIds: [],
    operationId: 'project-update-fixture-patch-v1',
  })
  assert.equal(replay.version, patched.version)
  await assert.rejects(
    () => service.patch({
      userId,
      updateId: created.update_id,
      expectedVersion: patched.version,
      diff: [{ field_path: '/project_core/public_url', after_value: 'https://changed.example.test' }],
      evidenceDraftIds: [],
      mediaReferenceIds: [],
      operationId: 'project-update-fixture-forbidden-v1',
    }),
    (error: unknown) => error instanceof CatalogError &&
      error.code === 'AUTHOR_CAPABILITY_FORBIDDEN' && error.httpStatus === 403,
  )
  const publicFact = await pool.query<{ current_name: string; current_version_id: string }>(
    `SELECT current_name,current_version_id FROM catalog.projects WHERE project_id=$1`,
    [projectId],
  )
  assert.equal(publicFact.rows[0]?.current_name, 'Recall Garden')
  assert.equal(publicFact.rows[0]?.current_version_id, versionId)
  const preview = await service.preview({
    userId,
    updateId: created.update_id,
    expectedVersion: patched.version,
  })
  const submitted = await service.submit({
    userId,
    updateId: created.update_id,
    version: patched.version,
    previewHash: preview.preview_hash,
    submissionKey: 'project-update-fixture-submit-v1',
  })
  assert.equal(submitted.work_item_status, 'queued')
  const queueShape = await pool.query<{ work_type: string; target_type: string; principal_count: number }>(
    `SELECT item.work_type,item.target_type,
       (SELECT count(*)::int FROM workflow.review_work_item_conflict_principals principal
         WHERE principal.work_item_id=item.work_item_id AND principal.principal_user_id=$2
           AND principal.revoked_at IS NULL) AS principal_count
     FROM workflow.review_work_items item WHERE item.work_item_id=$1`,
    [submitted.review_work_item_id, userId],
  )
  assert.deepEqual(queueShape.rows[0], {
    work_type: 'project_update', target_type: 'project_update', principal_count: 1,
  })
  const withdrawn = await service.withdraw({
    userId,
    updateId: created.update_id,
    expectedVersion: submitted.version,
    operationId: 'project-update-fixture-withdraw-v1',
    reasonCode: 'fixture_owner_cancelled',
  })
  assert.equal(withdrawn.work_item_status, 'cancelled')
  const finalPublicFact = await pool.query<{ current_name: string; current_version_id: string }>(
    `SELECT current_name,current_version_id FROM catalog.projects WHERE project_id=$1`, [projectId],
  )
  assert.deepEqual(finalPublicFact.rows[0], publicFact.rows[0])
}

try {
  await run()
  process.stdout.write('project_update_review_entry_fixture_ok submit=queued withdraw=cancelled public_fact_unchanged=ok\n')
} finally {
  await pool.end()
}
