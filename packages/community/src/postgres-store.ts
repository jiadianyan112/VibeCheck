import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { communityError } from './errors.js'
import type {
  ProjectInteractionFactChange,
  ProjectInteractionStore,
  SetStoredProjectInteractionInput,
} from './store-port.js'
import type {
  InteractionCounts,
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

const eventNames: Readonly<Record<ProjectInteractionType, string>> = Object.freeze({
  favorite: 'project_favorited',
  like: 'project_liked',
  follow: 'project_followed',
})

export class PostgresCommunityStore implements ProjectInteractionStore {
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
