import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { communityError } from './errors.js'
import type {
  ProjectInteractionFactChange,
  ProjectInteractionStore,
  SetStoredProjectInteractionInput,
} from './store-port.js'
import type {
  CommentModerationState,
  CommentProjection,
  CommentReportProjection,
  InteractionCounts,
  PublicCommentProjection,
  ProjectInteractionProjection,
  ProjectInteractionType,
} from './types.js'

interface ProjectRow extends QueryResultRow {
  readonly review_status: string
  readonly current_version_id: string | null
}

interface InteractionRow extends QueryResultRow {
  readonly interaction_type: ProjectInteractionType
  readonly state: boolean
}

interface CounterRow extends QueryResultRow {
  readonly favorite_count: string
  readonly like_count: string
  readonly follower_count: string
}

interface ReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

interface CommentRow extends QueryResultRow {
  readonly comment_id: string
  readonly project_id: string
  readonly author_user_id: string
  readonly parent_comment_id: string | null
  readonly body: string
  readonly moderation_state: CommentModerationState
  readonly version: number
  readonly client_request_id: string
  readonly request_hash: string
  readonly legal_hold: boolean
  readonly created_at: Date
  readonly updated_at: Date
  readonly author_withdrawn_at: Date | null
}

interface ReportRow extends QueryResultRow {
  readonly report_id: string
  readonly project_id: string
  readonly comment_id: string
  readonly reporter_user_id: string
  readonly reason_code: string
  readonly note_ciphertext: Buffer | null
  readonly status: 'open' | 'resolved_actioned' | 'resolved_no_action' | 'withdrawn'
  readonly review_work_item_id: string | null
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
  readonly resolved_at: Date | null
}

interface ConfigVersionRow extends QueryResultRow {
  readonly version: number
  readonly value_json: unknown
}

interface RateBucketRow extends QueryResultRow {
  readonly window_started_at: Date
  readonly attempt_count: number
  readonly policy_version: number
}

const eventNames: Readonly<Record<ProjectInteractionType, string>> = Object.freeze({
  favorite: 'project_favorited',
  like: 'project_liked',
  follow: 'project_followed',
})

export class PostgresCommunityStore implements ProjectInteractionStore {
  private readonly publicCommentStates = new Set<CommentModerationState>(['visible', 'collapsed'])

  constructor(private readonly pool: Pool) {}

