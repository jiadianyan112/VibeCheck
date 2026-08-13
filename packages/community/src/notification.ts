import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import { communityError } from './errors.js'

export const notificationTypes = ['submission_published'] as const
export type NotificationType = (typeof notificationTypes)[number]

export interface NotificationProjection {
  readonly notification_id: string
  readonly type: NotificationType
  readonly title: string
  readonly body_summary: string
  readonly target_type: 'project'
  readonly target_id: string
  readonly event_id: string | null
  readonly read_at: string | null
  readonly created_at: string
}

export interface NotificationPage {
  readonly items: readonly NotificationProjection[]
  readonly next_cursor: string | null
  readonly unread_count: number
}

export interface NotificationReadProjection {
  readonly read: true
  readonly changed_count: number
  readonly unread_count: number
  readonly read_at: string
}

interface NotificationRow extends QueryResultRow {
  readonly notification_id: string
  readonly notification_type: NotificationType
  readonly title: string
  readonly body_summary: string
  readonly target_type: 'project'
  readonly target_id: string
  readonly event_id: string | null
  readonly read_at: Date | null
  readonly created_at: Date
}

interface ReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

export class PostgresNotificationStore {
  constructor(private readonly pool: Pool) {}

  async createProjectPublishedNotification(input: Readonly<{
    projectId: string
    versionId: string
    submissionId: string
    reviewDecisionId: string
    eventId: string
    now: Date
  }>): Promise<NotificationProjection> {
    const result = await this.pool.query<NotificationRow>(
      `WITH source AS (
         SELECT submission.owner_user_id,project.current_name
         FROM workflow.submission_publication_receipts receipt
         JOIN workflow.submissions submission ON submission.submission_id=receipt.submission_id
         JOIN catalog.projects project ON project.project_id=receipt.project_id
         WHERE receipt.project_id=$1 AND receipt.version_id=$2 AND receipt.submission_id=$3
           AND receipt.review_decision_id=$4 AND receipt.event_id=$5
           AND submission.review_status='published'
       ), inserted AS (
         INSERT INTO community.notifications (
           notification_id,recipient_user_id,notification_type,title,body_summary,
           target_type,target_id,event_id,dedup_key,created_at
         )
         SELECT $6,source.owner_user_id,'submission_published','作品已发布',
           left(source.current_name || ' 已通过审核并公开。',500),'project',$1,$5,$7,$8
         FROM source
         ON CONFLICT (recipient_user_id,dedup_key) DO NOTHING
         RETURNING *
       )
       SELECT * FROM inserted
       UNION ALL
       SELECT notification.* FROM community.notifications notification
       JOIN source ON source.owner_user_id=notification.recipient_user_id
       WHERE notification.dedup_key=$7 AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [input.projectId, input.versionId, input.submissionId, input.reviewDecisionId,
        input.eventId, randomUUID(), `submission_published:${input.submissionId}`, input.now],
    )
    if (!result.rows[0]) throw communityError('NOTIFICATION_SOURCE_INVALID', 409)
    return this.projection(result.rows[0])
  }

  async list(input: Readonly<{
    userId: string
    type: NotificationType | null
    unreadOnly: boolean
    after: Readonly<{ unread: boolean; createdAt: Date; notificationId: string }> | null
    limit: number
  }>): Promise<Readonly<{
    rows: readonly NotificationRow[]
    nextAnchor: Readonly<{ unread: boolean; createdAt: Date; notificationId: string }> | null
    unreadCount: number
  }>> {
    const result = await this.pool.query<NotificationRow & { readonly unread_count: number }>(
      `SELECT notification.*,
         (SELECT count(*)::int FROM community.notifications unread_notification
          WHERE unread_notification.recipient_user_id=$1
            AND unread_notification.read_at IS NULL) AS unread_count
       FROM community.notifications notification
       WHERE notification.recipient_user_id=$1
         AND ($2::varchar IS NULL OR notification.notification_type=$2)
         AND (NOT $3::boolean OR notification.read_at IS NULL)
         AND (
           $4::boolean IS NULL OR
           (notification.read_at IS NULL) < $4 OR
           ((notification.read_at IS NULL) = $4 AND
             (notification.created_at,notification.notification_id) < ($5,$6))
         )
       ORDER BY (notification.read_at IS NULL) DESC,notification.created_at DESC,
         notification.notification_id DESC
       LIMIT $7`,
      [input.userId, input.type, input.unreadOnly, input.after?.unread ?? null,
        input.after?.createdAt ?? null, input.after?.notificationId ?? null, input.limit + 1],
    )
    const pageRows = result.rows.slice(0, input.limit)
    const last = result.rows.length > input.limit ? pageRows.at(-1) : undefined
    let unreadCount = result.rows[0]?.unread_count
    if (unreadCount === undefined) {
      const count = await this.pool.query<{ readonly count: number } & QueryResultRow>(
        `SELECT count(*)::int AS count FROM community.notifications
         WHERE recipient_user_id=$1 AND read_at IS NULL`,
        [input.userId],
      )
      unreadCount = count.rows[0]?.count ?? 0
    }
    return Object.freeze({
      rows: Object.freeze(pageRows),
      nextAnchor: last ? Object.freeze({
        unread: last.read_at === null,
        createdAt: last.created_at,
        notificationId: last.notification_id,
      }) : null,
      unreadCount,
    })
  }

  async setRead(input: Readonly<{
    userId: string
    notificationIds: readonly string[] | null
    operationId: string
    requestHash: string
    now: Date
  }>): Promise<NotificationReadProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `notification-read:${input.userId}:${input.operationId}`,
      ])
      const receipt = await client.query<ReceiptRow>(
        `SELECT request_hash,response_json FROM community.notification_read_receipts
         WHERE recipient_user_id=$1 AND operation_id=$2`,
        [input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw communityError('OPERATION_ID_REUSED', 409)
        }
        const projection = this.receiptProjection(receipt.rows[0].response_json)
        await client.query('COMMIT')
        return projection
      }
      if (input.notificationIds !== null) {
        const owned = await client.query<{ readonly notification_id: string } & QueryResultRow>(
          `SELECT notification_id FROM community.notifications
           WHERE recipient_user_id=$1 AND notification_id=ANY($2::uuid[]) FOR UPDATE`,
          [input.userId, input.notificationIds],
        )
        if (owned.rows.length !== input.notificationIds.length) {
          throw communityError('NOTIFICATION_NOT_FOUND', 404)
        }
      }
      const updated = input.notificationIds === null
        ? await client.query(
            `UPDATE community.notifications SET read_at=$2
             WHERE recipient_user_id=$1 AND read_at IS NULL`,
            [input.userId, input.now],
          )
        : await client.query(
            `UPDATE community.notifications SET read_at=$3
             WHERE recipient_user_id=$1 AND notification_id=ANY($2::uuid[]) AND read_at IS NULL`,
            [input.userId, input.notificationIds, input.now],
          )
      const unread = await client.query<{ readonly count: number } & QueryResultRow>(
        `SELECT count(*)::int AS count FROM community.notifications
         WHERE recipient_user_id=$1 AND read_at IS NULL`,
        [input.userId],
      )
      const projection: NotificationReadProjection = Object.freeze({
        read: true,
        changed_count: updated.rowCount ?? 0,
        unread_count: unread.rows[0]?.count ?? 0,
        read_at: input.now.toISOString(),
      })
      await client.query(
        `INSERT INTO community.notification_read_receipts (
           recipient_user_id,operation_id,request_hash,response_json,created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [input.userId, input.operationId, input.requestHash, JSON.stringify(projection), input.now],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  toProjection(row: NotificationRow): NotificationProjection {
    return this.projection(row)
  }

  private projection(row: NotificationRow): NotificationProjection {
    return Object.freeze({
      notification_id: row.notification_id,
      type: row.notification_type,
      title: row.title,
      body_summary: row.body_summary,
      target_type: row.target_type,
      target_id: row.target_id,
      event_id: row.event_id,
      read_at: row.read_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    })
  }

  private receiptProjection(value: unknown): NotificationReadProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw communityError('NOTIFICATION_RECEIPT_INVALID', 500, true)
    }
    const row = value as Record<string, unknown>
    if (
      row.read !== true || typeof row.changed_count !== 'number' ||
      typeof row.unread_count !== 'number' || typeof row.read_at !== 'string'
    ) throw communityError('NOTIFICATION_RECEIPT_INVALID', 500, true)
    return Object.freeze({
      read: true,
      changed_count: row.changed_count,
      unread_count: row.unread_count,
      read_at: row.read_at,
    })
  }
}

export class NotificationService {
  constructor(
    private readonly store: PostgresNotificationStore,
    private readonly cursorSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(input: Readonly<{
    userId: string
    type: string | null
    unreadOnly: boolean
    cursor: string | null
    limit: number
  }>): Promise<NotificationPage> {
    const userId = this.uuid(input.userId, 'NOTIFICATION_USER_INVALID')
    const type = input.type === null ? null : this.type(input.type)
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw communityError('NOTIFICATION_LIMIT_INVALID', 400)
    }
    const after = input.cursor === null ? null : this.decodeCursor(input.cursor, userId, type, input.unreadOnly)
    const result = await this.store.list({ userId, type, unreadOnly: input.unreadOnly, after, limit: input.limit })
    return Object.freeze({
      items: Object.freeze(result.rows.map((row) => this.store.toProjection(row))),
      next_cursor: result.nextAnchor === null ? null : this.encodeCursor(
        result.nextAnchor, userId, type, input.unreadOnly,
      ),
      unread_count: result.unreadCount,
    })
  }

