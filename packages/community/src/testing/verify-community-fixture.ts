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
  config: Object.freeze({
    enabled: true,
    cursorSecret: 'community-fixture-cursor-secret-at-least-thirty-two-characters',
    reportEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
    reportEncryptionKeyVersion: 'fixture-v1',
    commentPageSize: 20,
  }),
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
    `DELETE FROM community.report_operation_receipts WHERE reporter_user_id=$1`,
    [userId],
  )
  await pool.query(
    `DELETE FROM community.comment_operation_receipts
     WHERE comment_id IN (SELECT comment_id FROM community.comments WHERE author_user_id=$1)`,
    [userId],
  )
  await pool.query(
    `DELETE FROM community.comment_reports
     WHERE reporter_user_id=$1 OR comment_id IN (
       SELECT comment_id FROM community.comments WHERE author_user_id=$1
     )`,
    [userId],
  )
  await pool.query(
    `DELETE FROM workflow.review_work_items
     WHERE work_type='community' AND target_type='comment' AND target_id IN (
       SELECT comment_id FROM community.comments WHERE author_user_id=$1
     )`,
    [userId],
  )
  await pool.query(`DELETE FROM community.comments WHERE author_user_id=$1`, [userId])
  await pool.query(`DELETE FROM community.rate_limit_buckets WHERE user_id=$1`, [userId])
  await pool.query(
    `DELETE FROM community.interaction_operation_receipts WHERE user_id=$1`,
    [userId],
  )
  await pool.query(
    `DELETE FROM community.project_interactions WHERE user_id=$1 AND project_id=$2`,
    [userId, projectId],
  )
  await pool.query(
    `UPDATE catalog.project_interaction_counters
     SET favorite_count=0,like_count=0,follower_count=0,visible_comment_count=0,
       source_watermark='community-fixture-reset'
     WHERE project_id=$1`,
    [projectId],
  )
  await pool.query(
    `DELETE FROM ops.outbox_events
     WHERE (aggregate_type='project' AND aggregate_id=$1::text
       AND event_name IN ('project_favorited','project_liked','project_followed'))
       OR (aggregate_type='comment' AND payload_json->>'project_id'=$1::text)`,
    [projectId],
  )
  for (const [key, value] of [
    ['community.comment_create_rate_limit', { limit: 3, window_seconds: 60 }],
    ['community.comment_report_rate_limit', { limit: 2, window_seconds: 60 }],
  ] as const) {
    await pool.query(
      `INSERT INTO ops.config_versions (
         config_key,version,status,value_json,schema_version,content_hash,published_at
       ) VALUES ($1,1,'published',$2::jsonb,'community.rate_limit.v1',
         encode(digest($2::text,'sha256'),'hex'),$3)
       ON CONFLICT (config_key,version) DO NOTHING`,
      [key, JSON.stringify(value), '2026-08-13T07:59:00.000Z'],
    )
  }

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

  const firstComment = await service.createComment({
    userId,
    projectId,
    body: '  fixture first comment  ',
    parentCommentId: null,
    clientRequestId: 'community_comment_0001',
  })
  assert.equal(firstComment.result, 'created')
  assert.equal(firstComment.body, 'fixture first comment')
  assert.equal(firstComment.moderation_state, 'pending')
  const firstRetry = await service.createComment({
    userId,
    projectId,
    body: 'fixture first comment',
    parentCommentId: null,
    clientRequestId: 'community_comment_0001',
  })
  assert.equal(firstRetry.result, 'deduplicated')
  assert.equal(firstRetry.comment_id, firstComment.comment_id)

  const visibleFirst = await service.moderateComment({
    commentId: firstComment.comment_id,
    expectedVersion: 1,
    resultingState: 'visible',
    decisionId: '72000000-0000-4000-8000-000000000001',
    actorType: 'system',
    reasonCode: 'automatic_pass',
    ruleVersion: 'fixture-rules.v1',
  })
  assert.equal(visibleFirst.moderation_state, 'visible')
  assert.equal(visibleFirst.version, 2)
  const listed = await service.listComments({ projectId, cursor: null, sort: 'latest' })
  assert.deepEqual(listed.items.map(({ comment_id }) => comment_id), [firstComment.comment_id])

  const report = await service.reportComment({
    userId,
    commentId: firstComment.comment_id,
    reasonCode: 'spam',
    note: 'fixture private report note',
    clientRequestId: 'community_report_0001',
  })
  assert.equal(report.result, 'created')
  assert.equal(report.status, 'open')
  assert.ok(report.review_work_item_id)
  const reportRetry = await service.reportComment({
    userId,
    commentId: firstComment.comment_id,
    reasonCode: 'spam',
    note: 'fixture private report note',
    clientRequestId: 'community_report_0001',
  })
  assert.equal(reportRetry.result, 'deduplicated')
  assert.equal(reportRetry.report_id, report.report_id)

  const secondComment = await service.createComment({
    userId,
    projectId,
    body: 'fixture second comment',
    parentCommentId: null,
    clientRequestId: 'community_comment_0002',
  })
  await service.moderateComment({
    commentId: secondComment.comment_id,
    expectedVersion: 1,
    resultingState: 'visible',
    decisionId: '72000000-0000-4000-8000-000000000002',
    actorType: 'system',
    reasonCode: 'automatic_pass',
    ruleVersion: 'fixture-rules.v1',
  })
  const withdrawn = await service.withdrawComment({
    userId,
    commentId: secondComment.comment_id,
    expectedVersion: 2,
    operationId: 'community_withdraw_0001',
  })
  assert.equal(withdrawn.moderation_state, 'author_withdrawn')
  assert.equal(withdrawn.result, 'changed')
  const withdrawRetry = await service.withdrawComment({
    userId,
    commentId: secondComment.comment_id,
    expectedVersion: 2,
    operationId: 'community_withdraw_0001',
  })
  assert.deepEqual(withdrawRetry, withdrawn)

  await service.createComment({
    userId,
    projectId,
    body: 'fixture third comment',
    parentCommentId: null,
    clientRequestId: 'community_comment_0003',
  })
  await assert.rejects(
    () => service.createComment({
      userId,
      projectId,
      body: 'fixture rate limited comment',
      parentCommentId: null,
      clientRequestId: 'community_comment_0004',
    }),
    (error: unknown) => error instanceof CommunityError &&
      error.code === 'RATE_LIMITED' && error.httpStatus === 429 &&
      error.retryAfterSeconds === 60,
  )

  const commentState = await pool.query<{
    comment_count: number
    visible_comment_count: string
    work_item_count: number
    report_count: number
    report_note_plaintext_count: number
    comment_event_count: number
    natural_actor_leak_count: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM community.comments WHERE author_user_id=$1) AS comment_count,
       (SELECT visible_comment_count::text FROM catalog.project_interaction_counters
        WHERE project_id=$2) AS visible_comment_count,
       (SELECT count(*)::int FROM workflow.review_work_items
        WHERE work_type='community' AND target_type='comment' AND target_id=$3
          AND status='queued') AS work_item_count,
       (SELECT count(*)::int FROM community.comment_reports
        WHERE reporter_user_id=$1 AND comment_id=$3) AS report_count,
       (SELECT count(*)::int FROM community.comment_reports
        WHERE reporter_user_id=$1 AND
          position(convert_to('fixture private report note','UTF8') in note_ciphertext)>0
       ) AS report_note_plaintext_count,
       (SELECT count(*)::int FROM ops.outbox_events
        WHERE aggregate_type='comment' AND payload_json->>'project_id'=$2::text) AS comment_event_count,
       (SELECT count(*)::int FROM ops.outbox_events
        WHERE aggregate_type='comment' AND payload_json->>'project_id'=$2::text
          AND (payload_json ? 'user_id' OR payload_json ? 'author_user_id'
            OR payload_json ? 'reporter_user_id')) AS natural_actor_leak_count`,
    [userId, projectId, firstComment.comment_id],
  )
  assert.deepEqual(commentState.rows[0], {
    comment_count: 3,
    visible_comment_count: '0',
    work_item_count: 1,
    report_count: 1,
    report_note_plaintext_count: 0,
    comment_event_count: 9,
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
  process.stdout.write('community_fixture_ok interactions=1 comments=3 reports=1 events=14\n')
} finally {
  await pool.end()
}
