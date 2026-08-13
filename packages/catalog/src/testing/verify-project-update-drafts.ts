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
}

try {
  await run()
  process.stdout.write('project_update_draft_fixture_ok create=1 patch_replay=ok public_fact_unchanged=ok\n')
} finally {
  await pool.end()
}
