import type { Pool, PoolClient } from 'pg'

import { identityError } from './errors.js'
import type {
  PendingActionProjection,
  PendingActionStatus,
  PendingActionSubject,
  PendingActionType,
} from './pending-action-types.js'

interface PendingActionRow {
  pending_action_id: string
  owner_user_id: string | null
  anonymous_subject_hash: Buffer | null
  action_type: PendingActionType
  payload_ciphertext: Buffer | null
  payload_key_version: string
  request_payload_hash: string
  return_to: string
  client_request_id: string
  status: PendingActionStatus
  execution_receipt_hash: Buffer | null
  consumed_at: Date | null
  cancelled_at: Date | null
  cancel_reason: string | null
  expires_at: Date
  created_at: Date
  updated_at: Date
}

interface OperationReceiptRow {
  operation_type: 'consume' | 'cancel'
  request_hash: string
  response_json: PendingActionProjection
}

interface IdentityLinkRow {
  identity_link_id: string
  user_id: string
  purpose: string
  status: 'active' | 'consumed' | 'revoked' | 'expired'
  expires_at: Date
}

export interface PendingActionStoreOwner {
  readonly subject: PendingActionSubject
  readonly subjectHash: Buffer
}

export interface CreatePendingActionStoreInput extends PendingActionStoreOwner {
  readonly pendingActionId: string
  readonly actionType: PendingActionType
  readonly payloadCiphertext: Buffer
  readonly payloadKeyVersion: string
  readonly requestPayloadHash: string
  readonly returnTo: string
  readonly clientRequestId: string
  readonly expiresAt: Date
  readonly requestId: string
  readonly now: Date
}

export interface AccessPendingActionStoreInput extends PendingActionStoreOwner {
  readonly pendingActionId: string
  readonly identityLinkId: string | null
  readonly requestId: string
  readonly now: Date
}

export interface PendingActionStoredProjection extends PendingActionProjection {
  readonly payloadCiphertext: Buffer | null
  readonly payloadKeyVersion: string
  readonly clientRequestId: string
}

export interface ConsumePendingActionStoreInput extends AccessPendingActionStoreInput {
  readonly identityLinkId: string
  readonly operationId: string
  readonly requestHash: string
  readonly executionReceiptHash: Buffer
  readonly businessRequestId: string
}

export interface CancelPendingActionStoreInput extends AccessPendingActionStoreInput {
  readonly operationId: string
  readonly requestHash: string
  readonly cancelReason: string
}

export interface PendingActionStore {
  create(input: CreatePendingActionStoreInput): Promise<PendingActionProjection>
  get(input: AccessPendingActionStoreInput): Promise<PendingActionStoredProjection>
  consume(input: ConsumePendingActionStoreInput): Promise<PendingActionProjection>
  cancel(input: CancelPendingActionStoreInput): Promise<PendingActionProjection>
}

function projection(row: PendingActionRow): PendingActionProjection {
  return Object.freeze({
    pending_action_id: row.pending_action_id,
    action_type: row.action_type,
    return_to: row.return_to,
    status: row.status,
    expires_at: row.expires_at.toISOString(),
    consumed_at: row.consumed_at?.toISOString() ?? null,
    cancelled_at: row.cancelled_at?.toISOString() ?? null,
    cancel_reason: row.cancel_reason,
  })
}

function storedProjection(row: PendingActionRow): PendingActionStoredProjection {
  return Object.freeze({
    ...projection(row),
    payloadCiphertext: row.payload_ciphertext,
    payloadKeyVersion: row.payload_key_version,
    clientRequestId: row.client_request_id,
  })
}

