import assert from 'node:assert/strict'

import pg from 'pg'

import { CommunityError } from '../errors.js'
import { NotificationService, PostgresNotificationStore } from '../notification.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const ownerUserId = '96000000-0000-4000-8000-000000000001'
const otherUserId = '96000000-0000-4000-8000-000000000002'
const submissionId = '96000000-0000-4000-8000-000000000011'
const now = new Date('2026-08-13T16:01:00.000Z')
const store = new PostgresNotificationStore(pool)
const service = new NotificationService(
  store,
  'notification-fixture-cursor-secret-at-least-thirty-two-characters',
  () => now,
)

interface PublicationSource {
  readonly project_id: string
  readonly version_id: string
  readonly review_decision_id: string
  readonly event_id: string
}

async function run(): Promise<void> {
  const source = await pool.query<PublicationSource>(
    `SELECT project_id,version_id,review_decision_id,event_id
     FROM workflow.submission_publication_receipts WHERE submission_id=$1`,
    [submissionId],
  )
  assert.equal(source.rowCount, 1, 'publication fixture must run before notification fixture')
  const publication = source.rows[0]!
  const command = Object.freeze({
    ...publication,
    projectId: publication.project_id,
    versionId: publication.version_id,
    submissionId,
    reviewDecisionId: publication.review_decision_id,
    eventId: publication.event_id,
    now,
  })
  const first = await store.createProjectPublishedNotification(command)
  const replay = await store.createProjectPublishedNotification(command)
  assert.equal(replay.notification_id, first.notification_id)
  assert.equal(first.type, 'submission_published')
  assert.equal(first.target_id, publication.project_id)
  assert.equal(first.event_id, publication.event_id)

  const ownerPage = await service.list({
    userId: ownerUserId, type: null, unreadOnly: false, cursor: null, limit: 30,
  })
  assert.equal(ownerPage.items.length, 1)
  assert.equal(ownerPage.unread_count, 1)
  assert.equal(ownerPage.items[0]?.notification_id, first.notification_id)
  const isolatedPage = await service.list({
    userId: otherUserId, type: null, unreadOnly: false, cursor: null, limit: 30,
  })
  assert.deepEqual(isolatedPage, { items: [], next_cursor: null, unread_count: 0 })

  await assert.rejects(
    () => service.setRead({
      userId: otherUserId,
      notificationIds: [first.notification_id],
      operationId: 'notification-cross-user-0001',
    }),
    (error: unknown) => error instanceof CommunityError &&
      error.code === 'NOTIFICATION_NOT_FOUND' && error.httpStatus === 404,
  )
  const read = await service.setRead({
    userId: ownerUserId,
    notificationIds: [first.notification_id],
    operationId: 'notification-read-0001',
  })
  assert.deepEqual(read, {
    read: true, changed_count: 1, unread_count: 0, read_at: now.toISOString(),
  })
  const readReplay = await service.setRead({
    userId: ownerUserId,
    notificationIds: [first.notification_id],
    operationId: 'notification-read-0001',
  })
  assert.deepEqual(readReplay, read)

  const verified = await pool.query<{
    readonly notification_count: number
    readonly receipt_count: number
    readonly unread_count: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM community.notifications
        WHERE recipient_user_id=$1 AND dedup_key=$2) AS notification_count,
       (SELECT count(*)::int FROM community.notification_read_receipts
        WHERE recipient_user_id=$1 AND operation_id='notification-read-0001') AS receipt_count,
       (SELECT count(*)::int FROM community.notifications
        WHERE recipient_user_id=$1 AND read_at IS NULL) AS unread_count`,
    [ownerUserId, `submission_published:${submissionId}`],
  )
  assert.deepEqual(verified.rows[0], {
    notification_count: 1, receipt_count: 1, unread_count: 0,
  })
}

try {
  await run()
  process.stdout.write('notification_fixture_ok notifications=1 receipts=1 recipient_isolation=ok\n')
} finally {
  await pool.end()
}
