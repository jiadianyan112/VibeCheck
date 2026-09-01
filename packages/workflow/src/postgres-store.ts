import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { workflowError } from './errors.js'
import type { StoredReviewWorkItemPage, WorkflowStore } from './store-port.js'
import type {
  ReviewActor,
  ReviewDomainSummary,
  ReviewTargetType,
  ReviewWorkItemProjection,
  ReviewWorkItemStatus,
  ReviewWorkType,
} from './types.js'

interface WorkItemRow extends QueryResultRow {
  readonly work_item_id: string
  readonly work_type: ReviewWorkType
  readonly target_type: ReviewTargetType
  readonly target_id: string
  readonly status: ReviewWorkItemStatus
  readonly assignee_user_id: string | null
  readonly claim_token_hash: Buffer | null
  readonly lease_expires_at: Date | null
  readonly last_heartbeat_at: Date | null
  readonly conflict_principal_version_at_claim: number | null
  readonly attempt_count: number
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface CountRow extends QueryResultRow {
  readonly count: string
}

interface ReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

const identityWorkTypes = new Set<ReviewWorkType>(['verification', 'ownership_case'])

export class PostgresWorkflowStore implements WorkflowStore {
  constructor(private readonly pool: Pool) {}

  async listWorkItems(
    input: Parameters<WorkflowStore['listWorkItems']>[0],
  ): Promise<StoredReviewWorkItemPage> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const parameters: unknown[] = [input.workType, input.status, input.actorUserId]
      const filters = [
        'item.work_type=$1',
        'item.status=$2',
        `NOT EXISTS (
          SELECT 1 FROM workflow.review_work_item_conflict_principals principal
          WHERE principal.work_item_id=item.work_item_id
            AND principal.principal_user_id=$3 AND principal.revoked_at IS NULL
        )`,
        `(
          item.work_type<>'ownership_case' OR NOT EXISTS (
            SELECT 1 FROM workflow.ownership_cases ownership
            JOIN catalog.author_relations relation ON relation.author_relation_id=ownership.author_relation_id
            WHERE ownership.case_id=item.target_id AND (
              ownership.opened_by_user_id=$3 OR ownership.appealed_user_id=$3 OR
              EXISTS (SELECT 1 FROM workflow.verification_requests verification WHERE verification.verification_id=relation.source_verification_id AND verification.applicant_user_id=$3) OR
              EXISTS (SELECT 1 FROM catalog.creator_account_links link WHERE link.creator_id=relation.creator_id AND link.user_id=$3 AND link.status IN ('active','suspended')) OR
              EXISTS (SELECT 1 FROM workflow.ownership_case_evidence_submissions evidence WHERE evidence.case_id=ownership.case_id AND evidence.submitted_by_user_id=$3) OR
              EXISTS (SELECT 1 FROM workflow.ownership_withdrawal_requests withdrawal WHERE withdrawal.case_id=ownership.case_id AND withdrawal.requested_by_user_id=$3)
            )
          )
        )`,
      ]
      if (input.targetType !== null) {
        parameters.push(input.targetType)
        filters.push(`item.target_type=$${parameters.length}`)
      }
      const count = await client.query<CountRow>(
        `SELECT count(*)::text AS count FROM workflow.review_work_items item
         WHERE ${filters.join(' AND ')}`,
        parameters,
      )
      const pageParameters = [...parameters]
      const pageFilters = [...filters]
      if (input.anchor !== null) {
        pageParameters.push(input.anchor.createdAt, input.anchor.workItemId)
        pageFilters.push(
          `(item.created_at,item.work_item_id) > ($${pageParameters.length - 1},$${pageParameters.length})`,
        )
      }
      pageParameters.push(input.limit + 1)
      const rows = await client.query<WorkItemRow>(
        `SELECT item.* FROM workflow.review_work_items item
         WHERE ${pageFilters.join(' AND ')}
         ORDER BY item.created_at,item.work_item_id
         LIMIT $${pageParameters.length}`,
        pageParameters,
      )
      const hasMore = rows.rows.length > input.limit
      const selected = rows.rows.slice(0, input.limit)
      const items: ReviewWorkItemProjection[] = []
      for (const row of selected) items.push(await this.projection(client, row))
      const tail = hasMore ? selected.at(-1) : undefined
      await client.query('COMMIT')
      return Object.freeze({
        items: Object.freeze(items),
        totalCount: Number(count.rows[0]?.count ?? '0'),
        nextAnchor: tail
          ? Object.freeze({ createdAt: tail.created_at, workItemId: tail.work_item_id })
          : null,
      })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async claimWorkItem(
    input: Parameters<WorkflowStore['claimWorkItem']>[0],
  ): Promise<ReviewWorkItemProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      let row = await this.lockedWorkItem(client, input.workItemId)
      if (!row) throw workflowError('WORK_ITEM_NOT_FOUND', 404)
      this.authorize(input.actor, row.work_type)
      if (row.version !== input.expectedVersion) {
        throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: row.version,
        })
      }
      if (row.status === 'claimed' && row.lease_expires_at && row.lease_expires_at <= input.now) {
        row = await this.expireClaim(client, row, input.now, input.requestId)
      }
      if (row.status !== 'queued') throw workflowError('WORK_ITEM_NOT_CLAIMABLE', 409)

      const conflict = await client.query<{ readonly present: boolean } & QueryResultRow>(
        `SELECT EXISTS (
           SELECT 1 FROM workflow.review_work_item_conflict_principals
           WHERE work_item_id=$1 AND principal_user_id=$2 AND revoked_at IS NULL
         ) AS present`,
        [row.work_item_id, input.actor.userId],
      )
      if (conflict.rows[0]?.present) throw workflowError('CONFLICT_OF_INTEREST', 403)
      if (row.work_type==='ownership_case' && await this.ownershipActorConflict(client,row.target_id,input.actor.userId)) {
        throw workflowError('CONFLICT_OF_INTEREST',403)
      }

      const principalVersion = await this.principalVersion(client, row.work_item_id)
      if (row.work_type === 'ownership_case' && input.expectedConflictPrincipalVersion === null) {
        throw workflowError('EXPECTED_CONFLICT_PRINCIPAL_VERSION_REQUIRED', 422)
      }
      if (
        input.expectedConflictPrincipalVersion !== null &&
        input.expectedConflictPrincipalVersion !== principalVersion
      ) throw workflowError('CONFLICT_PRINCIPAL_VERSION_CONFLICT', 409)

      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000)
      const updated = await client.query<WorkItemRow>(
        `UPDATE workflow.review_work_items SET status='claimed',assignee_user_id=$2,
           claim_token_hash=$3,lease_expires_at=$4,last_heartbeat_at=$5,
           conflict_principal_version_at_claim=$6,attempt_count=attempt_count+1,
           version=version+1,updated_at=$5
         WHERE work_item_id=$1 AND status='queued' AND version=$7 RETURNING *`,
        [
          row.work_item_id, input.actor.userId, input.claimTokenHash, leaseExpiresAt,
          input.now, row.work_type === 'ownership_case' ? principalVersion : null, row.version,
        ],
      )
      const claimed = updated.rows[0]
      if (!claimed) throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409)
      if (claimed.work_type === 'ownership_case') {
        await client.query(
          `UPDATE workflow.ownership_cases
           SET status='investigating',version=version+1,
               updated_at=GREATEST($2,updated_at+interval '1 microsecond')
           WHERE case_id=$1 AND status='open'`,
          [claimed.target_id,input.now],
        )
      }
      await this.event(client, claimed, 'claimed', 'queued', 'claimed', input.actor.userId, 'review_claimed', input.now)
      await this.audit(client, {
        operationId: 'OP-ADMIN-CLAIM', actor: input.actor, row: claimed,
        before: row, reasonCode: 'review_claimed', requestId: input.requestId, now: input.now,
      })
      const projection = await this.projection(client, claimed)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async heartbeatWorkItem(
    input: Parameters<WorkflowStore['heartbeatWorkItem']>[0],
  ): Promise<ReviewWorkItemProjection> {
    const client = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const row = await this.lockedWorkItem(client, input.workItemId)
      if (!row) throw workflowError('WORK_ITEM_NOT_FOUND', 404)
      this.authorize(input.actor, row.work_type)
      this.assertCurrentClaim(row, input.actor.userId, input.claimTokenHash, false)
      if (!row.lease_expires_at || row.lease_expires_at <= input.now) {
        await this.expireClaim(client, row, input.now, input.requestId)
        await client.query('COMMIT')
        committed = true
        throw workflowError('WORK_ITEM_LEASE_EXPIRED', 410)
      }
      const claimedAt = await this.latestClaimedAt(client, row.work_item_id)
      const maximumEndsAt = new Date(claimedAt.getTime() + input.maximumClaimSeconds * 1_000)
      if (maximumEndsAt <= input.now) {
        await this.expireClaim(client, row, input.now, input.requestId)
        await client.query('COMMIT')
        committed = true
        throw workflowError('WORK_ITEM_MAXIMUM_CLAIM_REACHED', 410)
      }
      const proposed = new Date(input.now.getTime() + input.leaseSeconds * 1_000)
      const leaseExpiresAt = proposed < maximumEndsAt ? proposed : maximumEndsAt
      const updated = await client.query<WorkItemRow>(
        `UPDATE workflow.review_work_items SET lease_expires_at=$2,last_heartbeat_at=$3,
           version=version+1,updated_at=$3
         WHERE work_item_id=$1 AND status='claimed' AND version=$4 RETURNING *`,
        [row.work_item_id, leaseExpiresAt, input.now, row.version],
      )
      const heartbeat = updated.rows[0]
      if (!heartbeat) throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409)
      await this.event(
        client, heartbeat, 'heartbeat', 'claimed', 'claimed', input.actor.userId,
        'review_heartbeat', input.now,
      )
      await this.audit(client, {
        operationId: 'OP-ADMIN-HEARTBEAT', actor: input.actor, row: heartbeat,
        before: row, reasonCode: 'review_heartbeat', requestId: input.requestId, now: input.now,
      })
      const projection = await this.projection(client, heartbeat)
      await client.query('COMMIT')
      committed = true
      return projection
    } catch (error) {
      if (!committed) await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async releaseWorkItem(
    input: Parameters<WorkflowStore['releaseWorkItem']>[0],
  ): Promise<ReviewWorkItemProjection> {
    const client = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const receipt = await client.query<ReceiptRow>(
        `SELECT request_hash,response_json FROM workflow.review_work_item_release_receipts
         WHERE work_item_id=$1 AND claim_token_hash=$2`,
        [input.workItemId, input.claimTokenHash],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw workflowError('RELEASE_REQUEST_CONFLICT', 409)
        }
        const replay = this.receiptProjection(receipt.rows[0].response_json)
        await client.query('COMMIT')
        committed = true
        return replay
      }
      const row = await this.lockedWorkItem(client, input.workItemId)
      if (!row) throw workflowError('WORK_ITEM_NOT_FOUND', 404)
      this.authorize(input.actor, row.work_type)
      this.assertCurrentClaim(row, input.actor.userId, input.claimTokenHash, input.allowAdminOverride)
      if (!row.lease_expires_at || row.lease_expires_at <= input.now) {
        await this.expireClaim(client, row, input.now, input.requestId)
        await client.query('COMMIT')
        committed = true
        throw workflowError('WORK_ITEM_LEASE_EXPIRED', 410)
      }
      const updated = await client.query<WorkItemRow>(
        `UPDATE workflow.review_work_items SET status='queued',assignee_user_id=NULL,
           claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,
           conflict_principal_version_at_claim=NULL,version=version+1,updated_at=$2
         WHERE work_item_id=$1 AND status='claimed' AND version=$3 RETURNING *`,
        [row.work_item_id, input.now, row.version],
      )
      const released = updated.rows[0]
      if (!released) throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409)
      await this.invalidateMaterialReadGrants(client,row.work_item_id,input.now)
      await this.event(
        client, released, 'released', 'claimed', 'queued', input.actor.userId,
        input.reasonCode, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-ADMIN-RELEASE', actor: input.actor, row: released,
        before: row, reasonCode: input.reasonCode, requestId: input.requestId, now: input.now,
      })
      const projection = await this.projection(client, released)
      await client.query(
        `INSERT INTO workflow.review_work_item_release_receipts (
           work_item_id,claim_token_hash,actor_user_id,request_hash,response_json,created_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          row.work_item_id, input.claimTokenHash, input.actor.userId, input.requestHash,
          JSON.stringify(projection), input.now,
        ],
      )
      await client.query('COMMIT')
      committed = true
      return projection
    } catch (error) {
      if (!committed) await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async requeueExpiredClaims(now: Date, limit: number): Promise<number> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const candidates = await client.query<WorkItemRow>(
        `SELECT * FROM workflow.review_work_items
         WHERE status='claimed' AND lease_expires_at<=$1
         ORDER BY lease_expires_at,work_item_id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, Math.max(1, Math.min(500, limit))],
      )
      for (const row of candidates.rows) await this.expireClaim(client, row, now, randomUUID())
      await client.query('COMMIT')
      return candidates.rows.length
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async lockedWorkItem(client: PoolClient, workItemId: string): Promise<WorkItemRow | null> {
    const result = await client.query<WorkItemRow>(
      'SELECT * FROM workflow.review_work_items WHERE work_item_id=$1 FOR UPDATE',
      [workItemId],
    )
    return result.rows[0] ?? null
  }

  private authorize(actor: ReviewActor, workType: ReviewWorkType): void {
    if (workType === 'creator_profile') {
      if (!actor.roles.includes('admin')) throw workflowError('WORK_ITEM_FORBIDDEN', 403)
      return
    }
    if (actor.roles.includes('admin')) return
    const permission = identityWorkTypes.has(workType) ? 'admin:identity_review' : 'admin:review'
    if (!actor.permissions.includes(permission)) throw workflowError('WORK_ITEM_FORBIDDEN', 403)
  }

  private assertCurrentClaim(
    row: WorkItemRow,
    actorUserId: string,
    claimTokenHash: Buffer,
    allowAdminOverride: boolean,
  ): void {
    if (row.status !== 'claimed') throw workflowError('WORK_ITEM_NOT_CLAIMED', 409)
    if (!allowAdminOverride && row.assignee_user_id !== actorUserId) {
      throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN', 403)
    }
    if (!row.claim_token_hash || !row.claim_token_hash.equals(claimTokenHash)) {
      throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN', 403)
    }
  }

  private async principalVersion(client: PoolClient, workItemId: string): Promise<number> {
    const result = await client.query<{ readonly version: number } & QueryResultRow>(
      `SELECT COALESCE(
         (SELECT ownership.conflict_principal_version
          FROM workflow.review_work_items item
          JOIN workflow.ownership_cases ownership
            ON item.work_type='ownership_case' AND item.target_id=ownership.case_id
          WHERE item.work_item_id=$1),
         (SELECT max(principal_version)
          FROM workflow.review_work_item_conflict_principals
          WHERE work_item_id=$1 AND revoked_at IS NULL),1
       )::integer AS version`,
      [workItemId],
    )
    return result.rows[0]?.version ?? 1
  }

  private async ownershipActorConflict(client:PoolClient,caseId:string,userId:string):Promise<boolean>{
    const result=await client.query<{present:boolean}&QueryResultRow>(`SELECT EXISTS (
      SELECT 1 FROM workflow.ownership_cases ownership
      JOIN catalog.author_relations relation ON relation.author_relation_id=ownership.author_relation_id
      WHERE ownership.case_id=$1 AND (
        ownership.opened_by_user_id=$2 OR ownership.appealed_user_id=$2 OR
        EXISTS (SELECT 1 FROM workflow.verification_requests verification WHERE verification.verification_id=relation.source_verification_id AND verification.applicant_user_id=$2) OR
        EXISTS (SELECT 1 FROM catalog.creator_account_links link WHERE link.creator_id=relation.creator_id AND link.user_id=$2 AND link.status IN ('active','suspended')) OR
        EXISTS (SELECT 1 FROM workflow.ownership_case_evidence_submissions evidence WHERE evidence.case_id=ownership.case_id AND evidence.submitted_by_user_id=$2) OR
        EXISTS (SELECT 1 FROM workflow.ownership_withdrawal_requests withdrawal WHERE withdrawal.case_id=ownership.case_id AND withdrawal.requested_by_user_id=$2)
      )
    ) AS present`,[caseId,userId]);return result.rows[0]?.present??false
  }

  private async latestClaimedAt(client: PoolClient, workItemId: string): Promise<Date> {
    const result = await client.query<{ readonly occurred_at: Date } & QueryResultRow>(
      `SELECT occurred_at FROM workflow.review_work_item_events
       WHERE work_item_id=$1 AND event_type='claimed'
       ORDER BY work_item_version DESC LIMIT 1`,
      [workItemId],
    )
    if (!result.rows[0]) throw workflowError('WORK_ITEM_CLAIM_HISTORY_INVALID', 500, true)
    return result.rows[0].occurred_at
  }

  private async expireClaim(
    client: PoolClient,
    row: WorkItemRow,
    now: Date,
    requestId: string,
  ): Promise<WorkItemRow> {
    const updated = await client.query<WorkItemRow>(
      `UPDATE workflow.review_work_items SET status='queued',assignee_user_id=NULL,
         claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,
         conflict_principal_version_at_claim=NULL,version=version+1,updated_at=$2
       WHERE work_item_id=$1 AND status='claimed' AND version=$3 RETURNING *`,
      [row.work_item_id, now, row.version],
    )
    const expired = updated.rows[0]
    if (!expired) throw workflowError('WORK_ITEM_VERSION_CONFLICT', 409)
    await this.invalidateMaterialReadGrants(client,row.work_item_id,now)
    await this.event(
      client, expired, 'lease_expired', 'claimed', 'queued', null, 'review_lease_expired', now,
    )
    await this.audit(client, {
      operationId: 'WORK-LEASE-EXPIRE', actor: null, row: expired, before: row,
      reasonCode: 'review_lease_expired', requestId: requestId.slice(0, 64), now,
    })
    return expired
  }

  private async invalidateMaterialReadGrants(
    client: PoolClient,workItemId: string,now: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE private_material.material_read_grants SET invalidated_at=$2
       WHERE work_item_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [workItemId,now],
    )
  }

  private async event(
    client: PoolClient,
    row: WorkItemRow,
    eventType: string,
    fromStatus: ReviewWorkItemStatus,
    toStatus: ReviewWorkItemStatus,
    actorUserId: string | null,
    reasonCode: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow.review_work_item_events (
         event_id,work_item_id,event_type,actor_user_id,from_status,to_status,
         work_item_version,reason_code,occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(), row.work_item_id, eventType, actorUserId, fromStatus, toStatus,
        row.version, reasonCode, now,
      ],
    )
  }

  private async audit(
    client: PoolClient,
    input: {
      readonly operationId: string
      readonly actor: ReviewActor | null
      readonly row: WorkItemRow
      readonly before: WorkItemRow
      readonly reasonCode: string
      readonly requestId: string
      readonly now: Date
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,diff_json,reason_code,request_id,result,created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,'review_work_item',$6,$7,$8,$9::jsonb,$10,$11,'succeeded',$12)`,
      [
        randomUUID(), input.operationId,
        input.actor === null ? 'system' : input.actor.roles.includes('admin') ? 'admin' : 'platform_editor',
        input.actor === null ? null : createHash('sha256').update(input.actor.userId).digest(),
        JSON.stringify(input.actor?.roles ?? []), input.row.work_item_id,
        this.rowHash(input.before), this.rowHash(input.row),
        JSON.stringify({ from_status: input.before.status, to_status: input.row.status }),
        input.reasonCode, input.requestId.slice(0, 64), input.now,
      ],
    )
  }

  private rowHash(row: WorkItemRow): string {
    return createHash('sha256').update(JSON.stringify({
      work_item_id: row.work_item_id,
      status: row.status,
      assignee_user_id: row.assignee_user_id,
      lease_expires_at: row.lease_expires_at?.toISOString() ?? null,
      version: row.version,
    })).digest('hex')
  }

  private async projection(client: PoolClient, row: WorkItemRow): Promise<ReviewWorkItemProjection> {
    return Object.freeze({
      work_item_id: row.work_item_id,
      work_type: row.work_type,
      target_type: row.target_type,
      target_id: row.target_id,
      work_item_status: row.status,
      version: row.version,
      assignee_user_id: row.assignee_user_id,
      lease_expires_at: row.lease_expires_at?.toISOString() ?? null,
      domain_summary: await this.domainSummary(client, row),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private async domainSummary(client: PoolClient, row: WorkItemRow): Promise<ReviewDomainSummary> {
    let table: string
    let id: string
    let status: string
    switch (row.target_type) {
      case 'submission':
        table = 'workflow.submissions'; id = 'submission_id'; status = 'review_status'; break
      case 'comment':
        table = 'community.comments'; id = 'comment_id'; status = 'moderation_state'; break
      case 'report':
        table = 'community.comment_reports'; id = 'report_id'; status = 'status'; break
      case 'verification_request':
        table = 'workflow.verification_requests'; id = 'verification_id'; status = 'status'; break
      case 'ownership_case':
        table = 'workflow.ownership_cases'; id = 'case_id'; status = 'status'; break
      default:
        return Object.freeze({ status: 'not_implemented' })
    }
    const result = await client.query<{ readonly domain_status: string } & QueryResultRow>(
      `SELECT ${status} AS domain_status FROM ${table} WHERE ${id}=$1`,
      [row.target_id],
    )
    return Object.freeze({ status: result.rows[0]?.domain_status ?? 'target_missing' })
  }

  private receiptProjection(value: unknown): ReviewWorkItemProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw workflowError('WORK_ITEM_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as ReviewWorkItemProjection
  }
}
