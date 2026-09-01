import { randomUUID } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import type {
  AnalyticsStore,
  ExistingAnalyticsEvent,
  PersistAnalyticsEventInput,
  PersistAnalyticsReceiptInput,
} from './store-port.js'

interface EventRow extends QueryResultRow {
  readonly payload_hash: string
}

export class PostgresAnalyticsStore implements AnalyticsStore {
  constructor(private readonly pool: Pool) {}

  async getEvent(eventId: string): Promise<ExistingAnalyticsEvent | null> {
    const result = await this.pool.query<EventRow>(
      'SELECT payload_hash FROM analytics.events WHERE event_id=$1',
      [eventId],
    )
    return result.rows[0]
      ? Object.freeze({ payloadHash: result.rows[0].payload_hash })
      : null
  }

  async persistEvent(input: PersistAnalyticsEventInput): Promise<{
    readonly inserted: boolean
    readonly payloadHash: string
  }> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO analytics.identity_bridge_events (
           bridge_event_id,metric_subject_id,subject_kind,subject_ref_hash,bridge_version,
           link_action,status,effective_at,created_at
         ) VALUES ($1,$2,$3,$4,$5,'created','active',$6,$6)
         ON CONFLICT (subject_kind,subject_ref_hash,bridge_version) DO NOTHING`,
        [
          randomUUID(), input.metricSubjectId, input.subject.kind, input.subjectRefHash,
          input.bridgeVersion, input.receivedAt,
        ],
      )
      const inserted = await client.query<EventRow>(
        `INSERT INTO analytics.events (
           event_id,event_name,event_version,occurred_at,received_at,app_version,
           environment,actor_type,page_id,source_page,request_id,consent_state,payload,
           session_id_hash,metric_subject_id,subject_kind,bridge_version,clock_skew_flag,payload_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'client',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING payload_hash`,
        [
          input.event.eventId,
          input.event.eventName,
          input.event.eventVersion,
          input.event.occurredAt,
          input.receivedAt,
          input.event.appVersion,
          input.environment,
          input.event.pageId,
          input.event.sourcePage,
          input.event.requestId,
          input.consentState,
          input.event.payload,
          input.sessionHash,
          input.metricSubjectId,
          input.subject.kind,
          input.bridgeVersion,
          input.clockSkewFlag,
          input.payloadHash,
        ],
      )
      let payloadHash = inserted.rows[0]?.payload_hash
      if (payloadHash === undefined) {
        const existing = await client.query<EventRow>(
          'SELECT payload_hash FROM analytics.events WHERE event_id=$1',
          [input.event.eventId],
        )
        payloadHash = existing.rows[0]?.payload_hash
      }
      if (payloadHash === undefined) throw new Error('ANALYTICS_EVENT_PERSISTENCE_FAILED')
      await client.query('COMMIT')
      return Object.freeze({ inserted: inserted.rowCount === 1, payloadHash })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async persistReceipt(input: PersistAnalyticsReceiptInput): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO analytics.ingest_receipts (
           receipt_id,batch_hash,session_hash,http_status,accepted_count,rejected_count,created_at
         ) VALUES ($1,$2,$3,202,$4,$5,$6)`,
        [
          input.receiptId,
          input.batchHash,
          input.sessionHash,
          input.items.filter(({ status }) => status !== 'rejected').length,
          input.items.filter(({ status }) => status === 'rejected').length,
          input.createdAt,
        ],
      )
      for (const [index, item] of input.items.entries()) {
        await client.query(
          `INSERT INTO analytics.ingest_items (
             receipt_id,item_index,event_id,status,error_code,payload_hash,created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            input.receiptId,
            index,
            item.event_id,
            item.status,
            item.error_code ?? null,
            input.itemPayloadHashes[index]!,
            input.createdAt,
          ],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
