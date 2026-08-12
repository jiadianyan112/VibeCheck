import assert from 'node:assert/strict'

import pg from 'pg'

import { CommunityError } from '../errors.js'
import { PostgresCommunityStore } from '../postgres-store.js'
import { CommunityService } from '../service.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const service = new CommunityService({
  store: new PostgresCommunityStore(pool),
  now: () => new Date('2026-08-13T08:00:00.000Z'),
})
const userId = '71000000-0000-4000-8000-000000000001'
const projectId = '10000000-0000-4000-8000-000000000001'

async function run(): Promise<void> {
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',now(),now()) ON CONFLICT (user_id) DO UPDATE SET status='active'`,
    [userId],
  )
  await pool.query(
    `DELETE FROM community.interaction_operation_receipts WHERE user_id=$1;
     DELETE FROM community.project_interactions WHERE user_id=$1 AND project_id=$2;
     UPDATE catalog.project_interaction_counters
     SET favorite_count=0,like_count=0,follower_count=0,source_watermark='community-fixture-reset'
     WHERE project_id=$2;
     DELETE FROM ops.outbox_events
     WHERE aggregate_type='project' AND aggregate_id=$2::text
       AND event_name IN ('project_favorited','project_liked','project_followed')`,
    [userId, projectId],
  )

  const follow = await service.setProjectInteraction({
    userId,
    projectId,
    targetType: 'project',
    interactionType: 'follow',
    state: true,
    clientRequestId: 'community_follow_0001',
  })
  assert.equal(follow.result, 'changed')
  assert.deepEqual(follow.states, { favorite: true, like: false, follow: true })
  assert.deepEqual(follow.counts, { favorite_count: 1, like_count: 0, follower_count: 1 })
  assert.deepEqual(follow.count_deltas, { favorite_count: 1, like_count: 0, follower_count: 1 })
  assert.deepEqual(follow.change_sources, {
    favorite: 'follow_cascade', like: null, follow: 'explicit',
  })

  const retried = await service.setProjectInteraction({
    userId,
    projectId,
    targetType: 'project',
    interactionType: 'follow',
    state: true,
    clientRequestId: 'community_follow_0001',
  })
  assert.deepEqual(retried, follow)
  const afterRetry = await pool.query<{
    favorite_count: string
    follower_count: string
    event_count: number
  }>(
    `SELECT counter.favorite_count::text,counter.follower_count::text,
       (SELECT count(*)::int FROM ops.outbox_events
        WHERE aggregate_type='project' AND aggregate_id=$1::text
          AND event_name IN ('project_favorited','project_followed')) AS event_count
     FROM catalog.project_interaction_counters counter WHERE project_id=$1`,
    [projectId],
  )
  assert.deepEqual(afterRetry.rows[0], {
    favorite_count: '1', follower_count: '1', event_count: 2,
  })

  await assert.rejects(
    () => service.setProjectInteraction({
      userId,
      projectId,
      targetType: 'project',
      interactionType: 'follow',
      state: false,
      clientRequestId: 'community_follow_0001',
    }),
    (error: unknown) => error instanceof CommunityError &&
      error.code === 'CLIENT_REQUEST_ID_REUSED' && error.httpStatus === 409,
  )

  const unfavorite = await service.setProjectInteraction({
    userId,
    projectId,
    targetType: 'project',
    interactionType: 'favorite',
    state: false,
    clientRequestId: 'community_favorite_0002',
  })
  assert.deepEqual(unfavorite.states, { favorite: false, like: false, follow: false })
  assert.deepEqual(unfavorite.count_deltas, {
    favorite_count: -1, like_count: 0, follower_count: -1,
  })
  assert.deepEqual(unfavorite.change_sources, {
    favorite: 'explicit', like: null, follow: 'favorite_cascade',
  })

  const [likeA, likeB] = await Promise.all([
    service.setProjectInteraction({
      userId,
      projectId,
      targetType: 'project',
      interactionType: 'like',
      state: true,
      clientRequestId: 'community_like_0003',
    }),
    service.setProjectInteraction({
      userId,
      projectId,
      targetType: 'project',
      interactionType: 'like',
      state: true,
      clientRequestId: 'community_like_0004',
    }),
  ])
  assert.deepEqual(new Set([likeA.result, likeB.result]), new Set(['changed', 'no_change']))
  assert.equal(likeA.counts.like_count, 1)
  assert.equal(likeB.counts.like_count, 1)

  const eventState = await pool.query<{
    interaction_count: number
    receipt_count: number
    event_count: number
    natural_actor_leak_count: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM community.project_interactions
        WHERE user_id=$1 AND project_id=$2 AND state=true) AS interaction_count,
       (SELECT count(*)::int FROM community.interaction_operation_receipts
        WHERE user_id=$1) AS receipt_count,
       (SELECT count(*)::int FROM ops.outbox_events
        WHERE aggregate_type='project' AND aggregate_id=$2::text
          AND event_name IN ('project_favorited','project_liked','project_followed')) AS event_count,
       (SELECT count(*)::int FROM ops.outbox_events
        WHERE aggregate_type='project' AND aggregate_id=$2::text
          AND (payload_json ? 'user_id' OR payload_json ? 'subject_id')) AS natural_actor_leak_count`,
    [userId, projectId],
  )
  assert.deepEqual(eventState.rows[0], {
    interaction_count: 1,
    receipt_count: 4,
    event_count: 5,
    natural_actor_leak_count: 0,
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO community.project_interactions (
         user_id,project_id,interaction_type,state,client_request_id
       ) VALUES ($1,$2,'follow',true,'direct_invalid_follow')
       ON CONFLICT (user_id,project_id,interaction_type) DO UPDATE SET state=true`,
      [userId, projectId],
    )
    await client.query(
      `INSERT INTO community.project_interactions (
         user_id,project_id,interaction_type,state,client_request_id
       ) VALUES ($1,$2,'favorite',false,'direct_invalid_favorite')
       ON CONFLICT (user_id,project_id,interaction_type) DO UPDATE SET state=false`,
      [userId, projectId],
    )
    await assert.rejects(() => client.query('COMMIT'), /FOLLOW_REQUIRES_FAVORITE/)
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}

try {
  await run()
  process.stdout.write('community_fixture_ok interactions=1 receipts=4 events=5\n')
} finally {
  await pool.end()
}
