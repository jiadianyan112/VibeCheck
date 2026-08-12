import type { CategoryId } from '@vibecheck/catalog'
import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { comparisonError } from './errors.js'
import type { ComparisonStore, ComparisonStoreOwner } from './store-port.js'
import type {
  ComparisonItemProjection,
  ComparisonMutationProjection,
  ComparisonProgressProjection,
  ComparisonProjectSummary,
  ComparisonProjection,
} from './types.js'

type Queryable = Pick<Pool | PoolClient, 'query'>

interface ComparisonRow extends QueryResultRow {
  readonly comparison_id: string
  readonly owner_user_id: string | null
  readonly anonymous_subject_hash: Buffer | null
  readonly category_id: CategoryId
  readonly category_schema_version: string
  readonly current_version: number
  readonly status: 'active' | 'expired' | 'deleted'
  readonly expires_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
  readonly comparison_dimension_map: unknown
  readonly completed_at: Date | null
}

interface ItemRow extends QueryResultRow {
  readonly project_id: string
  readonly position: number
  readonly current_name: string
  readonly category_id: CategoryId
  readonly current_version_id: string | null
  readonly review_status: string
  readonly access_status: string
  readonly freshness_status: string
  readonly last_verified_at: Date
  readonly category_data: unknown
}

interface ProgressRow extends QueryResultRow {
  readonly dimension_group: string
  readonly visible_ms: string | number
}

interface ReceiptRow extends QueryResultRow {
  readonly comparison_id: string
  readonly request_hash: string
  readonly response_json: ComparisonMutationProjection
}

interface ProjectValidationRow extends QueryResultRow {
  readonly project_id: string
  readonly position: number
  readonly category_id: CategoryId | null
  readonly category_schema_version: string | null
  readonly review_status: string | null
  readonly current_version_id: string | null
}

interface DimensionEventRow extends QueryResultRow {
  readonly comparison_id: string
  readonly comparison_version: number
  readonly dimension_group: string
  readonly view_sequence: number
  readonly visible_ms: number
  readonly subject_hash: Buffer
  readonly occurred_at: Date
}

export class PostgresComparisonStore implements ComparisonStore {
  constructor(private readonly pool: Pool) {}

  async getComparison(input: ComparisonStoreOwner & {
    readonly comparisonId: string
    readonly now: Date
  }): Promise<ComparisonProjection> {
    const row = await this.comparisonRow(this.pool, input.comparisonId)
    this.assertAccess(row, input, input.now)
    return this.projection(this.pool, row!, input)
  }