  async setProjectInteraction(
    input: SetStoredProjectInteractionInput,
  ): Promise<ProjectInteractionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `interaction-receipt:${input.userId}:${input.clientRequestId}`)
      const receipt = await client.query<ReceiptRow>(
        `SELECT request_hash,response_json
         FROM community.interaction_operation_receipts
         WHERE user_id=$1 AND client_request_id=$2`,
        [input.userId, input.clientRequestId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw communityError('CLIENT_REQUEST_ID_REUSED', 409)
        }
        const projection = this.projection(receipt.rows[0].response_json)
        await client.query('COMMIT')
        return projection
      }

      await this.lock(client, `project-interaction:${input.userId}:${input.projectId}`)
      const project = await client.query<ProjectRow>(
        `SELECT review_status,current_version_id
         FROM catalog.projects WHERE project_id=$1 FOR SHARE`,
        [input.projectId],
      )
      this.assertProjectWritable(project.rows[0])

      const existing = await client.query<InteractionRow>(
        `SELECT interaction_type,state
         FROM community.project_interactions
         WHERE user_id=$1 AND project_id=$2
         ORDER BY interaction_type FOR UPDATE`,
        [input.userId, input.projectId],
      )
      const before: Record<ProjectInteractionType, boolean> = {
        favorite: false,
        like: false,
        follow: false,
      }
      for (const row of existing.rows) before[row.interaction_type] = row.state
      const after = { ...before }
      const changes: ProjectInteractionFactChange[] = []
      this.applyRequestedState(after, before, input.interactionType, input.state, changes)

      const transactionId = randomUUID()
      for (const change of changes) {
        await client.query(
          `INSERT INTO community.project_interactions (
             interaction_id,user_id,project_id,target_type,interaction_type,state,
             client_request_id,created_at,updated_at
           ) VALUES ($1,$2,$3,'project',$4,$5,$6,$7,$7)
           ON CONFLICT (user_id,project_id,interaction_type) DO UPDATE
           SET state=EXCLUDED.state,client_request_id=EXCLUDED.client_request_id,
             updated_at=EXCLUDED.updated_at`,
          [
            randomUUID(), input.userId, input.projectId, change.interactionType,
            change.state, input.clientRequestId, input.now,
          ],
        )
        await client.query(
          `INSERT INTO ops.outbox_events (
             event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
             transaction_id,created_at,next_attempt_at
           ) VALUES ($1,'project',$2::text,$3,1,$4::jsonb,$5,$6,$6)`,
          [
            randomUUID(),
            input.projectId,
            eventNames[change.interactionType],
            JSON.stringify({
              project_id: input.projectId,
              target_state: change.state,
              result: 'changed',
              change_source: change.source,
              client_request_id: input.clientRequestId,
            }),
            transactionId,
            input.now,
          ],
        )
      }

      const deltas: InteractionCounts = Object.freeze({
        favorite_count: Number(after.favorite) - Number(before.favorite),
        like_count: Number(after.like) - Number(before.like),
        follower_count: Number(after.follow) - Number(before.follow),
      })
      await client.query(
        `INSERT INTO catalog.project_interaction_counters (project_id,source_watermark)
         VALUES ($1,$2) ON CONFLICT (project_id) DO NOTHING`,
        [input.projectId, transactionId],
      )
      const counters = await client.query<CounterRow>(
        `UPDATE catalog.project_interaction_counters
         SET favorite_count=favorite_count+$2,
           like_count=like_count+$3,
           follower_count=follower_count+$4,
           source_watermark=$5
         WHERE project_id=$1
         RETURNING favorite_count::text,like_count::text,follower_count::text`,
        [
          input.projectId,
          deltas.favorite_count,
          deltas.like_count,
          deltas.follower_count,
          transactionId,
        ],
      )
      const projection = Object.freeze({
        project_id: input.projectId,
        result: changes.length === 0 ? 'no_change' as const : 'changed' as const,
        states: Object.freeze({
          favorite: after.favorite,
          like: after.like,
          follow: after.follow,
        }),
        counts: this.counts(counters.rows[0]),
        count_deltas: deltas,
        change_sources: Object.freeze({
          favorite: changes.find(({ interactionType }) => interactionType === 'favorite')?.source ?? null,
          like: changes.find(({ interactionType }) => interactionType === 'like')?.source ?? null,
          follow: changes.find(({ interactionType }) => interactionType === 'follow')?.source ?? null,
        }),
        updated_at: input.now.toISOString(),
      }) satisfies ProjectInteractionProjection
      await client.query(
        `INSERT INTO community.interaction_operation_receipts (
           user_id,client_request_id,request_hash,response_json,created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [input.userId, input.clientRequestId, input.requestHash, JSON.stringify(projection), input.now],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async createComment(input: {
    readonly userId: string
    readonly projectId: string
    readonly parentCommentId: string | null
    readonly body: string
    readonly clientRequestId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `comment-create:${input.userId}:${input.clientRequestId}`)
      const existing = await client.query<CommentRow>(
        `SELECT * FROM community.comments
         WHERE author_user_id=$1 AND client_request_id=$2`,
        [input.userId, input.clientRequestId],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== input.requestHash) {
          throw communityError('CLIENT_REQUEST_ID_REUSED', 409)
        }
        const projection = this.commentProjection(existing.rows[0], 'deduplicated')
        await client.query('COMMIT')
        return projection
      }
      await this.consumeRateLimit(client, 'comment_create', input.userId, input.now)
      const project = await client.query<ProjectRow>(
        `SELECT review_status,current_version_id
         FROM catalog.projects WHERE project_id=$1 FOR SHARE`,
        [input.projectId],
      )
      this.assertProjectWritable(project.rows[0])
      if (input.parentCommentId !== null) {
        const parent = await client.query<CommentRow>(
          `SELECT * FROM community.comments WHERE comment_id=$1 FOR SHARE`,
          [input.parentCommentId],
        )
        if (!parent.rows[0] || parent.rows[0].project_id !== input.projectId) {
          throw communityError('COMMENT_PARENT_NOT_FOUND', 404)
        }
        if (!this.publicCommentStates.has(parent.rows[0].moderation_state)) {
          throw communityError('COMMENT_PARENT_NOT_REPLYABLE', 409)
        }
      }
      const commentId = randomUUID()
      const inserted = await client.query<CommentRow>(
        `INSERT INTO community.comments (
           comment_id,project_id,author_user_id,parent_comment_id,body,moderation_state,
           version,client_request_id,request_hash,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,'pending',1,$6,$7,$8,$8)
         RETURNING *`,
        [
          commentId, input.projectId, input.userId, input.parentCommentId, input.body,
          input.clientRequestId, input.requestHash, input.now,
        ],
      )
      await this.outbox(client, {
        aggregateId: commentId,
        eventName: 'comment_created',
        payload: {
          project_id: input.projectId,
          comment_id: commentId,
          parent_comment_id: input.parentCommentId,
          resulting_status: 'pending',
          result: 'created',
          client_request_id: input.clientRequestId,
        },
        now: input.now,
      })
      const projection = this.commentProjection(inserted.rows[0]!, 'created')
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listComments(input: {
    readonly projectId: string
    readonly after: { readonly createdAt: Date; readonly commentId: string } | null
    readonly limit: number
  }) {
    const project = await this.pool.query<ProjectRow>(
      `SELECT review_status,current_version_id FROM catalog.projects WHERE project_id=$1`,
      [input.projectId],
    )
    this.assertProjectWritable(project.rows[0])
    const result = await this.pool.query<CommentRow>(
      `SELECT * FROM community.comments
       WHERE project_id=$1 AND moderation_state IN ('visible','collapsed')
         AND ($2::timestamptz IS NULL OR (created_at,comment_id) < ($2::timestamptz,$3::uuid))
       ORDER BY created_at DESC,comment_id DESC LIMIT $4`,
      [input.projectId, input.after?.createdAt ?? null, input.after?.commentId ?? null, input.limit + 1],
    )
    const hasNext = result.rows.length > input.limit
    const pageRows = result.rows.slice(0, input.limit)
    const items = Object.freeze(pageRows.map((row): PublicCommentProjection => Object.freeze({
      comment_id: row.comment_id,
      project_id: row.project_id,
      parent_comment_id: row.parent_comment_id,
      body: row.body,
      moderation_state: row.moderation_state as 'visible' | 'collapsed',
      default_collapsed: row.moderation_state === 'collapsed',
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })))
    const last = pageRows.at(-1)
    return Object.freeze({
      items,
      nextAnchor: hasNext && last
        ? Object.freeze({ createdAt: last.created_at, commentId: last.comment_id })
        : null,
    })
  }

  async withdrawComment(input: {
    readonly userId: string
    readonly commentId: string
    readonly expectedVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `comment-operation:${input.commentId}:${input.operationId}`)
      const receipt = await client.query<ReceiptRow>(
        `SELECT request_hash,response_json FROM community.comment_operation_receipts
         WHERE comment_id=$1 AND operation_id=$2`,
        [input.commentId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw communityError('OPERATION_ID_REUSED', 409)
        }
        const projection = this.commentReceiptProjection(receipt.rows[0].response_json)
        await client.query('COMMIT')
        return projection
      }
      const comment = await this.commentRow(client, input.commentId, true)
      if (!comment) throw communityError('COMMENT_NOT_FOUND', 404)
      if (comment.author_user_id !== input.userId) throw communityError('COMMENT_WITHDRAW_FORBIDDEN', 403)
      if (comment.moderation_state === 'author_withdrawn') {
        const projection = this.commentProjection(comment, 'no_change')
        await this.saveCommentReceipt(
          client, input.commentId, input.operationId, 'withdraw', input.requestHash,
          projection, input.now,
        )
        await client.query('COMMIT')
        return projection
      }
      if (comment.legal_hold) throw communityError('COMMENT_LEGAL_HOLD', 409)
      if (!['pending','visible','collapsed','under_review'].includes(comment.moderation_state)) {
        throw communityError('COMMENT_WITHDRAW_STATE_INVALID', 409)
      }
      if (comment.version !== input.expectedVersion) {
        throw communityError('COMMENT_VERSION_CONFLICT', 409, false, undefined, {
          expected_version: input.expectedVersion,
          current_version: comment.version,
        })
      }
      const countDelta = this.publicCommentStates.has(comment.moderation_state) ? -1 : 0
      const updated = await client.query<CommentRow>(
        `UPDATE community.comments SET moderation_state='author_withdrawn',
           version=version+1,updated_at=$2,author_withdrawn_at=$2
         WHERE comment_id=$1 AND version=$3 RETURNING *`,
        [input.commentId, input.now, input.expectedVersion],
      )
      if (!updated.rows[0]) throw communityError('COMMENT_VERSION_CONFLICT', 409)
      await this.applyVisibleCommentDelta(client, comment.project_id, countDelta, input.operationId)
      await this.cancelCommentWorkItem(client, input.commentId, 'target_withdrawn', input.now)
      const transactionId = randomUUID()
      await this.outbox(client, {
        aggregateId: input.commentId,
        eventName: 'comment_withdrawn',
        payload: {
          project_id: comment.project_id,
          comment_id: input.commentId,
          resulting_status: 'author_withdrawn',
          result: 'changed',
          operation_id: input.operationId,
        },
        now: input.now,
        transactionId,
      })
      await this.moderationOutbox(
        client, updated.rows[0], comment.moderation_state, 'author_withdrawn',
        input.operationId, countDelta, 'author_withdrawn', null, input.now, transactionId,
      )
      const projection = this.commentProjection(updated.rows[0], 'changed')
      await this.saveCommentReceipt(
        client, input.commentId, input.operationId, 'withdraw', input.requestHash,
        projection, input.now,
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async reportComment(input: {
    readonly userId: string
    readonly commentId: string
    readonly reasonCode: string
    readonly noteCiphertext: Buffer | null
    readonly noteKeyVersion: string | null
    readonly clientRequestId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentReportProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `comment-report:${input.userId}:${input.clientRequestId}`)
      const receipt = await client.query<{ request_hash: string; report_id: string }>(
        `SELECT request_hash,report_id FROM community.report_operation_receipts
         WHERE reporter_user_id=$1 AND client_request_id=$2`,
        [input.userId, input.clientRequestId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw communityError('CLIENT_REQUEST_ID_REUSED', 409)
        }
        const report = await this.reportRow(client, receipt.rows[0].report_id)
        if (!report) throw communityError('REPORT_RECEIPT_INVALID', 500, true)
        const projection = this.reportProjection(report, 'deduplicated')
        await client.query('COMMIT')
        return projection
      }
      const comment = await this.commentRow(client, input.commentId, true)
      const existing = await client.query<ReportRow>(
        `SELECT * FROM community.comment_reports
         WHERE reporter_user_id=$1 AND comment_id=$2 AND reason_code=$3 AND status='open'
         FOR UPDATE`,
        [input.userId, input.commentId, input.reasonCode],
      )
      if (existing.rows[0]) {
        await this.saveReportReceipt(client, input, existing.rows[0].report_id)
        const projection = this.reportProjection(existing.rows[0], 'deduplicated')
        await client.query('COMMIT')
        return projection
      }
      if (!comment || !this.publicCommentStates.has(comment.moderation_state)) {
        throw communityError('COMMENT_NOT_FOUND', 404)
      }
      await this.consumeRateLimit(client, 'comment_report', input.userId, input.now)
      const workItemId = await this.ensureCommentWorkItem(client, input.commentId, input.now)
      const reportId = randomUUID()
      const inserted = await client.query<ReportRow>(
        `INSERT INTO community.comment_reports (
           report_id,comment_id,project_id,reporter_user_id,reason_code,note_ciphertext,
           note_key_version,status,review_work_item_id,client_request_id,request_hash,
           version,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,1,$11,$11)
         RETURNING *`,
        [
          reportId, input.commentId, comment.project_id, input.userId, input.reasonCode,
          input.noteCiphertext, input.noteKeyVersion, workItemId, input.clientRequestId,
          input.requestHash, input.now,
        ],
      )
      await client.query(
        `INSERT INTO workflow.review_work_item_conflict_principals (
           work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
         ) VALUES ($1,$2,'reporter',$3,1,$4)
         ON CONFLICT DO NOTHING`,
        [workItemId, input.userId, reportId, input.now],
      )
      const countDelta = -1
      const updated = await client.query<CommentRow>(
        `UPDATE community.comments SET moderation_state='under_review',
           version=version+1,updated_at=$2 WHERE comment_id=$1 RETURNING *`,
        [input.commentId, input.now],
      )
      await this.applyVisibleCommentDelta(client, comment.project_id, countDelta, reportId)
      const transactionId = randomUUID()
      await this.outbox(client, {
        aggregateId: input.commentId,
        eventName: 'comment_reported',
        payload: {
          project_id: comment.project_id,
          comment_id: input.commentId,
          report_id: reportId,
          reason_code: input.reasonCode,
          result: 'created',
          client_request_id: input.clientRequestId,
        },
        now: input.now,
        transactionId,
      })
      await this.moderationOutbox(
        client, updated.rows[0]!, comment.moderation_state, 'under_review', reportId,
        countDelta, 'reported', null, input.now, transactionId,
      )
      await this.saveReportReceipt(client, input, reportId)
      const projection = this.reportProjection(inserted.rows[0]!, 'created')
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async moderateComment(input: {
    readonly commentId: string
    readonly expectedVersion: number
    readonly resultingState: Exclude<CommentModerationState, 'author_withdrawn'>
    readonly decisionId: string
    readonly actorType: 'system' | 'platform_editor' | 'admin'
    readonly reasonCode: string
    readonly ruleVersion: string | null
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `comment-operation:${input.commentId}:${input.decisionId}`)
      const receipt = await client.query<ReceiptRow>(
        `SELECT request_hash,response_json FROM community.comment_operation_receipts
         WHERE comment_id=$1 AND operation_id=$2`,
        [input.commentId, input.decisionId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw communityError('DECISION_ID_REUSED', 409)
        }
        const projection = this.commentReceiptProjection(receipt.rows[0].response_json)
        await client.query('COMMIT')
        return projection
      }
      const comment = await this.commentRow(client, input.commentId, true)
      if (!comment) throw communityError('COMMENT_NOT_FOUND', 404)
      if (comment.version !== input.expectedVersion) {
        throw communityError('COMMENT_VERSION_CONFLICT', 409)
      }
      this.assertModerationTransition(comment.moderation_state, input.resultingState, input.actorType)
      if (comment.moderation_state === input.resultingState) {
        const projection = this.commentProjection(comment, 'no_change')
        await this.saveCommentReceipt(
          client, input.commentId, input.decisionId, 'moderate', input.requestHash,
          projection, input.now,
        )
        await client.query('COMMIT')
        return projection
      }
      const countDelta = Number(this.publicCommentStates.has(input.resultingState)) -
        Number(this.publicCommentStates.has(comment.moderation_state))
      const updated = await client.query<CommentRow>(
        `UPDATE community.comments SET moderation_state=$2,version=version+1,updated_at=$3
         WHERE comment_id=$1 AND version=$4 RETURNING *`,
        [input.commentId, input.resultingState, input.now, input.expectedVersion],
      )
      if (!updated.rows[0]) throw communityError('COMMENT_VERSION_CONFLICT', 409)
      if (input.resultingState === 'under_review') {
        await this.ensureCommentWorkItem(client, input.commentId, input.now)
      } else if (comment.moderation_state === 'under_review') {
        await this.cancelCommentWorkItem(client, input.commentId, 'moderation_completed', input.now)
      }
      await this.applyVisibleCommentDelta(client, comment.project_id, countDelta, input.decisionId)
      const transactionId = randomUUID()
      await this.moderationOutbox(
        client, updated.rows[0], comment.moderation_state, input.resultingState,
        input.decisionId, countDelta, input.reasonCode, input.ruleVersion, input.now, transactionId,
      )
      const projection = this.commentProjection(updated.rows[0], 'changed')
      await this.saveCommentReceipt(
        client, input.commentId, input.decisionId, 'moderate', input.requestHash,
        projection, input.now,
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async commentRow(
    client: PoolClient,
    commentId: string,
    forUpdate: boolean,
  ): Promise<CommentRow | null> {
    const result = await client.query<CommentRow>(
      `SELECT * FROM community.comments WHERE comment_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [commentId],
    )
    return result.rows[0] ?? null
  }

  private async reportRow(client: PoolClient, reportId: string): Promise<ReportRow | null> {
    const result = await client.query<ReportRow>(
      'SELECT * FROM community.comment_reports WHERE report_id=$1',
      [reportId],
    )
    return result.rows[0] ?? null
  }

  private commentProjection(
    row: CommentRow,
    result: CommentProjection['result'],
  ): CommentProjection {
    return Object.freeze({
      comment_id: row.comment_id,
      project_id: row.project_id,
      parent_comment_id: row.parent_comment_id,
      body: row.body,
      moderation_state: row.moderation_state,
      version: row.version,
      result,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      author_withdrawn_at: row.author_withdrawn_at?.toISOString() ?? null,
    })
  }

  private reportProjection(
    row: ReportRow,
    result: CommentReportProjection['result'],
  ): CommentReportProjection {
    return Object.freeze({
      report_id: row.report_id,
      project_id: row.project_id,
      comment_id: row.comment_id,
      reason_code: row.reason_code,
      status: row.status,
      review_work_item_id: row.review_work_item_id,
      note_provided: row.note_ciphertext !== null,
      version: row.version,
      result,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      resolved_at: row.resolved_at?.toISOString() ?? null,
    })
  }

  private commentReceiptProjection(value: unknown): CommentProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw communityError('COMMENT_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as CommentProjection
  }

  private async saveCommentReceipt(
    client: PoolClient,
    commentId: string,
    operationId: string,
    operationType: 'withdraw' | 'moderate',
    requestHash: string,
    projection: CommentProjection,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO community.comment_operation_receipts (
         comment_id,operation_id,operation_type,request_hash,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [commentId, operationId, operationType, requestHash, JSON.stringify(projection), now],
    )
  }

  private async saveReportReceipt(
    client: PoolClient,
    input: {
      readonly userId: string
      readonly clientRequestId: string
      readonly requestHash: string
    },
    reportId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO community.report_operation_receipts (
         reporter_user_id,client_request_id,request_hash,report_id
       ) VALUES ($1,$2,$3,$4)`,
      [input.userId, input.clientRequestId, input.requestHash, reportId],
    )
  }

  private async consumeRateLimit(
    client: PoolClient,
    scope: 'comment_create' | 'comment_report',
    userId: string,
    now: Date,
  ): Promise<void> {
    const configKey = `community.${scope}_rate_limit`
    const policy = await client.query<ConfigVersionRow>(
      `SELECT version,value_json FROM ops.config_versions
       WHERE config_key=$1 AND status='published'`,
      [configKey],
    )
    const parsed = this.rateLimitPolicy(policy.rows[0])
    await this.lock(client, `rate-limit:${scope}:${userId}`)
    const bucket = await client.query<RateBucketRow>(
      `SELECT window_started_at,attempt_count,policy_version
       FROM community.rate_limit_buckets WHERE scope_type=$1 AND user_id=$2 FOR UPDATE`,
      [scope, userId],
    )
    const current = bucket.rows[0]
    const windowEndsAt = current
      ? new Date(current.window_started_at.getTime() + parsed.windowSeconds * 1_000)
      : now
    const mustReset = !current || current.policy_version !== parsed.version || windowEndsAt <= now
    if (!mustReset && current.attempt_count >= parsed.limit) {
      const retryAfter = Math.max(1, Math.ceil((windowEndsAt.getTime() - now.getTime()) / 1_000))
      throw communityError('RATE_LIMITED', 429, false, retryAfter, {
        policy_version: parsed.version,
      })
    }
    await client.query(
      `INSERT INTO community.rate_limit_buckets (
         scope_type,user_id,window_started_at,attempt_count,policy_version,updated_at
       ) VALUES ($1,$2,$3,1,$4,$3)
       ON CONFLICT (scope_type,user_id) DO UPDATE SET
         window_started_at=CASE
           WHEN community.rate_limit_buckets.policy_version<>EXCLUDED.policy_version
             OR community.rate_limit_buckets.window_started_at + ($5::integer * interval '1 second') <= EXCLUDED.updated_at
           THEN EXCLUDED.window_started_at ELSE community.rate_limit_buckets.window_started_at END,
         attempt_count=CASE
           WHEN community.rate_limit_buckets.policy_version<>EXCLUDED.policy_version
             OR community.rate_limit_buckets.window_started_at + ($5::integer * interval '1 second') <= EXCLUDED.updated_at
           THEN 1 ELSE community.rate_limit_buckets.attempt_count+1 END,
         policy_version=EXCLUDED.policy_version,updated_at=EXCLUDED.updated_at`,
      [scope, userId, now, parsed.version, parsed.windowSeconds],
    )
  }

  private rateLimitPolicy(row: ConfigVersionRow | undefined): {
    readonly version: number
    readonly limit: number
    readonly windowSeconds: number
  } {
    if (!row || row.value_json === null || typeof row.value_json !== 'object' || Array.isArray(row.value_json)) {
      throw communityError('RATE_LIMIT_POLICY_UNAVAILABLE', 503, true)
    }
    const value = row.value_json as Record<string, unknown>
    if (
      !Number.isSafeInteger(value.limit) || (value.limit as number) < 1 ||
      (value.limit as number) > 10_000 ||
      !Number.isSafeInteger(value.window_seconds) || (value.window_seconds as number) < 1 ||
      (value.window_seconds as number) > 86_400
    ) throw communityError('RATE_LIMIT_POLICY_INVALID', 503, true)
    return Object.freeze({
      version: row.version,
      limit: value.limit as number,
      windowSeconds: value.window_seconds as number,
    })
  }

  private async ensureCommentWorkItem(
    client: PoolClient,
    commentId: string,
    now: Date,
  ): Promise<string> {
    const workItemId = randomUUID()
    await client.query(
      `INSERT INTO workflow.review_work_items (
         work_item_id,work_type,target_type,target_id,status,created_at,updated_at
       ) VALUES ($1,'community','comment',$2,'queued',$3,$3)
       ON CONFLICT DO NOTHING`,
      [workItemId, commentId, now],
    )
    const active = await client.query<{ work_item_id: string }>(
      `SELECT work_item_id FROM workflow.review_work_items
       WHERE work_type='community' AND target_type='comment' AND target_id=$1
         AND status IN ('queued','claimed') FOR UPDATE`,
      [commentId],
    )
    if (!active.rows[0]) throw communityError('COMMENT_WORK_ITEM_STATE_INVALID', 500, true)
    await client.query(
      `INSERT INTO workflow.review_work_item_conflict_principals (
         work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
       )
       SELECT $1,comment.author_user_id,'comment_author',comment.comment_id,1,$3
       FROM community.comments comment WHERE comment.comment_id=$2
       ON CONFLICT DO NOTHING`,
      [active.rows[0].work_item_id, commentId, now],
    )
    return active.rows[0].work_item_id
  }

  private async cancelCommentWorkItem(
    client: PoolClient,
    commentId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `WITH candidate AS (
         SELECT work_item_id,status FROM workflow.review_work_items
         WHERE work_type='community' AND target_type='comment' AND target_id=$1
           AND status IN ('queued','claimed') FOR UPDATE
       ), updated AS (
         UPDATE workflow.review_work_items item SET status='cancelled',cancel_reason=$2,
           assignee_user_id=NULL,claim_token_hash=NULL,lease_expires_at=NULL,
           last_heartbeat_at=NULL,conflict_principal_version_at_claim=NULL,
           version=item.version+1,updated_at=$3
         FROM candidate WHERE item.work_item_id=candidate.work_item_id
         RETURNING item.work_item_id,item.version,candidate.status AS from_status
       )
       INSERT INTO workflow.review_work_item_events (
         event_id,work_item_id,event_type,from_status,to_status,work_item_version,
         reason_code,occurred_at
       )
       SELECT gen_random_uuid(),work_item_id,'cancelled',from_status,'cancelled',version,$2,$3
       FROM updated`,
      [commentId, reason, now],
    )
  }

  private async applyVisibleCommentDelta(
    client: PoolClient,
    projectId: string,
    delta: number,
    watermark: string,
  ): Promise<void> {
    if (delta === 0) return
    await client.query(
      `INSERT INTO catalog.project_interaction_counters (project_id,source_watermark)
       VALUES ($1,$2) ON CONFLICT (project_id) DO NOTHING`,
      [projectId, watermark],
    )
    const updated = await client.query(
      `UPDATE catalog.project_interaction_counters
       SET visible_comment_count=visible_comment_count+$2,source_watermark=$3
       WHERE project_id=$1 RETURNING visible_comment_count`,
      [projectId, delta, watermark],
    )
    if (updated.rowCount !== 1) throw communityError('COMMENT_COUNTER_STATE_INVALID', 500, true)
  }

  private async outbox(
    client: PoolClient,
    input: {
      readonly aggregateId: string
      readonly eventName: string
      readonly payload: Readonly<Record<string, unknown>>
      readonly now: Date
      readonly transactionId?: string
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO ops.outbox_events (
         event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
         transaction_id,created_at,next_attempt_at
       ) VALUES ($1,'comment',$2,$3,1,$4::jsonb,$5,$6,$6)`,
      [
        randomUUID(), input.aggregateId, input.eventName, JSON.stringify(input.payload),
        input.transactionId ?? randomUUID(), input.now,
      ],
    )
  }

  private moderationOutbox(
    client: PoolClient,
    row: CommentRow,
    previousState: CommentModerationState,
    resultingState: CommentModerationState,
    decisionId: string,
    countDelta: number,
    reasonCode: string,
    ruleVersion: string | null,
    now: Date,
    transactionId?: string,
  ): Promise<void> {
    return this.outbox(client, {
      aggregateId: row.comment_id,
      eventName: 'comment_moderation_changed',
      payload: {
        project_id: row.project_id,
        comment_id: row.comment_id,
        previous_status: previousState,
        resulting_status: resultingState,
        decision_id: decisionId,
        count_delta: countDelta,
        reason_code: reasonCode,
        rule_version: ruleVersion,
        result: 'changed',
      },
      now,
      ...(transactionId === undefined ? {} : { transactionId }),
    })
  }

  private assertModerationTransition(
    current: CommentModerationState,
    next: Exclude<CommentModerationState, 'author_withdrawn'>,
    actorType: 'system' | 'platform_editor' | 'admin',
  ): void {
    if (current === next) return
    const systemTransitions: Readonly<Record<string, readonly CommentModerationState[]>> = {
      pending: ['visible', 'under_review', 'rejected'],
      visible: ['under_review'],
      collapsed: ['under_review'],
    }
    const staffTransitions: Readonly<Record<string, readonly CommentModerationState[]>> = {
      visible: ['collapsed', 'under_review', 'hidden'],
      collapsed: ['visible', 'under_review', 'hidden'],
      under_review: ['visible', 'collapsed', 'hidden', 'rejected'],
      hidden: actorType === 'admin' ? ['visible', 'collapsed'] : [],
      pending: ['under_review', 'visible', 'rejected'],
    }
    const allowed = actorType === 'system' ? systemTransitions[current] : staffTransitions[current]
    if (!allowed?.includes(next)) throw communityError('COMMENT_MODERATION_TRANSITION_INVALID', 409)
  }

  private applyRequestedState(
    after: Record<ProjectInteractionType, boolean>,
    before: Readonly<Record<ProjectInteractionType, boolean>>,
    type: ProjectInteractionType,
    state: boolean,
    changes: ProjectInteractionFactChange[],
  ): void {
    const set = (
      interactionType: ProjectInteractionType,
      targetState: boolean,
      source: ProjectInteractionFactChange['source'],
    ) => {
      if (after[interactionType] === targetState) return
      after[interactionType] = targetState
      changes.push(Object.freeze({ interactionType, state: targetState, source }))
    }
    set(type, state, 'explicit')
    if (type === 'follow' && state) set('favorite', true, 'follow_cascade')
    if (type === 'favorite' && !state && before.follow) {
      set('follow', false, 'favorite_cascade')
    }
  }

  private assertProjectWritable(row: ProjectRow | undefined): void {
    if (!row) throw communityError('PROJECT_NOT_FOUND', 404)
    if (row.review_status === 'restricted') {
      throw communityError('PROJECT_INTERACTION_FORBIDDEN', 403)
    }
    if (
      row.current_version_id === null ||
      row.review_status === 'archived' || row.review_status === 'deleted'
    ) throw communityError('PROJECT_NOT_AVAILABLE', 410)
    if (row.review_status !== 'published_platform' && row.review_status !== 'published_author') {
      throw communityError('PROJECT_INTERACTION_FORBIDDEN', 403)
    }
  }

  private counts(row: CounterRow | undefined): InteractionCounts {
    if (!row) throw communityError('INTERACTION_COUNTER_STATE_INVALID', 500, true)
    const counts = {
      favorite_count: Number(row.favorite_count),
      like_count: Number(row.like_count),
      follower_count: Number(row.follower_count),
    }
    if (Object.values(counts).some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw communityError('INTERACTION_COUNTER_STATE_INVALID', 500, true)
    }
    return Object.freeze(counts)
  }

  private projection(value: unknown): ProjectInteractionProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw communityError('INTERACTION_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as ProjectInteractionProjection
  }

  private async lock(client: PoolClient, key: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
  }
}
