import assert from 'node:assert/strict'

import { PostgresUpdatedProjectIndexer } from '@vibecheck/catalog'
import { PostgresNotificationStore } from '@vibecheck/community'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const projectId = '10000000-0000-4000-8000-000000000001'
const updateId = '95000000-0000-4000-8000-000000000001'
const followerId = '51000000-0000-4000-8000-000000000002'
const projectedAt = new Date('2026-08-13T15:10:00.000Z')

async function run(): Promise<void> {
  const source = await pool.query<{
    readonly version_id: string
    readonly review_decision_id: string
    readonly event_id: string
  }>(
    `SELECT version_id,review_decision_id,event_id
     FROM workflow.project_update_application_receipts
     WHERE update_id=$1 AND project_id=$2`,
    [updateId, projectId],
  )
  assert.ok(source.rows[0])
  const command = {
    projectId,
    versionId: source.rows[0]!.version_id,
    updateId,
    reviewDecisionId: source.rows[0]!.review_decision_id,
    eventId: source.rows[0]!.event_id,
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
       `INSERT INTO community.project_interactions (
         user_id,project_id,interaction_type,state,client_request_id,created_at,updated_at
       ) VALUES ($1,$2,'favorite',true,'updated-projection-favorite',$3,$3)
       ON CONFLICT (user_id,project_id,interaction_type) DO UPDATE
         SET state=true,client_request_id=EXCLUDED.client_request_id,updated_at=$3`,
      [followerId, projectId, projectedAt],
    )
    await client.query(
       `INSERT INTO community.project_interactions (
         user_id,project_id,interaction_type,state,client_request_id,created_at,updated_at
       ) VALUES ($1,$2,'follow',true,'updated-projection-follow',$3,$3)
       ON CONFLICT (user_id,project_id,interaction_type) DO UPDATE
         SET state=true,client_request_id=EXCLUDED.client_request_id,updated_at=$3`,
      [followerId, projectId, projectedAt],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }

  const indexer = new PostgresUpdatedProjectIndexer(pool, () => projectedAt)
  const notifier = new PostgresNotificationStore(pool)
  const indexed = await indexer.indexUpdatedProject(command)
  assert.ok(['indexed', 'already_current'].includes(indexed.index_status))
  assert.equal(indexed.version_id, command.versionId)
  const inserted = await notifier.createProjectUpdatedNotifications({ ...command, now: projectedAt })
  assert.ok(inserted === 0 || inserted === 1)
  const replayIndex = await indexer.indexUpdatedProject(command)
  assert.equal(replayIndex.index_status, 'already_current')
  assert.equal(await notifier.createProjectUpdatedNotifications({ ...command, now: projectedAt }), 0)

  const verified = await pool.query<{
    readonly indexed_version_id: string
    readonly search_contains_name: boolean
    readonly notification_count: number
    readonly unread_count: number
    readonly notification_type: string
    readonly event_id: string
  }>(
    `SELECT document.version_id AS indexed_version_id,
       position('Reviewed update' in document.search_text)>0 AS search_contains_name,
       (SELECT count(*)::int FROM community.notifications notification
        WHERE notification.recipient_user_id=$2 AND notification.target_id=$1
          AND notification.dedup_key=$3) AS notification_count,
       (SELECT count(*)::int FROM community.notifications notification
        WHERE notification.recipient_user_id=$2 AND notification.target_id=$1
          AND notification.dedup_key=$3 AND notification.read_at IS NULL) AS unread_count,
       notification.notification_type,notification.event_id
     FROM search.project_documents document
     JOIN community.notifications notification ON notification.recipient_user_id=$2
       AND notification.target_id=$1 AND notification.dedup_key=$3
     WHERE document.project_id=$1`,
    [projectId, followerId, `project_updated:${updateId}`],
  )
  assert.deepEqual(verified.rows[0], {
    indexed_version_id: command.versionId,
    search_contains_name: true,
    notification_count: 1,
    unread_count: 1,
    notification_type: 'project_updated',
    event_id: command.eventId,
  })
}

try {
  await run()
  process.stdout.write('project_updated_projection_fixture_ok search=current notifications=recipient_isolated replay=idempotent\n')
} finally {
  await pool.end()
}