  async setRead(input: Readonly<{
    userId: string
    notificationIds: readonly string[] | null
    operationId: string
  }>): Promise<NotificationReadProjection> {
    const userId = this.uuid(input.userId, 'NOTIFICATION_USER_INVALID')
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)) {
      throw communityError('OPERATION_ID_INVALID', 422)
    }
    const ids = input.notificationIds === null
      ? null
      : input.notificationIds.map((id) => this.uuid(id, 'NOTIFICATION_ID_INVALID'))
    if (ids !== null && (ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length)) {
      throw communityError('NOTIFICATION_IDS_INVALID', 422)
    }
    const requestHash = createHash('sha256').update(JSON.stringify({ ids, read: true })).digest('hex')
    return this.store.setRead({
      userId, notificationIds: ids, operationId: input.operationId, requestHash, now: this.now(),
    })
  }

  private type(value: string): NotificationType {
    if (!notificationTypes.includes(value as NotificationType)) {
      throw communityError('NOTIFICATION_TYPE_INVALID', 400)
    }
    return value as NotificationType
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw communityError(code, 422)
    }
    return value.toLowerCase()
  }

  private encodeCursor(
    anchor: Readonly<{ unread: boolean; createdAt: Date; notificationId: string }>,
    userId: string,
    type: NotificationType | null,
    unreadOnly: boolean,
  ): string {
    const payload = Buffer.from(JSON.stringify({
      user_id: userId, type, unread_only: unreadOnly, unread: anchor.unread,
      created_at: anchor.createdAt.toISOString(), notification_id: anchor.notificationId,
    })).toString('base64url')
    return `${payload}.${createHmac('sha256', this.cursorSecret).update(payload).digest('base64url')}`
  }

  private decodeCursor(cursor: string, userId: string, type: NotificationType | null, unreadOnly: boolean) {
    const [payload, signature, ...rest] = cursor.split('.')
    if (!payload || !signature || rest.length > 0 || cursor.length > 1_024) {
      throw communityError('NOTIFICATION_CURSOR_INVALID', 400)
    }
    const expected = Buffer.from(createHmac('sha256', this.cursorSecret).update(payload).digest('base64url'))
    const supplied = Buffer.from(signature)
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw communityError('NOTIFICATION_CURSOR_INVALID', 400)
    }
    let value: unknown
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch {
      throw communityError('NOTIFICATION_CURSOR_INVALID', 400)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw communityError('NOTIFICATION_CURSOR_INVALID', 400)
    }
    const row = value as Record<string, unknown>
    const createdAt = new Date(String(row.created_at))
    if (
      row.user_id !== userId || row.type !== type || row.unread_only !== unreadOnly ||
      typeof row.unread !== 'boolean' || typeof row.notification_id !== 'string' ||
      Number.isNaN(createdAt.getTime())
    ) throw communityError('NOTIFICATION_CURSOR_INVALID', 400)
    return Object.freeze({
      unread: row.unread,
      createdAt,
      notificationId: this.uuid(row.notification_id, 'NOTIFICATION_CURSOR_INVALID'),
    })
  }
}
