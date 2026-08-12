import type { CategoryId } from '@vibecheck/catalog'
import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { comparisonError } from './errors.js'
import type { ComparisonStore, ComparisonStoreOwner } from './store-port.js'
import type {
  ComparisonLoginMergeProjection,
  ComparisonMergeCancellationProjection,
  ComparisonMergeConflictProjection,
  ComparisonMergeProjectSummary,
  ComparisonMergeResolutionProjection,
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

interface IdentityLinkRow extends QueryResultRow {
  readonly identity_link_id: string
  readonly anonymous_subject_id: string
  readonly user_id: string
  readonly auth_flow_id: string
  readonly purpose: string
  readonly status: 'active' | 'consumed' | 'revoked' | 'expired'
  readonly expires_at: Date
}

interface ActiveComparisonRow extends QueryResultRow {
  readonly comparison_id: string
}

interface LoginMergeReceiptRow extends QueryResultRow {
  readonly operation_id: string
  readonly response_json: ComparisonLoginMergeProjection
}

interface MergeConflictRow extends QueryResultRow {
  readonly conflict_id: string
  readonly identity_link_id: string
  readonly user_id: string
  readonly account_comparison_id: string
  readonly account_comparison_version: number
  readonly anonymous_comparison_id: string
  readonly anonymous_comparison_version: number
  readonly candidate_project_ids: string[]
  readonly selected_project_ids: string[] | null
  readonly pending_action_id: string | null
  readonly status: 'pending' | 'resolved' | 'cancelled' | 'expired'
  readonly version: number
  readonly expires_at: Date
  readonly resolved_at: Date | null
  readonly cancelled_at: Date | null
}

interface MergeOperationReceiptRow extends QueryResultRow {
  readonly operation_type: 'resolve' | 'cancel'
  readonly request_hash: string
  readonly response_json: ComparisonMergeResolutionProjection | ComparisonMergeCancellationProjection
}

interface MergeProjectSummaryRow extends QueryResultRow {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly access_status: string
  readonly freshness_status: string
  readonly last_verified_at: Date
  readonly review_status: string
  readonly current_version_id: string | null
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
          await this.setActiveComparison(client, input, input.comparisonId, input.now)
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
      await this.setActiveComparison(client, input, input.comparisonId, input.now)
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
                 'comparison_version',$2::integer,
                 'valid_project_count',$3::integer,
                 'dimension_group_count',$4::integer,
                 'visible_duration_ms',$5::bigint,
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

  async prepareLoginMerge(input: {
    readonly userId: string
    readonly userSubjectHash: Buffer
    readonly anonymousSubjectId: string
    readonly anonymousSubjectHash: Buffer
    readonly identityLinkId: string
    readonly operationId: string
    readonly pendingActionId: string | null
    readonly adoptedComparisonId: string
    readonly conflictId: string
    readonly now: Date
  }): Promise<ComparisonLoginMergeProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `comparison-login-merge:${input.identityLinkId}`,
      ])
      const receipt = await client.query<LoginMergeReceiptRow>(
        `SELECT operation_id,response_json
         FROM comparison.comparison_login_merge_receipts WHERE identity_link_id=$1`,
        [input.identityLinkId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].operation_id !== input.operationId) {
          throw comparisonError('OPERATION_ID_CONFLICT', 409)
        }
        await client.query('COMMIT')
        return Object.freeze(receipt.rows[0].response_json)
      }

      const link = await this.identityLink(client, input.identityLinkId, true)
      this.assertMergeIdentityLink(link, input.userId, input.anonymousSubjectId, input.now)
      if (input.pendingActionId !== null) {
        await this.assertPendingActionBinding(
          client,
          input.pendingActionId,
          link!,
          input.userId,
          input.anonymousSubjectId,
          input.now,
        )
      }
      const anonymous = await this.activeComparison(
        client,
        { kind: 'anonymous', hash: input.anonymousSubjectHash },
        true,
      )
      const account = await this.activeComparison(
        client,
        { kind: 'user', id: input.userId },
        true,
      )
      const anonymousActive = anonymous !== null && this.isActiveAt(anonymous, input.now)
        ? anonymous
        : null
      const accountActive = account !== null && this.isActiveAt(account, input.now)
        ? account
        : null

      if (anonymousActive === null) {
        const projection = Object.freeze({
          result: 'not_required' as const,
          comparison_id: accountActive?.comparison_id ?? null,
          comparison_version: accountActive?.current_version ?? null,
          conflict_id: null,
          conflict_version: null,
          expires_at: null,
        })
        await this.finishLoginMerge(client, input, projection, true)
        await client.query('COMMIT')
        return projection
      }

      const anonymousIds = await this.currentProjectIds(client, anonymousActive)
      if (anonymousIds.length === 0) {
        const projection = Object.freeze({
          result: 'not_required' as const,
          comparison_id: accountActive?.comparison_id ?? null,
          comparison_version: accountActive?.current_version ?? null,
          conflict_id: null,
          conflict_version: null,
          expires_at: null,
        })
        await this.finishLoginMerge(client, input, projection, true)
        await client.query('COMMIT')
        return projection
      }

      const accountIds = accountActive === null
        ? Object.freeze([]) as readonly string[]
        : await this.currentProjectIds(client, accountActive)
      if (accountActive === null || accountIds.length === 0) {
        await this.createUserComparisonCopy(
          client,
          input.adoptedComparisonId,
          input.userId,
          anonymousActive,
          anonymousIds,
          input.now,
        )
        const projection = Object.freeze({
          result: 'adopted' as const,
          comparison_id: input.adoptedComparisonId,
          comparison_version: 1,
          conflict_id: null,
          conflict_version: null,
          expires_at: null,
        })
        await this.insertMergeSecurityEvent(
          client,
          'comparison_login_merged',
          input.userSubjectHash,
          'comparison',
          input.adoptedComparisonId,
          { result: 'adopted', comparison_version: 1 },
          input.operationId,
          input.now,
        )
        await this.finishLoginMerge(client, input, projection, true)
        await client.query('COMMIT')
        return projection
      }

      if (
        accountActive.category_id !== anonymousActive.category_id ||
        accountActive.category_schema_version !== anonymousActive.category_schema_version
      ) {
        const projection = Object.freeze({
          result: 'not_required' as const,
          comparison_id: accountActive.comparison_id,
          comparison_version: accountActive.current_version,
          conflict_id: null,
          conflict_version: null,
          expires_at: null,
        })
        await this.insertMergeSecurityEvent(
          client,
          'comparison_login_merge_skipped',
          input.userSubjectHash,
          'comparison',
          accountActive.comparison_id,
          {
            reason: 'category_mismatch_account_preserved',
            account_category_id: accountActive.category_id,
            anonymous_category_id: anonymousActive.category_id,
          },
          input.operationId,
          input.now,
        )
        await this.finishLoginMerge(client, input, projection, true)
        await client.query('COMMIT')
        return projection
      }

      const candidateIds = Object.freeze([...new Set([...accountIds, ...anonymousIds])])
      if (candidateIds.length <= 5) {
        let nextVersion = accountActive.current_version
        let result: ComparisonLoginMergeProjection['result'] = 'not_required'
        if (!this.sameOrder(accountIds, candidateIds)) {
          nextVersion += 1
          await this.appendComparisonVersion(
            client,
            accountActive.comparison_id,
            nextVersion,
            candidateIds,
            input.now,
          )
          result = 'merged'
        }
        await this.setActiveComparison(client, {
          subject: { kind: 'user', id: input.userId },
          subjectHash: input.userSubjectHash,
        }, accountActive.comparison_id, input.now)
        const projection = Object.freeze({
          result,
          comparison_id: accountActive.comparison_id,
          comparison_version: nextVersion,
          conflict_id: null,
          conflict_version: null,
          expires_at: null,
        })
        if (result === 'merged') {
          await this.insertMergeSecurityEvent(
            client,
            'comparison_login_merged',
            input.userSubjectHash,
            'comparison',
            accountActive.comparison_id,
            { result, comparison_version: nextVersion, candidate_count: candidateIds.length },
            input.operationId,
            input.now,
          )
        }
        await this.finishLoginMerge(client, input, projection, true)
        await client.query('COMMIT')
        return projection
      }

      await client.query(
        `INSERT INTO comparison.comparison_merge_conflicts (
           conflict_id,identity_link_id,user_id,account_comparison_id,
           account_comparison_version,anonymous_comparison_id,
           anonymous_comparison_version,candidate_project_ids,status,version,
           pending_action_id,expires_at,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',1,$9,$10,$11,$11)`,
        [
          input.conflictId,
          input.identityLinkId,
          input.userId,
          accountActive.comparison_id,
          accountActive.current_version,
          anonymousActive.comparison_id,
          anonymousActive.current_version,
          candidateIds,
          input.pendingActionId,
          link!.expires_at,
          input.now,
        ],
      )
      const projection = Object.freeze({
        result: 'conflict' as const,
        comparison_id: accountActive.comparison_id,
        comparison_version: accountActive.current_version,
        conflict_id: input.conflictId,
        conflict_version: 1,
        expires_at: link!.expires_at.toISOString(),
      })
      await this.insertMergeSecurityEvent(
        client,
        'comparison_merge_conflict_created',
        input.userSubjectHash,
        'comparison_merge_conflict',
        input.conflictId,
        {
          candidate_count: candidateIds.length,
          account_comparison_version: accountActive.current_version,
          anonymous_comparison_version: anonymousActive.current_version,
        },
        input.operationId,
        input.now,
      )
      await this.finishLoginMerge(client, input, projection, false)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getMergeConflict(input: ComparisonStoreOwner & {
    readonly conflictId: string
    readonly now: Date
  }): Promise<ComparisonMergeConflictProjection> {
    const client = await this.pool.connect()
    let transactionFinished = false
    try {
      await client.query('BEGIN')
      const conflict = await this.mergeConflict(client, input.conflictId, true)
      await this.assertMergeConflictAccess(client, conflict, input, input.now)
      const current = await this.expireMergeConflictIfRequired(client, conflict!, input.now)
      if (current.status === 'expired') {
        await client.query('COMMIT')
        transactionFinished = true
        throw comparisonError('COMPARISON_MERGE_CONFLICT_GONE', 410)
      }
      const projection = await this.mergeConflictProjection(client, current)
      await client.query('COMMIT')
      transactionFinished = true
      return projection
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async resolveMergeConflict(input: ComparisonStoreOwner & {
    readonly conflictId: string
    readonly selectedProjectIds: readonly string[]
    readonly accountVersion: number
    readonly anonymousVersion: number
    readonly expectedConflictVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<ComparisonMergeResolutionProjection> {
    const client = await this.pool.connect()
    let transactionFinished = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `comparison-merge-conflict:${input.conflictId}`,
      ])
      const receipt = await this.mergeOperationReceipt(client, input.conflictId, input.operationId)
      if (receipt !== null) {
        if (receipt.operation_type !== 'resolve' || receipt.request_hash !== input.requestHash) {
          throw comparisonError('OPERATION_ID_CONFLICT', 409)
        }
        await client.query('COMMIT')
        transactionFinished = true
        return Object.freeze(receipt.response_json as ComparisonMergeResolutionProjection)
      }
      let conflict = await this.mergeConflict(client, input.conflictId, true)
      await this.assertMergeConflictAccess(client, conflict, input, input.now)
      conflict = await this.expireMergeConflictIfRequired(client, conflict!, input.now)
      if (conflict.status === 'expired') {
        await client.query('COMMIT')
        transactionFinished = true
        throw comparisonError('COMPARISON_MERGE_CONFLICT_GONE', 410)
      }
      if (conflict.status !== 'pending') throw comparisonError('COMPARISON_MERGE_CONFLICT_TERMINAL', 409)
      if (conflict.version !== input.expectedConflictVersion) {
        throw comparisonError('COMPARISON_MERGE_CONFLICT_VERSION_CONFLICT', 409, false, undefined, {
          current_conflict_version: conflict.version,
          current_status: conflict.status,
        })
      }
      if (
        conflict.account_comparison_version !== input.accountVersion ||
        conflict.anonymous_comparison_version !== input.anonymousVersion
      ) throw comparisonError('COMPARISON_VERSION_CONFLICT', 409)

      const account = await this.comparisonRow(client, conflict.account_comparison_id, true)
      const anonymous = await this.comparisonRow(client, conflict.anonymous_comparison_id, true)
      if (account === null || anonymous === null) throw comparisonError('COMPARISON_MERGE_STATE_INVALID', 500, true)
      if (
        account.current_version !== input.accountVersion ||
        anonymous.current_version !== input.anonymousVersion
      ) {
        throw comparisonError('COMPARISON_VERSION_CONFLICT', 409, false, undefined, {
          current_account_version: account.current_version,
          current_anonymous_version: anonymous.current_version,
          current_account_project_ids: await this.currentProjectIds(client, account),
          current_anonymous_project_ids: await this.currentProjectIds(client, anonymous),
        })
      }
      const currentCandidates = Object.freeze([...new Set([
        ...await this.currentProjectIds(client, account),
        ...await this.currentProjectIds(client, anonymous),
      ])])
      if (!this.sameOrder(currentCandidates, conflict.candidate_project_ids)) {
        throw comparisonError('COMPARISON_MERGE_CANDIDATES_CHANGED', 409)
      }
      if (input.selectedProjectIds.some((id) => !conflict.candidate_project_ids.includes(id))) {
        throw comparisonError('COMPARISON_MERGE_SELECTION_INVALID', 422)
      }
      const selected = await this.validateProjects(client, input.selectedProjectIds)
      if (selected.some(({ category_id }) => category_id !== account.category_id)) {
        throw comparisonError('COMPARISON_CATEGORY_MISMATCH', 422)
      }
      const nextComparisonVersion = account.current_version + 1
      await this.appendComparisonVersion(
        client,
        account.comparison_id,
        nextComparisonVersion,
        input.selectedProjectIds,
        input.now,
      )
      await this.setActiveComparison(client, input, account.comparison_id, input.now)
      const updated = await client.query<MergeConflictRow>(
        `UPDATE comparison.comparison_merge_conflicts
         SET selected_project_ids=$2,status='resolved',version=version+1,
           resolved_at=$3,updated_at=$3
         WHERE conflict_id=$1
         RETURNING conflict_id,identity_link_id,user_id,account_comparison_id,
           account_comparison_version,anonymous_comparison_id,anonymous_comparison_version,
           candidate_project_ids,selected_project_ids,pending_action_id,status,version,
           expires_at,resolved_at,cancelled_at`,
        [input.conflictId, input.selectedProjectIds, input.now],
      )
      await client.query(
        `UPDATE iam.identity_links SET status='consumed',consumed_at=$2
         WHERE identity_link_id=$1 AND status='active'`,
        [conflict.identity_link_id, input.now],
      )
      const projection = Object.freeze({
        conflict_id: input.conflictId,
        status: 'resolved' as const,
        conflict_version: updated.rows[0]!.version,
        comparison_id: account.comparison_id,
        comparison_version: nextComparisonVersion,
        selected_project_ids: Object.freeze([...input.selectedProjectIds]),
        resolved_at: input.now.toISOString(),
      })
      await this.insertMergeSecurityEvent(
        client,
        'comparison_merge_conflict_resolved',
        input.subjectHash,
        'comparison_merge_conflict',
        input.conflictId,
        {
          conflict_version: updated.rows[0]!.version,
          comparison_version: nextComparisonVersion,
          selected_count: input.selectedProjectIds.length,
        },
        input.operationId,
        input.now,
      )
      await this.saveMergeOperationReceipt(client, input, 'resolve', projection)
      await client.query('COMMIT')
      transactionFinished = true
      return projection
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async cancelMergeConflict(input: ComparisonStoreOwner & {
    readonly conflictId: string
    readonly cancelReason: string
    readonly expectedConflictVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<ComparisonMergeCancellationProjection> {
    const client = await this.pool.connect()
    let transactionFinished = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `comparison-merge-conflict:${input.conflictId}`,
      ])
      const receipt = await this.mergeOperationReceipt(client, input.conflictId, input.operationId)
      if (receipt !== null) {
        if (receipt.operation_type !== 'cancel' || receipt.request_hash !== input.requestHash) {
          throw comparisonError('OPERATION_ID_CONFLICT', 409)
        }
        await client.query('COMMIT')
        transactionFinished = true
        return Object.freeze(receipt.response_json as ComparisonMergeCancellationProjection)
      }
      let conflict = await this.mergeConflict(client, input.conflictId, true)
      await this.assertMergeConflictAccess(client, conflict, input, input.now)
      conflict = await this.expireMergeConflictIfRequired(client, conflict!, input.now)
      if (conflict.status === 'expired') {
        await client.query('COMMIT')
        transactionFinished = true
        throw comparisonError('COMPARISON_MERGE_CONFLICT_GONE', 410)
      }
      if (conflict.status === 'resolved') throw comparisonError('COMPARISON_MERGE_CONFLICT_TERMINAL', 409)
      if (conflict.status === 'cancelled') {
        const pendingActionStatus = await this.cancelPendingActionForMerge(client, conflict, input.now)
        const terminal = Object.freeze({
          conflict_id: conflict.conflict_id,
          status: 'cancelled' as const,
          conflict_version: conflict.version,
          cancelled_at: conflict.cancelled_at!.toISOString(),
          pending_action_status: pendingActionStatus,
        })
        await this.saveMergeOperationReceipt(client, input, 'cancel', terminal)
        await client.query('COMMIT')
        transactionFinished = true
        return terminal
      }
      if (conflict.version !== input.expectedConflictVersion) {
        throw comparisonError('COMPARISON_MERGE_CONFLICT_VERSION_CONFLICT', 409, false, undefined, {
          current_conflict_version: conflict.version,
          current_status: conflict.status,
        })
      }
      const updated = await client.query<MergeConflictRow>(
        `UPDATE comparison.comparison_merge_conflicts
         SET status='cancelled',version=version+1,cancelled_at=$2,
           cancel_reason=$3,updated_at=$2
         WHERE conflict_id=$1
         RETURNING conflict_id,identity_link_id,user_id,account_comparison_id,
           account_comparison_version,anonymous_comparison_id,anonymous_comparison_version,
           candidate_project_ids,selected_project_ids,pending_action_id,status,version,
           expires_at,resolved_at,cancelled_at`,
        [input.conflictId, input.now, input.cancelReason],
      )
      await client.query(
        `UPDATE iam.identity_links SET status='revoked',revoked_at=$2
         WHERE identity_link_id=$1 AND status='active'`,
        [conflict.identity_link_id, input.now],
      )
      const pendingActionStatus = await this.cancelPendingActionForMerge(client, conflict, input.now)
      const projection = Object.freeze({
        conflict_id: input.conflictId,
        status: 'cancelled' as const,
        conflict_version: updated.rows[0]!.version,
        cancelled_at: input.now.toISOString(),
        pending_action_status: pendingActionStatus,
      })
      await this.insertMergeSecurityEvent(
        client,
        'comparison_merge_conflict_cancelled',
        input.subjectHash,
        'comparison_merge_conflict',
        input.conflictId,
        { conflict_version: updated.rows[0]!.version },
        input.operationId,
        input.now,
      )
      await this.saveMergeOperationReceipt(client, input, 'cancel', projection)
      await client.query('COMMIT')
      transactionFinished = true
      return projection
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async identityLink(
    queryable: Queryable,
    identityLinkId: string,
    forUpdate = false,
  ): Promise<IdentityLinkRow | null> {
    const result = await queryable.query<IdentityLinkRow>(
      `SELECT identity_link_id,anonymous_subject_id,user_id,auth_flow_id,purpose,status,expires_at
       FROM iam.identity_links WHERE identity_link_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [identityLinkId],
    )
    return result.rows[0] ?? null
  }

  private assertMergeIdentityLink(
    link: IdentityLinkRow | null,
    userId: string,
    anonymousSubjectId: string,
    now: Date,
  ): void {
    if (link === null) throw comparisonError('IDENTITY_LINK_NOT_FOUND', 404)
    if (
      link.user_id !== userId ||
      link.anonymous_subject_id !== anonymousSubjectId ||
      link.purpose !== 'comparison_merge'
    ) throw comparisonError('IDENTITY_LINK_FORBIDDEN', 403)
    if (link.status !== 'active' || link.expires_at <= now) {
      throw comparisonError('IDENTITY_LINK_GONE', 410)
    }
  }

  private async assertPendingActionBinding(
    queryable: Queryable,
    pendingActionId: string,
    comparisonLink: IdentityLinkRow,
    userId: string,
    anonymousSubjectId: string,
    now: Date,
  ): Promise<void> {
    const result = await queryable.query<{
      action_status: string
      action_expires_at: Date
      link_status: string
      link_expires_at: Date
    }>(
      `SELECT action.status AS action_status,action.expires_at AS action_expires_at,
         link.status AS link_status,link.expires_at AS link_expires_at
       FROM iam.pending_actions action
       JOIN iam.pending_action_identity_links binding
         ON binding.pending_action_id=action.pending_action_id
       JOIN iam.identity_links link ON link.identity_link_id=binding.identity_link_id
       WHERE action.pending_action_id=$1
         AND link.auth_flow_id=$2
         AND link.user_id=$3
         AND link.anonymous_subject_id=$4
         AND link.purpose='pending_action_replay'`,
      [pendingActionId, comparisonLink.auth_flow_id, userId, anonymousSubjectId],
    )
    const binding = result.rows[0]
    if (binding === undefined) throw comparisonError('PENDING_ACTION_LINK_INVALID', 403)
    if (
      binding.action_status !== 'pending' || binding.action_expires_at <= now ||
      binding.link_status !== 'active' || binding.link_expires_at <= now
    ) throw comparisonError('PENDING_ACTION_GONE', 410)
  }

  private async activeComparison(
    queryable: Queryable,
    owner: { readonly kind: 'user'; readonly id: string } |
      { readonly kind: 'anonymous'; readonly hash: Buffer },
    forUpdate = false,
  ): Promise<ComparisonRow | null> {
    const pointer = owner.kind === 'user'
      ? await queryable.query<ActiveComparisonRow>(
        `SELECT comparison_id FROM comparison.active_comparisons
         WHERE owner_user_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
        [owner.id],
      )
      : await queryable.query<ActiveComparisonRow>(
        `SELECT comparison_id FROM comparison.active_comparisons
         WHERE anonymous_subject_hash=$1${forUpdate ? ' FOR UPDATE' : ''}`,
        [owner.hash],
      )
    if (!pointer.rows[0]) return null
    return this.comparisonRow(queryable, pointer.rows[0].comparison_id, forUpdate)
  }

  private isActiveAt(row: ComparisonRow, now: Date): boolean {
    return row.status === 'active' && (row.expires_at === null || row.expires_at > now)
  }

  private async setActiveComparison(
    client: PoolClient,
    owner: ComparisonStoreOwner,
    comparisonId: string,
    now: Date,
  ): Promise<void> {
    if (owner.subject.kind === 'user') {
      await client.query(
        `INSERT INTO comparison.active_comparisons (
           owner_user_id,anonymous_subject_hash,comparison_id,updated_at
         ) VALUES ($1,NULL,$2,$3)
         ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL DO UPDATE
         SET comparison_id=EXCLUDED.comparison_id,updated_at=EXCLUDED.updated_at`,
        [owner.subject.id, comparisonId, now],
      )
      return
    }
    await client.query(
      `INSERT INTO comparison.active_comparisons (
         owner_user_id,anonymous_subject_hash,comparison_id,updated_at
       ) VALUES (NULL,$1,$2,$3)
       ON CONFLICT (anonymous_subject_hash) WHERE anonymous_subject_hash IS NOT NULL DO UPDATE
       SET comparison_id=EXCLUDED.comparison_id,updated_at=EXCLUDED.updated_at`,
      [owner.subjectHash, comparisonId, now],
    )
  }

  private async appendComparisonVersion(
    client: PoolClient,
    comparisonId: string,
    comparisonVersion: number,
    orderedProjectIds: readonly string[],
    now: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE comparison.comparisons
       SET current_version=$2,updated_at=$3 WHERE comparison_id=$1`,
      [comparisonId, comparisonVersion, now],
    )
    await client.query(
      `INSERT INTO comparison.comparison_versions (
         comparison_id,comparison_version,item_count,created_at
       ) VALUES ($1,$2,$3,$4)`,
      [comparisonId, comparisonVersion, orderedProjectIds.length, now],
    )
    for (let index = 0; index < orderedProjectIds.length; index += 1) {
      await client.query(
        `INSERT INTO comparison.comparison_items (
           comparison_id,comparison_version,project_id,position,validity_status,added_at
         ) VALUES ($1,$2,$3,$4,'valid',$5)`,
        [comparisonId, comparisonVersion, orderedProjectIds[index], index + 1, now],
      )
    }
  }

  private async createUserComparisonCopy(
    client: PoolClient,
    comparisonId: string,
    userId: string,
    source: ComparisonRow,
    orderedProjectIds: readonly string[],
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO comparison.comparisons (
         comparison_id,owner_user_id,anonymous_subject_hash,category_id,
         category_schema_version,current_version,status,expires_at,created_at,updated_at
       ) VALUES ($1,$2,NULL,$3,$4,1,'active',NULL,$5,$5)`,
      [comparisonId, userId, source.category_id, source.category_schema_version, now],
    )
    await this.appendComparisonVersion(client, comparisonId, 1, orderedProjectIds, now)
    await this.setActiveComparison(client, {
      subject: { kind: 'user', id: userId },
      subjectHash: Buffer.alloc(32),
    }, comparisonId, now)
  }

  private async finishLoginMerge(
    client: PoolClient,
    input: {
      readonly identityLinkId: string
      readonly operationId: string
      readonly now: Date
    },
    projection: ComparisonLoginMergeProjection,
    consumeIdentityLink: boolean,
  ): Promise<void> {
    if (consumeIdentityLink) {
      await client.query(
        `UPDATE iam.identity_links SET status='consumed',consumed_at=$2
         WHERE identity_link_id=$1 AND status='active'`,
        [input.identityLinkId, input.now],
      )
    }
    await client.query(
      `INSERT INTO comparison.comparison_login_merge_receipts (
         identity_link_id,operation_id,response_json,created_at
       ) VALUES ($1,$2,$3,$4)`,
      [input.identityLinkId, input.operationId, projection, input.now],
    )
  }

  private async mergeConflict(
    queryable: Queryable,
    conflictId: string,
    forUpdate = false,
  ): Promise<MergeConflictRow | null> {
    const result = await queryable.query<MergeConflictRow>(
      `SELECT conflict_id,identity_link_id,user_id,account_comparison_id,
         account_comparison_version,anonymous_comparison_id,anonymous_comparison_version,
         candidate_project_ids,selected_project_ids,pending_action_id,status,version,
         expires_at,resolved_at,cancelled_at
       FROM comparison.comparison_merge_conflicts
       WHERE conflict_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [conflictId],
    )
    return result.rows[0] ?? null
  }

  private async assertMergeConflictAccess(
    queryable: Queryable,
    conflict: MergeConflictRow | null,
    owner: ComparisonStoreOwner,
    now: Date,
  ): Promise<void> {
    if (owner.subject.kind !== 'user') throw comparisonError('AUTHENTICATION_REQUIRED', 401)
    if (conflict === null) throw comparisonError('COMPARISON_MERGE_CONFLICT_NOT_FOUND', 404)
    if (conflict.user_id !== owner.subject.id) throw comparisonError('COMPARISON_MERGE_CONFLICT_FORBIDDEN', 403)
    const link = await this.identityLink(queryable, conflict.identity_link_id)
    if (link === null || link.user_id !== owner.subject.id || link.purpose !== 'comparison_merge') {
      throw comparisonError('COMPARISON_MERGE_CONFLICT_FORBIDDEN', 403)
    }
    if (conflict.status === 'pending' && link.status !== 'active' && link.expires_at > now) {
      throw comparisonError('IDENTITY_LINK_GONE', 410)
    }
  }

  private async expireMergeConflictIfRequired(
    client: PoolClient,
    conflict: MergeConflictRow,
    now: Date,
  ): Promise<MergeConflictRow> {
    if (conflict.status !== 'pending' || conflict.expires_at > now) return conflict
    const result = await client.query<MergeConflictRow>(
      `UPDATE comparison.comparison_merge_conflicts
       SET status='expired',version=version+1,updated_at=$2
       WHERE conflict_id=$1
       RETURNING conflict_id,identity_link_id,user_id,account_comparison_id,
         account_comparison_version,anonymous_comparison_id,anonymous_comparison_version,
         candidate_project_ids,selected_project_ids,pending_action_id,status,version,
         expires_at,resolved_at,cancelled_at`,
      [conflict.conflict_id, now],
    )
    await client.query(
      `UPDATE iam.identity_links SET status='expired'
       WHERE identity_link_id=$1 AND status='active'`,
      [conflict.identity_link_id],
    )
    if (conflict.pending_action_id !== null) {
      await client.query(
        `UPDATE iam.pending_actions
         SET status='expired',payload_ciphertext=NULL,updated_at=$2
         WHERE pending_action_id=$1 AND status='pending'`,
        [conflict.pending_action_id, now],
      )
      await client.query(
        `UPDATE iam.identity_links link SET status='expired'
         FROM iam.pending_action_identity_links binding
         WHERE binding.pending_action_id=$1
           AND binding.identity_link_id=link.identity_link_id
           AND link.status='active'`,
        [conflict.pending_action_id],
      )
    }
    return result.rows[0]!
  }

  private async cancelPendingActionForMerge(
    client: PoolClient,
    conflict: MergeConflictRow,
    now: Date,
  ): Promise<'cancelled' | null> {
    if (conflict.pending_action_id === null) return null
    const action = await client.query<{ status: string }>(
      `SELECT status FROM iam.pending_actions WHERE pending_action_id=$1 FOR UPDATE`,
      [conflict.pending_action_id],
    )
    const priorStatus = action.rows[0]?.status
    if (priorStatus === 'pending') {
      await client.query(
        `UPDATE iam.pending_actions
         SET status='cancelled',payload_ciphertext=NULL,cancelled_at=$2,
           cancel_reason='comparison_merge_cancelled',updated_at=$2
         WHERE pending_action_id=$1 AND status='pending'`,
        [conflict.pending_action_id, now],
      )
    }
    await client.query(
      `UPDATE iam.identity_links link SET status='revoked',revoked_at=$2
       FROM iam.pending_action_identity_links binding
       WHERE binding.pending_action_id=$1
         AND binding.identity_link_id=link.identity_link_id
         AND link.status='active'`,
      [conflict.pending_action_id, now],
    )
    return priorStatus === 'pending' || priorStatus === 'cancelled' ? 'cancelled' : null
  }

  private async mergeConflictProjection(
    queryable: Queryable,
    conflict: MergeConflictRow,
  ): Promise<ComparisonMergeConflictProjection> {
    const candidates = await queryable.query<MergeProjectSummaryRow>(
      `SELECT project_id,current_name,category_id,access_status,freshness_status,
         last_verified_at,review_status,current_version_id
       FROM catalog.projects WHERE project_id=ANY($1::uuid[])
       ORDER BY array_position($1::uuid[],project_id)`,
      [conflict.candidate_project_ids],
    )
    const visible = Object.freeze(candidates.rows
      .filter(({ review_status, current_version_id }) => (
        ['published_platform', 'published_author'].includes(review_status) &&
        current_version_id !== null
      ))
      .map((project): ComparisonMergeProjectSummary => Object.freeze({
        project_id: project.project_id,
        current_name: project.current_name,
        category_id: project.category_id,
        access_status: project.access_status,
        freshness_status: project.freshness_status,
        last_verified_at: project.last_verified_at.toISOString(),
      })))
    return Object.freeze({
      conflict_id: conflict.conflict_id,
      identity_link_id: conflict.identity_link_id,
      account_comparison_id: conflict.account_comparison_id,
      account_comparison_version: conflict.account_comparison_version,
      anonymous_comparison_id: conflict.anonymous_comparison_id,
      anonymous_comparison_version: conflict.anonymous_comparison_version,
      candidate_project_ids: Object.freeze([...conflict.candidate_project_ids]),
      candidate_projects: visible,
      selected_project_ids: conflict.selected_project_ids === null
        ? null
        : Object.freeze([...conflict.selected_project_ids]),
      status: conflict.status as 'pending' | 'resolved' | 'cancelled',
      pending_action_id: conflict.pending_action_id,
      version: conflict.version,
      expires_at: conflict.expires_at.toISOString(),
      resolved_at: conflict.resolved_at?.toISOString() ?? null,
      cancelled_at: conflict.cancelled_at?.toISOString() ?? null,
    })
  }

  private async mergeOperationReceipt(
    queryable: Queryable,
    conflictId: string,
    operationId: string,
  ): Promise<MergeOperationReceiptRow | null> {
    const result = await queryable.query<MergeOperationReceiptRow>(
      `SELECT operation_type,request_hash,response_json
       FROM comparison.comparison_merge_operation_receipts
       WHERE conflict_id=$1 AND operation_id=$2`,
      [conflictId, operationId],
    )
    return result.rows[0] ?? null
  }

  private async saveMergeOperationReceipt(
    client: PoolClient,
    input: {
      readonly conflictId: string
      readonly operationId: string
      readonly requestHash: string
      readonly now: Date
    },
    operationType: 'resolve' | 'cancel',
    projection: ComparisonMergeResolutionProjection | ComparisonMergeCancellationProjection,
  ): Promise<void> {
    await client.query(
      `INSERT INTO comparison.comparison_merge_operation_receipts (
         conflict_id,operation_id,operation_type,request_hash,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.conflictId,
        input.operationId,
        operationType,
        input.requestHash,
        projection,
        input.now,
      ],
    )
  }

  private async insertMergeSecurityEvent(
    client: PoolClient,
    eventType: string,
    actorUserIdHash: Buffer,
    targetType: string,
    targetId: string,
    metadata: Readonly<Record<string, unknown>>,
    requestId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.security_events (
         event_type,severity,actor_user_id_hash,target_type,target_id_hash,
         metadata_json,request_id,created_at
       ) VALUES ($1,'info',$2,$3,digest($4::text,'sha256'),$5,$6,$7)`,
      [eventType, actorUserIdHash, targetType, targetId, metadata, requestId, now],
    )
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
