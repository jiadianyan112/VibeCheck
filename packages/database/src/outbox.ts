import type { Pool } from 'pg'

export interface OutboxEvent {
  readonly outboxId: string
  readonly eventId: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly eventName: string
  readonly eventVersion: number
  readonly payload: Readonly<Record<string, unknown>>
  readonly transactionId: string
  readonly attemptCount: number
}

interface OutboxRow {
  outbox_id: string
  event_id: string
  aggregate_type: string
  aggregate_id: string
  event_name: string
  event_version: number
  payload_json: Record<string, unknown>
  transaction_id: string
  attempt_count: number
}

function toOutboxEvent(row: OutboxRow): OutboxEvent {
  return Object.freeze({
    outboxId: row.outbox_id,
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventName: row.event_name,
    eventVersion: row.event_version,
    payload: Object.freeze(row.payload_json),
    transactionId: row.transaction_id,
    attemptCount: row.attempt_count,
  })
}

export async function claimOutboxEvents(
  pool: Pool,
  workerId: string,
  eventNames: readonly string[],
  limit: number,
): Promise<OutboxEvent[]> {
  if (eventNames.length === 0) return []

  const result = await pool.query<OutboxRow>(
    `WITH candidates AS (
       SELECT outbox_id
       FROM ops.outbox_events
       WHERE event_name = ANY($1::varchar[])
         AND status IN ('pending', 'retry_wait')
         AND next_attempt_at <= now()
       ORDER BY created_at, outbox_id
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE ops.outbox_events AS event
     SET status = 'processing',
         locked_by = $3,
         locked_at = now(),
         lease_expires_at = now() + interval '60 seconds',
         attempt_count = attempt_count + 1
     FROM candidates
     WHERE event.outbox_id = candidates.outbox_id
     RETURNING event.outbox_id, event.event_id, event.aggregate_type,
       event.aggregate_id, event.event_name, event.event_version,
       event.payload_json, event.transaction_id, event.attempt_count`,
    [eventNames, limit, workerId],
  )

  return result.rows.map(toOutboxEvent)
}

export async function markOutboxPublished(pool: Pool, outboxId: string): Promise<void> {
  await pool.query(
    `UPDATE ops.outbox_events
     SET status = 'published', published_at = now(), locked_by = NULL,
         locked_at = NULL, lease_expires_at = NULL, last_error_code = NULL
     WHERE outbox_id = $1 AND status = 'processing'`,
    [outboxId],
  )
}

export async function markOutboxRetry(
  pool: Pool,
  outboxId: string,
  errorCode: string,
  maxAttempts = 8,
): Promise<void> {
  await pool.query(
    `UPDATE ops.outbox_events
     SET status = CASE WHEN attempt_count >= $3 THEN 'dead_letter' ELSE 'retry_wait' END,
         next_attempt_at = CASE
           WHEN attempt_count >= $3 THEN next_attempt_at
           ELSE now() + make_interval(secs => LEAST(300, power(2, attempt_count)::int))
         END,
         locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
         last_error_code = $2
     WHERE outbox_id = $1 AND status = 'processing'`,
    [outboxId, errorCode.slice(0, 64), maxAttempts],
  )
}

export async function requeueExpiredOutbox(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE ops.outbox_events
     SET status = 'retry_wait', locked_by = NULL, locked_at = NULL,
         lease_expires_at = NULL, next_attempt_at = now(),
         last_error_code = 'WORKER_LEASE_EXPIRED'
     WHERE status = 'processing' AND lease_expires_at < now()`,
  )
  return result.rowCount ?? 0
}
