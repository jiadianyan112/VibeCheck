import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CommunityError } from './errors.js'
import {
  NotificationService,
  PostgresNotificationStore,
  type NotificationReadProjection,
} from './notification.js'

const userId = '10000000-0000-4000-8000-000000000001'
const otherUserId = '10000000-0000-4000-8000-000000000002'
const notificationId = '20000000-0000-4000-8000-000000000001'
const secondNotificationId = '20000000-0000-4000-8000-000000000002'
const now = new Date('2026-10-03T00:00:00.000Z')
const cursorSecret = 'notification-test-cursor-secret-at-least-thirty-two-characters'

type ListInput = Parameters<PostgresNotificationStore['list']>[0]
type ListResult = Awaited<ReturnType<PostgresNotificationStore['list']>>
type SetReadInput = Parameters<PostgresNotificationStore['setRead']>[0]

class FakeNotificationStore {
  readonly listInputs: ListInput[] = []
  readonly setReadInputs: SetReadInput[] = []

  async list(input: ListInput): Promise<ListResult> {
    this.listInputs.push(input)
    return Object.freeze({
      rows: Object.freeze([]),
      nextAnchor: input.after === null
        ? Object.freeze({ unread: true, createdAt: now, notificationId })
        : null,
      unreadCount: 1,
    })
  }

  async setRead(input: SetReadInput): Promise<NotificationReadProjection> {
    this.setReadInputs.push(input)
    return Object.freeze({
      read: true,
      changed_count: input.notificationIds?.length ?? 1,
      unread_count: 0,
      read_at: input.now.toISOString(),
    })
  }
}

function createService(store: FakeNotificationStore): NotificationService {
  return new NotificationService(
    store as unknown as PostgresNotificationStore,
    cursorSecret,
    () => now,
  )
}

function assertCommunityError(
  error: unknown,
  code: string,
  httpStatus: number,
): boolean {
  return error instanceof CommunityError && error.code === code && error.httpStatus === httpStatus
}

describe('NotificationService cursors', () => {
  it('binds cursors to the user and notification filters', async () => {
    const store = new FakeNotificationStore()
    const service = createService(store)
    const first = await service.list({
      userId,
      type: 'project_updated',
      unreadOnly: true,
      cursor: null,
      limit: 20,
    })
    assert.ok(first.next_cursor)
    assert.equal(store.listInputs[0]?.after, null)

    await service.list({
      userId,
      type: 'project_updated',
      unreadOnly: true,
      cursor: first.next_cursor,
      limit: 20,
    })
    assert.deepEqual(store.listInputs[1]?.after, {
      unread: true,
      createdAt: now,
      notificationId,
    })

    await assert.rejects(
      () => service.list({
        userId: otherUserId,
        type: 'project_updated',
        unreadOnly: true,
        cursor: first.next_cursor,
        limit: 20,
      }),
      (error: unknown) => assertCommunityError(error, 'NOTIFICATION_CURSOR_INVALID', 400),
    )
    await assert.rejects(
      () => service.list({
        userId,
        type: null,
        unreadOnly: true,
        cursor: first.next_cursor,
        limit: 20,
      }),
      (error: unknown) => assertCommunityError(error, 'NOTIFICATION_CURSOR_INVALID', 400),
    )
    await assert.rejects(
      () => service.list({
        userId,
        type: 'project_updated',
        unreadOnly: false,
        cursor: first.next_cursor,
        limit: 20,
      }),
      (error: unknown) => assertCommunityError(error, 'NOTIFICATION_CURSOR_INVALID', 400),
    )
    assert.equal(store.listInputs.length, 2)
  })
})

describe('NotificationService mark-read validation', () => {
  it('rejects malformed, duplicate, and oversized notification ID lists', async () => {
    const store = new FakeNotificationStore()
    const service = createService(store)

    await assert.rejects(
      () => service.setRead({ userId, notificationIds: ['not-a-uuid'], operationId: 'read-operation-1' }),
      (error: unknown) => assertCommunityError(error, 'NOTIFICATION_ID_INVALID', 422),
    )
    await assert.rejects(
      () => service.setRead({
        userId,
        notificationIds: [notificationId, notificationId],
        operationId: 'read-operation-2',
      }),
      (error: unknown) => assertCommunityError(error, 'NOTIFICATION_IDS_INVALID', 422),
    )
    await assert.rejects(
      () => service.setRead({
        userId,
        notificationIds: Array.from({ length: 101 }, (_, index) =>
          `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
        operationId: 'read-operation-3',
      }),
      (error: unknown) => assertCommunityError(error, 'NOTIFICATION_IDS_INVALID', 422),
    )
    assert.equal(store.setReadInputs.length, 0)
  })

  it('normalizes valid IDs and supports marking the whole inbox as read', async () => {
    const store = new FakeNotificationStore()
    const service = createService(store)

    const selected = await service.setRead({
      userId,
      notificationIds: [notificationId.toUpperCase(), secondNotificationId],
      operationId: 'read-operation-valid',
    })
    assert.deepEqual(selected, {
      read: true,
      changed_count: 2,
      unread_count: 0,
      read_at: now.toISOString(),
    })
    assert.deepEqual(store.setReadInputs[0], {
      userId,
      notificationIds: [notificationId, secondNotificationId],
      operationId: 'read-operation-valid',
      requestHash: store.setReadInputs[0]?.requestHash,
      now,
    })
    assert.match(store.setReadInputs[0]?.requestHash ?? '', /^[a-f0-9]{64}$/)

    await service.setRead({ userId, notificationIds: null, operationId: 'read-operation-all' })
    assert.equal(store.setReadInputs[1]?.notificationIds, null)
  })
})