  async putComparison(input: ComparisonStoreOwner & {
    readonly comparisonId: string
    readonly orderedProjectIds: readonly string[]
    readonly expectedVersion: number
    readonly clientRequestId: string
    readonly requestHash: string
    readonly anonymousExpiresAt: Date
    readonly now: Date
  }): Promise<ComparisonMutationProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `comparison:${input.comparisonId}`,
      ])
      let row = await this.comparisonRow(client, input.comparisonId, true)
      if (row) this.assertAccess(row, input, input.now)

      const receipt = await client.query<ReceiptRow>(
        `SELECT comparison_id,request_hash,response_json
         FROM comparison.comparison_mutation_receipts
         WHERE client_request_id=$1 AND subject_hash=$2`,
        [input.clientRequestId, input.subjectHash],
      )
      if (receipt.rows[0]) {
        const stored = receipt.rows[0]
        if (stored.comparison_id !== input.comparisonId || stored.request_hash !== input.requestHash) {
          throw comparisonError('CLIENT_REQUEST_ID_CONFLICT', 409)
        }
        await client.query('COMMIT')
        return Object.freeze(stored.response_json)
      }

      if (row === null && input.expectedVersion !== 0) {
        throw comparisonError('COMPARISON_VERSION_CONFLICT', 409, false, undefined, {
          current_comparison_version: null,
          current_ordered_project_ids: [],
        })
      }
      if (row !== null && row.current_version !== input.expectedVersion) {
        const currentIds = await this.currentProjectIds(client, row)
        throw comparisonError('COMPARISON_VERSION_CONFLICT', 409, false, undefined, {
          current_comparison_version: row.current_version,
          current_ordered_project_ids: currentIds,
        })
      }

      const projects = await this.validateProjects(client, input.orderedProjectIds)
      const categoryId = row?.category_id ?? projects[0]!.category_id!
      const categorySchemaVersion = row?.category_schema_version ?? projects[0]!.category_schema_version!
      if (projects.some(({ category_id }) => category_id !== categoryId)) {
        throw comparisonError('COMPARISON_CATEGORY_MISMATCH', 422)
      }
      if (projects.some(({ category_schema_version }) => (
        category_schema_version !== categorySchemaVersion
      ))) throw comparisonError('COMPARISON_SCHEMA_MISMATCH', 422)

      if (row !== null) {
        const currentIds = await this.currentProjectIds(client, row)
        if (this.sameOrder(currentIds, input.orderedProjectIds)) {
          if (input.subject.kind === 'anonymous') {
            await client.query(
              `UPDATE comparison.comparisons SET expires_at=$2
               WHERE comparison_id=$1 AND expires_at < $2`,
              [input.comparisonId, input.anonymousExpiresAt],
            )
            row = await this.comparisonRow(client, input.comparisonId, true)
          }
          const projection = Object.freeze({
            ...await this.projection(client, row!, input),
            mutation_result: 'no_change' as const,
          })
          await this.saveMutationReceipt(client, input, projection)
          await client.query('COMMIT')
          return projection
        }
      }

      const nextVersion = row === null ? 1 : row.current_version + 1
      if (row === null) {
        await client.query(
          `INSERT INTO comparison.comparisons (
             comparison_id,owner_user_id,anonymous_subject_hash,category_id,
             category_schema_version,current_version,status,expires_at,created_at,updated_at
           ) VALUES ($1,$2,$3,$4,$5,1,'active',$6,$7,$7)`,
          [
            input.comparisonId,
            input.subject.kind === 'user' ? input.subject.id : null,
            input.subject.kind === 'anonymous' ? input.subjectHash : null,
            categoryId,
            categorySchemaVersion,
            input.subject.kind === 'anonymous' ? input.anonymousExpiresAt : null,
            input.now,
          ],
        )
      } else {
        await client.query(
          `UPDATE comparison.comparisons
           SET current_version=$2,updated_at=$3,
             expires_at=CASE WHEN anonymous_subject_hash IS NULL THEN expires_at ELSE $4 END
           WHERE comparison_id=$1`,
          [input.comparisonId, nextVersion, input.now, input.anonymousExpiresAt],
        )
      }
      await client.query(
        `INSERT INTO comparison.comparison_versions (
           comparison_id,comparison_version,item_count,created_at
         ) VALUES ($1,$2,$3,$4)`,
        [input.comparisonId, nextVersion, input.orderedProjectIds.length, input.now],
      )
      for (let index = 0; index < input.orderedProjectIds.length; index += 1) {
        await client.query(
          `INSERT INTO comparison.comparison_items (
             comparison_id,comparison_version,project_id,position,validity_status,added_at
           ) VALUES ($1,$2,$3,$4,'valid',$5)`,
          [input.comparisonId, nextVersion, input.orderedProjectIds[index], index + 1, input.now],
        )
      }
      row = await this.comparisonRow(client, input.comparisonId, true)
      const projection = Object.freeze({
        ...await this.projection(client, row!, input),
        mutation_result: row && nextVersion === 1 ? 'created' as const : 'changed' as const,
      })
      await this.saveMutationReceipt(client, input, projection)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async setSaved(input: ComparisonStoreOwner & {
    readonly comparisonId: string
    readonly comparisonVersion: number
    readonly state: boolean
    readonly requestId: string
    readonly now: Date
  }): Promise<ComparisonProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `comparison:${input.comparisonId}`,
      ])
      const row = await this.comparisonRow(client, input.comparisonId, true)
      this.assertAccess(row, input, input.now)
      if (input.subject.kind !== 'user' || row!.owner_user_id !== input.subject.id) {
        throw comparisonError('COMPARISON_FORBIDDEN', 403)
      }
      if (row!.current_version !== input.comparisonVersion) {
        throw comparisonError('COMPARISON_VERSION_CONFLICT', 409, false, undefined, {
          current_comparison_version: row!.current_version,
          current_ordered_project_ids: await this.currentProjectIds(client, row!),
        })
      }
      const existing = await client.query<{ state: boolean; saved_at: Date | null }>(
        `SELECT state,saved_at FROM comparison.comparison_saves
         WHERE comparison_id=$1 AND comparison_version=$2 AND user_id=$3
         FOR UPDATE`,
        [input.comparisonId, input.comparisonVersion, input.subject.id],
      )
      const changed = existing.rows[0]?.state !== input.state
      if (changed) {
        await client.query(
          `INSERT INTO comparison.comparison_saves (
             comparison_id,comparison_version,user_id,state,saved_at,updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (comparison_id,comparison_version,user_id) DO UPDATE
           SET state=EXCLUDED.state,saved_at=EXCLUDED.saved_at,updated_at=EXCLUDED.updated_at`,
          [
            input.comparisonId, input.comparisonVersion, input.subject.id,
            input.state, input.state ? input.now : null, input.now,
          ],
        )
        await client.query(
          'UPDATE comparison.comparisons SET updated_at=$2 WHERE comparison_id=$1',
          [input.comparisonId, input.now],
        )
        await client.query(
          `INSERT INTO audit.security_events (
             event_type,severity,actor_user_id_hash,target_type,target_id_hash,
             metadata_json,request_id,created_at
           ) VALUES ('comparison_saved_state_changed','info',$1,'comparison',
             digest($2::text,'sha256'),$3,$4,$5)`,
          [
            input.subjectHash,
            input.comparisonId,
            { comparison_version: input.comparisonVersion, target_state: input.state },
            input.requestId,
            input.now,
          ],
        )
      }
      const current = await this.comparisonRow(client, input.comparisonId, true)
      const projection = await this.projection(client, current!, input)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async recordDimensionProgress(input: ComparisonStoreOwner & {
    readonly eventId: string
    readonly comparisonId: string
    readonly comparisonVersion: number
    readonly dimensionGroup: string
    readonly visibleMs: number
    readonly viewSequence: number
    readonly occurredAt: Date
    readonly now: Date
  }): Promise<ComparisonProgressProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `comparison:${input.comparisonId}`,
      ])
      const row = await this.comparisonRow(client, input.comparisonId, true)
      this.assertAccess(row, input, input.now)
      if (row!.current_version !== input.comparisonVersion) {
        throw comparisonError('COMPARISON_VERSION_CONFLICT', 409, false, undefined, {
          current_comparison_version: row!.current_version,
          current_ordered_project_ids: await this.currentProjectIds(client, row!),
        })
      }
      const dimensionGroups = this.dimensionGroups(row!.comparison_dimension_map)
      if (!dimensionGroups.includes(input.dimensionGroup)) {
        throw comparisonError('COMPARISON_DIMENSION_INVALID', 422)
      }

      const existingEvent = await client.query<DimensionEventRow>(
        `SELECT comparison_id,comparison_version,dimension_group,view_sequence,visible_ms,
           subject_hash,occurred_at
         FROM comparison.comparison_dimension_events WHERE event_id=$1`,
        [input.eventId],
      )
      if (existingEvent.rows[0]) {
        const event = existingEvent.rows[0]
        if (
          event.comparison_id !== input.comparisonId ||
          event.comparison_version !== input.comparisonVersion ||
          event.dimension_group !== input.dimensionGroup ||
          event.view_sequence !== input.viewSequence ||
          event.visible_ms !== input.visibleMs ||
          !event.subject_hash.equals(input.subjectHash) ||
          event.occurred_at.getTime() !== input.occurredAt.getTime()
        ) throw comparisonError('COMPARISON_PROGRESS_EVENT_CONFLICT', 409)
        const projection = await this.progressProjection(client, row!, false, true)
        await client.query('COMMIT')
        return projection
      }
      const sequence = await client.query<{ event_id: string }>(
        `SELECT event_id FROM comparison.comparison_dimension_events
         WHERE comparison_id=$1 AND comparison_version=$2
           AND dimension_group=$3 AND view_sequence=$4`,
        [input.comparisonId, input.comparisonVersion, input.dimensionGroup, input.viewSequence],
      )
      if (sequence.rows[0]) throw comparisonError('COMPARISON_PROGRESS_SEQUENCE_CONFLICT', 409)

      await client.query(
        `INSERT INTO comparison.comparison_dimension_progress (
           comparison_id,comparison_version,dimension_group,visible_ms,last_view_sequence,last_event_at
         ) VALUES ($1,$2,$3,0,0,$4)
         ON CONFLICT (comparison_id,comparison_version,dimension_group) DO NOTHING`,
        [input.comparisonId, input.comparisonVersion, input.dimensionGroup, input.occurredAt],
      )
      await client.query(
        `INSERT INTO comparison.comparison_dimension_events (
           event_id,comparison_id,comparison_version,dimension_group,view_sequence,
           visible_ms,subject_hash,occurred_at,received_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.eventId, input.comparisonId, input.comparisonVersion, input.dimensionGroup,
          input.viewSequence, input.visibleMs, input.subjectHash, input.occurredAt, input.now,
        ],
      )
      await client.query(
        `UPDATE comparison.comparison_dimension_progress
         SET visible_ms=visible_ms+$4,
           last_view_sequence=GREATEST(last_view_sequence,$5),last_event_at=$6
         WHERE comparison_id=$1 AND comparison_version=$2 AND dimension_group=$3`,
        [
          input.comparisonId, input.comparisonVersion, input.dimensionGroup,
          input.visibleMs, input.viewSequence, input.occurredAt,
        ],
      )
      const totals = await this.progressTotals(client, row!)
      const validCount = await this.validItemCount(client, row!)
      let completedNow = false
      if (
        validCount >= 2 && validCount <= 5 &&
        totals.dimensionGroupsViewed.length >= 4 && totals.visibleDurationMs >= 30_000 &&
        row!.completed_at === null
      ) {
        const completed = await client.query(
          `UPDATE comparison.comparison_versions SET completed_at=$3
           WHERE comparison_id=$1 AND comparison_version=$2 AND completed_at IS NULL
           RETURNING completed_at`,
          [input.comparisonId, input.comparisonVersion, input.now],
        )
        completedNow = completed.rowCount === 1
        if (completedNow) {
          await client.query(
            `INSERT INTO ops.outbox_events (
               event_id,aggregate_type,aggregate_id,event_name,event_version,
               payload_json,transaction_id,created_at,next_attempt_at
             ) VALUES (
               gen_random_uuid(),'comparison',$1::text,'comparison_completed',1,
               jsonb_build_object(
                 'comparison_id',$1::text,
                 'comparison_version',$2,
                 'valid_project_count',$3,
                 'dimension_group_count',$4,
                 'visible_duration_ms',$5,
                 'completed_at',$6::timestamptz
               ),gen_random_uuid(),$6,$6
             )`,
            [
              input.comparisonId,
              input.comparisonVersion,
              validCount,
              totals.dimensionGroupsViewed.length,
              totals.visibleDurationMs,
              input.now,
            ],
          )
        }
      }
      const current = await this.comparisonRow(client, input.comparisonId, true)
      const projection = await this.progressProjection(client, current!, completedNow, false)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async comparisonRow(
    queryable: Queryable,
    comparisonId: string,
    forUpdate = false,
  ): Promise<ComparisonRow | null> {
    const result = await queryable.query<ComparisonRow>(
      `SELECT comparison.comparison_id,comparison.owner_user_id,
         comparison.anonymous_subject_hash,comparison.category_id,
         comparison.category_schema_version,comparison.current_version,
         comparison.status,comparison.expires_at,comparison.created_at,comparison.updated_at,
         schema.comparison_dimension_map,version.completed_at
       FROM comparison.comparisons comparison
       JOIN taxonomy.category_schema_versions schema
         ON schema.category_id=comparison.category_id
        AND schema.schema_version=comparison.category_schema_version
       JOIN comparison.comparison_versions version
         ON version.comparison_id=comparison.comparison_id
        AND version.comparison_version=comparison.current_version
       WHERE comparison.comparison_id=$1${forUpdate ? ' FOR UPDATE OF comparison' : ''}`,
      [comparisonId],
    )
    return result.rows[0] ?? null
  }

  private assertAccess(
    row: ComparisonRow | null,
    owner: ComparisonStoreOwner,
    now: Date,
  ): void {
    if (!row) throw comparisonError('COMPARISON_NOT_FOUND', 404)
    if (row.status !== 'active' || row.expires_at !== null && row.expires_at <= now) {
      throw comparisonError('COMPARISON_GONE', 410)
    }
    const allowed = owner.subject.kind === 'user'
      ? row.owner_user_id === owner.subject.id
      : row.anonymous_subject_hash?.equals(owner.subjectHash) === true
    if (!allowed) throw comparisonError('COMPARISON_FORBIDDEN', 403)
  }

  private async validateProjects(
    queryable: Queryable,
    orderedProjectIds: readonly string[],
  ): Promise<readonly ProjectValidationRow[]> {
    if (orderedProjectIds.length === 0) return Object.freeze([])
    const result = await queryable.query<ProjectValidationRow>(
      `SELECT requested.project_id::text,requested.ordinality::int AS position,
         project.category_id,project.category_schema_version,project.review_status,
         project.current_version_id
       FROM unnest($1::uuid[]) WITH ORDINALITY requested(project_id,ordinality)
       LEFT JOIN catalog.projects project ON project.project_id=requested.project_id
       ORDER BY requested.ordinality`,
      [orderedProjectIds],
    )
    for (const project of result.rows) {
      if (project.category_id === null) throw comparisonError('PROJECT_NOT_FOUND', 404)
      if (project.review_status === 'deleted') throw comparisonError('PROJECT_DELETED', 410)
      if (!['published_platform', 'published_author'].includes(project.review_status ?? '')) {
        throw comparisonError('PROJECT_NOT_PUBLIC', 403)
      }
      if (project.current_version_id === null) {
        throw comparisonError('PROJECT_VERSION_UNAVAILABLE', 503, true)
      }
    }
    return Object.freeze(result.rows)
  }

  private async currentProjectIds(
    queryable: Queryable,
    row: ComparisonRow,
  ): Promise<readonly string[]> {
    const result = await queryable.query<{ project_id: string }>(
      `SELECT project_id FROM comparison.comparison_items
       WHERE comparison_id=$1 AND comparison_version=$2 ORDER BY position`,
      [row.comparison_id, row.current_version],
    )
    return Object.freeze(result.rows.map(({ project_id }) => project_id))
  }

  private sameOrder(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private async saveMutationReceipt(
    client: PoolClient,
    input: ComparisonStoreOwner & {
      readonly clientRequestId: string
      readonly comparisonId: string
      readonly requestHash: string
      readonly now: Date
    },
    projection: ComparisonMutationProjection,
  ): Promise<void> {
    await client.query(
      `INSERT INTO comparison.comparison_mutation_receipts (
         client_request_id,subject_hash,comparison_id,request_hash,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.clientRequestId, input.subjectHash, input.comparisonId,
        input.requestHash, projection, input.now,
      ],
    )
  }

  private async projection(
    queryable: Queryable,
    row: ComparisonRow,
    owner: ComparisonStoreOwner,
  ): Promise<ComparisonProjection> {
    const itemResult = await queryable.query<ItemRow>(
      `SELECT item.project_id,item.position,project.current_name,project.category_id,
         project.current_version_id,project.review_status,project.access_status,
         project.freshness_status,project.last_verified_at,
         version.snapshot_json->'category_data' AS category_data
       FROM comparison.comparison_items item
       JOIN catalog.projects project ON project.project_id=item.project_id
       LEFT JOIN catalog.project_versions version ON version.version_id=project.current_version_id
       WHERE item.comparison_id=$1 AND item.comparison_version=$2
       ORDER BY item.position`,
      [row.comparison_id, row.current_version],
    )
    const dimensions = this.dimensionMap(row.comparison_dimension_map)
    const items = Object.freeze(itemResult.rows.map((item) => this.itemProjection(item, dimensions)))
    const totals = await this.progressTotals(queryable, row)
    let savedAt: Date | null = null
    if (owner.subject.kind === 'user') {
      const save = await queryable.query<{ saved_at: Date | null }>(
        `SELECT saved_at FROM comparison.comparison_saves
         WHERE comparison_id=$1 AND comparison_version=$2 AND user_id=$3 AND state=true`,
        [row.comparison_id, row.current_version, owner.subject.id],
      )
      savedAt = save.rows[0]?.saved_at ?? null
    }
    const validCount = items.filter(({ validity_status }) => validity_status === 'valid').length
    return Object.freeze({
      comparison_id: row.comparison_id,
      comparison_version: row.current_version,
      category_id: row.category_id,
      category_schema_version: row.category_schema_version,
      ordered_project_ids: Object.freeze(items.map(({ project_id }) => project_id)),
      items,
      valid_count: validCount,
      invalid_count: items.length - validCount,
      dimension_groups: Object.freeze(Object.keys(dimensions)),
      dimension_groups_viewed: totals.dimensionGroupsViewed,
      visible_duration_ms: totals.visibleDurationMs,
      saved_at: savedAt?.toISOString() ?? null,
      completed_at: row.completed_at?.toISOString() ?? null,
      expires_at: row.expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private itemProjection(
    item: ItemRow,
    dimensionMap: Readonly<Record<string, readonly string[]>>,
  ): ComparisonItemProjection {
    const invalidReason = item.review_status === 'restricted'
      ? 'PROJECT_RESTRICTED'
      : item.review_status === 'archived'
        ? 'PROJECT_ARCHIVED'
        : item.review_status === 'deleted'
          ? 'PROJECT_DELETED'
          : item.current_version_id === null ? 'PROJECT_VERSION_UNAVAILABLE' : null
    if (invalidReason !== null) {
      return Object.freeze({
        project_id: item.project_id,
        position: item.position,
        validity_status: 'invalid',
        invalid_reason: invalidReason,
        canonical_project_id: null,
        project: null,
      })
    }
    const categoryData = this.record(item.category_data)
    const comparisonValues: Record<string, Readonly<Record<string, unknown>>> = {}
    for (const [group, fields] of Object.entries(dimensionMap)) {
      const values: Record<string, unknown> = {}
      for (const field of fields) values[field] = categoryData[field] ?? null
      comparisonValues[group] = Object.freeze(values)
    }
    const project: ComparisonProjectSummary = Object.freeze({
      project_id: item.project_id,
      current_name: item.current_name,
      category_id: item.category_id,
      access_status: item.access_status,
      freshness_status: item.freshness_status,
      last_verified_at: item.last_verified_at.toISOString(),
      current_version_id: item.current_version_id!,
      comparison_values: Object.freeze(comparisonValues),
    })
    return Object.freeze({
      project_id: item.project_id,
      position: item.position,
      validity_status: 'valid',
      invalid_reason: null,
      canonical_project_id: null,
      project,
    })
  }

  private dimensionMap(value: unknown): Readonly<Record<string, readonly string[]>> {
    const record = this.record(value)
    const dimensions: Record<string, readonly string[]> = {}
    for (const [key, fields] of Object.entries(record)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !Array.isArray(fields)) {
        throw comparisonError('COMPARISON_DIMENSION_CONFIG_INVALID', 500, true)
      }
      const parsed = fields.filter((field): field is string => typeof field === 'string')
      if (parsed.length !== fields.length || parsed.length === 0) {
        throw comparisonError('COMPARISON_DIMENSION_CONFIG_INVALID', 500, true)
      }
      dimensions[key] = Object.freeze(parsed)
    }
    if (Object.keys(dimensions).length < 4) {
      throw comparisonError('COMPARISON_DIMENSION_CONFIG_INVALID', 500, true)
    }
    return Object.freeze(dimensions)
  }

  private dimensionGroups(value: unknown): readonly string[] {
    return Object.freeze(Object.keys(this.dimensionMap(value)))
  }

  private record(value: unknown): Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({})
    return value as Readonly<Record<string, unknown>>
  }

  private async progressTotals(
    queryable: Queryable,
    row: ComparisonRow,
  ): Promise<{ readonly dimensionGroupsViewed: readonly string[]; readonly visibleDurationMs: number }> {
    const result = await queryable.query<ProgressRow>(
      `SELECT dimension_group,visible_ms FROM comparison.comparison_dimension_progress
       WHERE comparison_id=$1 AND comparison_version=$2 AND visible_ms >= 1000
       ORDER BY dimension_group`,
      [row.comparison_id, row.current_version],
    )
    const visibleDurationMs = result.rows.reduce((total, item) => total + Number(item.visible_ms), 0)
    if (!Number.isSafeInteger(visibleDurationMs) || visibleDurationMs < 0) {
      throw comparisonError('COMPARISON_PROGRESS_STATE_INVALID', 500, true)
    }
    return Object.freeze({
      dimensionGroupsViewed: Object.freeze(result.rows.map(({ dimension_group }) => dimension_group)),
      visibleDurationMs,
    })
  }

  private async validItemCount(queryable: Queryable, row: ComparisonRow): Promise<number> {
    const result = await queryable.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM comparison.comparison_items item
       JOIN catalog.projects project ON project.project_id=item.project_id
       WHERE item.comparison_id=$1 AND item.comparison_version=$2
         AND project.review_status IN ('published_platform','published_author')
         AND project.current_version_id IS NOT NULL`,
      [row.comparison_id, row.current_version],
    )
    return result.rows[0]?.count ?? 0
  }

  private async progressProjection(
    queryable: Queryable,
    row: ComparisonRow,
    completedNow: boolean,
    deduplicated: boolean,
  ): Promise<ComparisonProgressProjection> {
    const totals = await this.progressTotals(queryable, row)
    return Object.freeze({
      comparison_id: row.comparison_id,
      comparison_version: row.current_version,
      dimension_groups_viewed: totals.dimensionGroupsViewed,
      visible_duration_ms: totals.visibleDurationMs,
      completed_at: row.completed_at?.toISOString() ?? null,
      completed_now: completedNow,
      deduplicated,
    })
  }
}