export class PostgresPendingActionStore implements PendingActionStore {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePendingActionStoreInput): Promise<PendingActionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `pending-action:${input.subject.kind}:${input.subject.kind === 'user' ? input.subject.id : input.subjectHash.toString('hex')}`,
      ])
      await client.query(
        `WITH expired AS (
           UPDATE iam.pending_actions
           SET status='expired',payload_ciphertext=NULL,updated_at=$1
           WHERE status='pending' AND expires_at<=$1
             AND ${input.subject.kind === 'user' ? 'owner_user_id=$2' : 'anonymous_subject_hash=$2'}
           RETURNING pending_action_id
         )
         UPDATE iam.identity_links link SET status='expired'
         FROM iam.pending_action_identity_links binding
         JOIN expired ON expired.pending_action_id=binding.pending_action_id
         WHERE binding.identity_link_id=link.identity_link_id
           AND link.status='active'`,
        [input.now, input.subject.kind === 'user' ? input.subject.id : input.subjectHash],
      )
      const existing = await client.query<PendingActionRow>(
        `SELECT * FROM iam.pending_actions
         WHERE ${input.subject.kind === 'user' ? 'owner_user_id=$1' : 'anonymous_subject_hash=$1'}
           AND client_request_id=$2`,
        [input.subject.kind === 'user' ? input.subject.id : input.subjectHash, input.clientRequestId],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].request_payload_hash !== input.requestPayloadHash) {
          throw identityError('IDEMPOTENCY_PAYLOAD_MISMATCH', 409)
        }
        await client.query('COMMIT')
        return projection(existing.rows[0])
      }
      const active = await client.query<{ pending_action_id: string }>(
        `SELECT pending_action_id FROM iam.pending_actions
         WHERE ${input.subject.kind === 'user' ? 'owner_user_id=$1' : 'anonymous_subject_hash=$1'}
           AND status='pending' LIMIT 1`,
        [input.subject.kind === 'user' ? input.subject.id : input.subjectHash],
      )
      if (active.rows[0]) throw identityError('PENDING_ACTION_ALREADY_EXISTS', 409)

      const inserted = await client.query<PendingActionRow>(
        `INSERT INTO iam.pending_actions (
           pending_action_id,owner_user_id,anonymous_subject_hash,action_type,
           payload_ciphertext,payload_key_version,request_payload_hash,return_to,
           client_request_id,status,expires_at,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$11)
         RETURNING *`,
        [
          input.pendingActionId,
          input.subject.kind === 'user' ? input.subject.id : null,
          input.subject.kind === 'anonymous' ? input.subjectHash : null,
          input.actionType,
          input.payloadCiphertext,
          input.payloadKeyVersion,
          input.requestPayloadHash,
          input.returnTo,
          input.clientRequestId,
          input.expiresAt,
          input.now,
        ],
      )
      await this.audit(client, 'pending_action_created', input, null)
      await client.query('COMMIT')
      return projection(inserted.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async get(input: AccessPendingActionStoreInput): Promise<PendingActionStoredProjection> {
    const client = await this.pool.connect()
    let transactionFinished = false
    try {
      await client.query('BEGIN')
      let row = await this.row(client, input.pendingActionId, true)
      if (row === null) throw identityError('PENDING_ACTION_NOT_FOUND', 404)
      row = await this.expireIfRequired(client, row, input.now)
      await this.assertAccess(client, row, input)
      if (row.status === 'expired') {
        await this.audit(client, 'pending_action_expired', input, null)
        await client.query('COMMIT')
        transactionFinished = true
        throw identityError('PENDING_ACTION_GONE', 410)
      }
      await this.audit(client, 'pending_action_read', input, null)
      await client.query('COMMIT')
      transactionFinished = true
      return storedProjection(row)
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async consume(input: ConsumePendingActionStoreInput): Promise<PendingActionProjection> {
    const client = await this.pool.connect()
    let transactionFinished = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `pending-action:${input.pendingActionId}`,
      ])
      let row = await this.row(client, input.pendingActionId, true)
      if (row === null) throw identityError('PENDING_ACTION_NOT_FOUND', 404)
      row = await this.expireIfRequired(client, row, input.now)
      await this.assertAccess(client, row, input, true)
      if (row.client_request_id !== input.businessRequestId) {
        throw identityError('EXECUTION_RECEIPT_INVALID', 403)
      }
      const receipt = await this.operationReceipt(client, input.pendingActionId, input.operationId)
      if (receipt !== null) {
        if (receipt.operation_type !== 'consume' || receipt.request_hash !== input.requestHash) {
          throw identityError('IDEMPOTENCY_PAYLOAD_MISMATCH', 409)
        }
        await client.query('COMMIT')
        transactionFinished = true
        return Object.freeze(receipt.response_json)
      }
      if (row.status === 'expired') {
        await this.audit(client, 'pending_action_expired', input, null)
        await client.query('COMMIT')
        transactionFinished = true
        throw identityError('PENDING_ACTION_GONE', 410)
      }
      if (row.status === 'cancelled') throw identityError('PENDING_ACTION_CANCELLED', 409)
      if (row.status === 'consumed') throw identityError('PENDING_ACTION_ALREADY_CONSUMED', 409)
      const updated = await client.query<PendingActionRow>(
        `UPDATE iam.pending_actions
         SET status='consumed',payload_ciphertext=NULL,execution_receipt_hash=$2,
           consumed_at=$3,updated_at=$3
         WHERE pending_action_id=$1 AND status='pending'
         RETURNING *`,
        [input.pendingActionId, input.executionReceiptHash, input.now],
      )
      await client.query(
        `UPDATE iam.identity_links SET status='consumed',consumed_at=$2
         WHERE identity_link_id=$1 AND status='active'`,
        [input.identityLinkId, input.now],
      )
      const result = projection(updated.rows[0]!)
      await this.saveReceipt(client, input.pendingActionId, input.operationId, 'consume', input.requestHash, result, input.now)
      await this.audit(client, 'pending_action_consumed', input, null)
      await client.query('COMMIT')
      transactionFinished = true
      return result
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async cancel(input: CancelPendingActionStoreInput): Promise<PendingActionProjection> {
    const client = await this.pool.connect()
    let transactionFinished = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `pending-action:${input.pendingActionId}`,
      ])
      let row = await this.row(client, input.pendingActionId, true)
      if (row === null) throw identityError('PENDING_ACTION_NOT_FOUND', 404)
      row = await this.expireIfRequired(client, row, input.now)
      await this.assertAccess(client, row, input)
      const receipt = await this.operationReceipt(client, input.pendingActionId, input.operationId)
      if (receipt !== null) {
        if (receipt.operation_type !== 'cancel' || receipt.request_hash !== input.requestHash) {
          throw identityError('IDEMPOTENCY_PAYLOAD_MISMATCH', 409)
        }
        await client.query('COMMIT')
        transactionFinished = true
        return Object.freeze(receipt.response_json)
      }
      if (row.status === 'expired') {
        await this.audit(client, 'pending_action_expired', input, null)
        await client.query('COMMIT')
        transactionFinished = true
        throw identityError('PENDING_ACTION_GONE', 410)
      }
      if (row.status === 'consumed') throw identityError('PENDING_ACTION_ALREADY_CONSUMED', 409)
      if (row.status === 'pending') {
        const updated = await client.query<PendingActionRow>(
          `UPDATE iam.pending_actions
           SET status='cancelled',payload_ciphertext=NULL,cancelled_at=$2,
             cancel_reason=$3,updated_at=$2
           WHERE pending_action_id=$1 AND status='pending'
           RETURNING *`,
          [input.pendingActionId, input.now, input.cancelReason],
        )
        row = updated.rows[0]!
      }
      await client.query(
        `UPDATE iam.identity_links link SET status='revoked',revoked_at=$2
         FROM iam.pending_action_identity_links binding
         WHERE binding.pending_action_id=$1
           AND binding.identity_link_id=link.identity_link_id
           AND link.status='active'`,
        [input.pendingActionId, input.now],
      )
      const result = projection(row)
      await this.saveReceipt(client, input.pendingActionId, input.operationId, 'cancel', input.requestHash, result, input.now)
      await this.audit(client, 'pending_action_cancelled', input, null)
      await client.query('COMMIT')
      transactionFinished = true
      return result
    } catch (error) {
      if (!transactionFinished) await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async row(client: PoolClient, pendingActionId: string, forUpdate: boolean): Promise<PendingActionRow | null> {
    const result = await client.query<PendingActionRow>(
      `SELECT * FROM iam.pending_actions WHERE pending_action_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [pendingActionId],
    )
    return result.rows[0] ?? null
  }

  private async expireIfRequired(client: PoolClient, row: PendingActionRow, now: Date): Promise<PendingActionRow> {
    if (row.status !== 'pending' || row.expires_at > now) return row
    const expired = await client.query<PendingActionRow>(
      `UPDATE iam.pending_actions
       SET status='expired',payload_ciphertext=NULL,updated_at=$2
       WHERE pending_action_id=$1 AND status='pending'
       RETURNING *`,
      [row.pending_action_id, now],
    )
    await client.query(
      `UPDATE iam.identity_links link SET status='expired'
       FROM iam.pending_action_identity_links binding
       WHERE binding.pending_action_id=$1
         AND binding.identity_link_id=link.identity_link_id
         AND link.status='active'`,
      [row.pending_action_id],
    )
    return expired.rows[0] ?? row
  }

  private async assertAccess(
    client: PoolClient,
    row: PendingActionRow,
    input: AccessPendingActionStoreInput,
    identityLinkRequired = false,
  ): Promise<void> {
    const direct = input.subject.kind === 'user'
      ? row.owner_user_id === input.subject.id
      : row.anonymous_subject_hash?.equals(input.subjectHash) === true
    if (direct && !identityLinkRequired) return
    if (input.subject.kind !== 'user' || input.identityLinkId === null) {
      throw identityError('PENDING_ACTION_FORBIDDEN', 403)
    }
    const link = await client.query<IdentityLinkRow>(
      `SELECT link.identity_link_id,link.user_id,link.purpose,link.status,link.expires_at
       FROM iam.identity_links link
       JOIN iam.pending_action_identity_links binding
         ON binding.identity_link_id=link.identity_link_id
       WHERE binding.pending_action_id=$1 AND link.identity_link_id=$2`,
      [row.pending_action_id, input.identityLinkId],
    )
    const current = link.rows[0]
    const activeRequired = row.status === 'pending'
    if (
      current === undefined || current.user_id !== input.subject.id ||
      current.purpose !== 'pending_action_replay' ||
      (activeRequired && (current.status !== 'active' || current.expires_at <= input.now))
    ) {
      throw identityError('PENDING_ACTION_FORBIDDEN', 403)
    }
  }

  private async operationReceipt(
    client: PoolClient,
    pendingActionId: string,
    operationId: string,
  ): Promise<OperationReceiptRow | null> {
    const result = await client.query<OperationReceiptRow>(
      `SELECT operation_type,request_hash,response_json
       FROM iam.pending_action_operation_receipts
       WHERE pending_action_id=$1 AND operation_id=$2`,
      [pendingActionId, operationId],
    )
    return result.rows[0] ?? null
  }

  private async saveReceipt(
    client: PoolClient,
    pendingActionId: string,
    operationId: string,
    operationType: 'consume' | 'cancel',
    requestHash: string,
    result: PendingActionProjection,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO iam.pending_action_operation_receipts (
         pending_action_id,operation_id,operation_type,request_hash,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [pendingActionId, operationId, operationType, requestHash, result, now],
    )
  }

  private async audit(
    client: PoolClient,
    eventType: string,
    input: AccessPendingActionStoreInput | CreatePendingActionStoreInput,
    errorCode: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.security_events (
         event_type,severity,actor_user_id_hash,target_type,target_id_hash,error_code,
         metadata_json,request_id,created_at
       ) VALUES ($1,'info',$2,'pending_action',digest($3,'sha256'),$4,$5,$6,$7)`,
      [
        eventType,
        input.subject.kind === 'user' ? input.subjectHash : null,
        input.pendingActionId,
        errorCode,
        { actor_kind: input.subject.kind },
        input.requestId,
        input.now,
      ],
    )
  }
}
