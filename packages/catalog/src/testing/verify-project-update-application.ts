import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresProjectUpdateApplier } from '../project-update-application.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const updateId = '95000000-0000-4000-8000-000000000001'
const projectId = '10000000-0000-4000-8000-000000000001'
const baseVersionId = '11000000-0000-4000-8000-000000000001'
const appliedAt = new Date('2026-08-13T15:05:00.000Z')

async function run(): Promise<void> {
  const decision = await pool.query<{ readonly review_decision_id: string }>(
    `SELECT review_decision_id FROM workflow.review_decisions
     WHERE target_type='project_update' AND target_id=$1 AND decision='approve'`,
    [updateId],
  )
  const reviewDecisionId = decision.rows[0]?.review_decision_id
  assert.ok(reviewDecisionId)

  const before = await pool.query<{
    readonly current_version_id: string
    readonly current_name: string
    readonly version_count: number
  }>(
    `SELECT project.current_version_id,project.current_name,
       (SELECT count(*)::int FROM catalog.project_versions version
        WHERE version.project_id=project.project_id) AS version_count
     FROM catalog.projects project WHERE project.project_id=$1`,
    [projectId],
  )
  assert.deepEqual(before.rows[0], {
    current_version_id: baseVersionId,
    current_name: 'Recall Garden',
    version_count: 1,
  })

  const applier = new PostgresProjectUpdateApplier(pool, () => appliedAt)
  const applied = await applier.applyApprovedUpdate(updateId, reviewDecisionId)
  assert.equal(applied.project_id, projectId)
  assert.equal(applied.base_version_id, baseVersionId)
  assert.equal(applied.applied_at, appliedAt.toISOString())

  const replay = await applier.applyApprovedUpdate(updateId, reviewDecisionId)
  assert.deepEqual(replay, applied)
  await assert.rejects(
    () => applier.applyApprovedUpdate(updateId, '95000000-0000-4000-8000-000000000099'),
    /PROJECT_UPDATE_APPLICATION_DECISION_CONFLICT/,
  )

  const verified = await pool.query<{
    readonly current_version_id: string
    readonly current_name: string
    readonly update_status: string
    readonly apply_attempt_count: number
    readonly previous_version_id: string
    readonly source_decision_type: string
    readonly source_decision_id: string
    readonly event_type: string
    readonly source_actor: string
    readonly source_object_type: string
    readonly outbox_count: number
    readonly outbox_event_version: number
    readonly outbox_source_type: string
    readonly outbox_initiator_type: string
    readonly outbox_update_type: string
    readonly receipt_count: number
    readonly version_count: number
  }>(
    `SELECT project.current_version_id,project.current_name,update.status AS update_status,
       update.apply_attempt_count,version.previous_version_id,version.source_decision_type,
       version.source_decision_id,event.event_type,event.source_actor,event.source_object_type,
       (SELECT count(*)::int FROM ops.outbox_events outbox
        WHERE outbox.aggregate_type='project' AND outbox.aggregate_id=project.project_id::text
          AND outbox.event_name='project_updated'
          AND outbox.payload_json->>'update_id'=update.update_id::text) AS outbox_count,
       outbox.event_version AS outbox_event_version,
       outbox.payload_json->>'source_type' AS outbox_source_type,
       outbox.payload_json->>'initiator_type' AS outbox_initiator_type,
       outbox.payload_json->>'update_type' AS outbox_update_type,
       (SELECT count(*)::int FROM workflow.project_update_application_receipts receipt
        WHERE receipt.update_id=update.update_id) AS receipt_count,
       (SELECT count(*)::int FROM catalog.project_versions project_version
        WHERE project_version.project_id=project.project_id) AS version_count
     FROM catalog.project_updates update
     JOIN catalog.projects project ON project.project_id=update.project_id
     JOIN catalog.project_versions version ON version.version_id=project.current_version_id
     JOIN catalog.events event ON event.version_id=version.version_id
       AND event.source_object_type='project_update' AND event.source_object_id=update.update_id
     JOIN ops.outbox_events outbox ON outbox.aggregate_type='project'
       AND outbox.aggregate_id=project.project_id::text AND outbox.event_name='project_updated'
       AND outbox.payload_json->>'update_id'=update.update_id::text
     WHERE update.update_id=$1`,
    [updateId],
  )
  assert.deepEqual(verified.rows[0], {
    current_version_id: applied.version_id,
    current_name: 'Reviewed update',
    update_status: 'applied',
    apply_attempt_count: 1,
    previous_version_id: baseVersionId,
    source_decision_type: 'review_decision',
    source_decision_id: reviewDecisionId,
    event_type: 'version_updated',
    source_actor: 'verified_author',
    source_object_type: 'project_update',
    outbox_count: 1,
    outbox_event_version: 2,
    outbox_source_type: 'project_update',
    outbox_initiator_type: 'verified_author',
    outbox_update_type: 'author_content_update',
    receipt_count: 1,
    version_count: 2,
  })

  const base = await pool.query<{ readonly current_name: string }>(
    `SELECT snapshot_json->'project_core'->>'current_name' AS current_name
     FROM catalog.project_versions WHERE version_id=$1`,
    [baseVersionId],
  )
  assert.equal(base.rows[0]?.current_name, 'Recall Garden')
  await assert.rejects(
    () => pool.query(
      `UPDATE workflow.project_update_application_receipts SET response_json=response_json
       WHERE update_id=$1`,
      [updateId],
    ),
    /PROJECT_UPDATE_APPLICATION_RECEIPT_IMMUTABLE/,
  )
}

try {
  await run()
  process.stdout.write('project_update_application_fixture_ok version=advanced receipt=immutable replay=idempotent\n')
} finally {
  await pool.end()
}
