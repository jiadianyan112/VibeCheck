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
const followerId = '97000000-0000-4000-8000-000000000001'
const lateFollowerId = '97000000-0000-4000-8000-000000000002'

async function prepareFollowHistory(eventAt: Date, afterEvent: Date): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM community.project_interactions
       WHERE user_id=ANY($1::uuid[]) AND project_id=$2 AND interaction_type='follow'`,
      [[followerId, lateFollowerId], projectId],
    )
    await client.query(
      `DELETE FROM community.project_interactions
       WHERE user_id=ANY($1::uuid[]) AND project_id=$2 AND interaction_type='favorite'`,
      [[followerId, lateFollowerId], projectId],
    )
    await client.query(
      `DELETE FROM community.project_follow_history
       WHERE user_id=ANY($1::uuid[]) AND project_id=$2`,
      [[followerId, lateFollowerId], projectId],
    )
    await client.query(
      `INSERT INTO iam.users (user_id,status,privacy_state,created_at,updated_at)
       VALUES ($1,'active','active',$3,$3),($2,'active','active',$3,$3)
       ON CONFLICT (user_id) DO UPDATE SET status='active',privacy_state='active',updated_at=EXCLUDED.updated_at`,
      [followerId, lateFollowerId, eventAt],
    )
    await client.query(
      `INSERT INTO community.project_interactions (
         user_id,project_id,interaction_type,state,client_request_id,created_at,updated_at
       ) VALUES ($1,$3,'favorite',true,'updated-projection-favorite',$2,$2),
                ($1,$3,'follow',true,'updated-projection-follow',$2,$2)`,
      [followerId, eventAt, projectId],
    )
    await client.query(
      `UPDATE community.project_interactions
       SET state=false,client_request_id='updated-projection-follow-off',updated_at=$2
       WHERE user_id=$1 AND project_id=$3 AND interaction_type='follow'`,
      [followerId, afterEvent, projectId],
    )
    await client.query(
      `UPDATE community.project_interactions
       SET state=false,client_request_id='updated-projection-favorite-off',updated_at=$2
       WHERE user_id=$1 AND project_id=$3 AND interaction_type='favorite'`,
      [followerId, afterEvent, projectId],
    )
    await client.query(
      `INSERT INTO community.project_interactions (
         user_id,project_id,interaction_type,state,client_request_id,created_at,updated_at
       ) VALUES ($1,$3,'favorite',true,'updated-projection-late-favorite',$2,$2),
                ($1,$3,'follow',true,'updated-projection-late-follow',$2,$2)`,
      [lateFollowerId, afterEvent, projectId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function cleanupFollowHistory(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM community.project_interactions
       WHERE user_id=ANY($1::uuid[]) AND project_id=$2 AND interaction_type='follow'`,
      [[followerId, lateFollowerId], projectId],
    )
    await client.query(
      `DELETE FROM community.project_interactions
       WHERE user_id=ANY($1::uuid[]) AND project_id=$2 AND interaction_type='favorite'`,
      [[followerId, lateFollowerId], projectId],
    )
    await client.query(
      `DELETE FROM community.project_follow_history
       WHERE user_id=ANY($1::uuid[]) AND project_id=$2`,
      [[followerId, lateFollowerId], projectId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function run(): Promise<void> {
  const source = await pool.query<{
    readonly version_id: string
    readonly review_decision_id: string
    readonly event_id: string
    readonly event_created_at: Date
  }>(
    `SELECT receipt.version_id,receipt.review_decision_id,receipt.event_id,event.created_at AS event_created_at
     FROM workflow.project_update_application_receipts receipt
     JOIN catalog.events event ON event.event_id=receipt.event_id
     WHERE receipt.update_id=$1 AND receipt.project_id=$2`,
    [updateId, projectId],
  )
  assert.ok(source.rows[0])
  const eventAt = source.rows[0]!.event_created_at
  const consumerAt = new Date(eventAt.getTime() + 60_000)
  const command = {
    projectId,
    versionId: source.rows[0]!.version_id,
    updateId,
    reviewDecisionId: source.rows[0]!.review_decision_id,
    eventId: source.rows[0]!.event_id,
  }

  await prepareFollowHistory(eventAt, consumerAt)
  let cleanupNeeded = true
  try {
    const indexer = new PostgresUpdatedProjectIndexer(pool, () => consumerAt)
    const notifier = new PostgresNotificationStore(pool)
    const indexed = await indexer.indexUpdatedProject(command)
    assert.ok(['indexed', 'already_current'].includes(indexed.index_status))
    assert.equal(indexed.version_id, command.versionId)
    const inserted = await notifier.createProjectUpdatedNotifications({ ...command, now: consumerAt })
    assert.ok(inserted === 0 || inserted === 1)
    const replayIndex = await indexer.indexUpdatedProject(command)
    assert.equal(replayIndex.index_status, 'already_current')
    assert.equal(await notifier.createProjectUpdatedNotifications({ ...command, now: consumerAt }), 0)

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

    const recipientCounts = await pool.query<{
      readonly recipient_user_id: string
      readonly notification_count: number
    }>(
      `SELECT recipient_user_id,count(*)::int AS notification_count
       FROM community.notifications
       WHERE target_id=$1 AND dedup_key=$2
         AND recipient_user_id=ANY($3::uuid[])
       GROUP BY recipient_user_id ORDER BY recipient_user_id`,
      [projectId, `project_updated:${updateId}`, [followerId, lateFollowerId]],
    )
    assert.deepEqual(recipientCounts.rows, [{
      recipient_user_id: followerId,
      notification_count: 1,
    }])

    const history = await pool.query<{
      readonly user_id: string
      readonly state: boolean
      readonly changed_at: Date
    }>(
      `SELECT DISTINCT ON (user_id) user_id,state,changed_at
       FROM community.project_follow_history
       WHERE project_id=$1 AND user_id=ANY($2::uuid[])
       ORDER BY user_id,changed_at DESC,change_id DESC`,
      [projectId, [followerId, lateFollowerId]],
    )
    assert.deepEqual(
      history.rows
        .sort((left, right) => left.user_id.localeCompare(right.user_id))
        .map((row) => ({ user_id: row.user_id, state: row.state, after_event: row.changed_at > eventAt })),
      [
        { user_id: followerId, state: false, after_event: true },
        { user_id: lateFollowerId, state: true, after_event: true },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
    )
  } finally {
    if (cleanupNeeded) {
      await cleanupFollowHistory()
      cleanupNeeded = false
    }
  }
}

try {
  await run()
  process.stdout.write('project_updated_projection_fixture_ok search=current notifications=recipient_isolated replay=idempotent\n')
} finally {
  await pool.end()
}
