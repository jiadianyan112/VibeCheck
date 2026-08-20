import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { mediaError } from './errors.js'
import type { MediaScanStorage, PublicMediaMime } from './types.js'

const pendingSeconds = 15
const leaseSeconds = 60
const maximumFailures = 3

interface ScanRow extends QueryResultRow {
  readonly media_resource_id: string
  readonly owner_user_id: string
  readonly storage_key: string
  readonly declared_mime: PublicMediaMime
  readonly status: string
  readonly scan_result: string
  readonly scan_attempt_count: number
  readonly next_scan_at: Date | null
  readonly processing_deadline_at: Date | null
  readonly version: number
}

export class PostgresMediaScanStore {
  constructor(private readonly pool: Pool) {}

  async claim(mediaResourceId: string, now: Date): Promise<ScanRow | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      let row = (await client.query<ScanRow>(
        'SELECT * FROM media.media_resources WHERE media_resource_id=$1 FOR UPDATE',
        [mediaResourceId],
      )).rows[0]
      if (!row) throw mediaError('MEDIA_RESOURCE_NOT_FOUND', 404)
      if (['ready', 'rejected', 'deleted'].includes(row.status)) {
        await client.query('COMMIT'); return null
      }
      if (!['uploaded', 'scanning'].includes(row.status)) {
        throw mediaError('MEDIA_SCAN_NOT_UPLOADED', 409)
      }
      if (row.processing_deadline_at && row.processing_deadline_at <= now) {
        await this.reject(client, row, 'SCAN_DEADLINE_EXCEEDED', 'unscannable', now)
        await client.query('COMMIT'); return null
      }
      if (row.next_scan_at && row.next_scan_at > now) {
        await client.query('COMMIT'); return null
      }
      const next = boundedNext(row, now, leaseSeconds)
      row = (await client.query<ScanRow>(
        `UPDATE media.media_resources SET status='scanning',next_scan_at=$2,
           version=version+1,updated_at=GREATEST($3,updated_at+interval '1 microsecond')
         WHERE media_resource_id=$1 RETURNING *`,
        [mediaResourceId, next, now],
      )).rows[0]!
      await this.audit(client, row, 'media_scan_claimed', now)
      await client.query('COMMIT')
      return row
    } catch (error) {
      await client.query('ROLLBACK'); throw error
    } finally { client.release() }
  }

  async deferPending(mediaResourceId: string, expectedVersion: number, now: Date): Promise<void> {
    await this.mutateClaim(mediaResourceId, expectedVersion, async (client, row) => {
      const next = boundedNext(row, now, pendingSeconds)
      await client.query(
        `UPDATE media.media_resources SET next_scan_at=$2,version=version+1,
           updated_at=GREATEST($3,updated_at+interval '1 microsecond')
         WHERE media_resource_id=$1`, [mediaResourceId, next, now],
      )
      await this.schedule(client, mediaResourceId, next, now)
      await this.audit(client, row, 'media_scan_pending', now)
    })
  }

  async recordFailure(mediaResourceId: string, expectedVersion: number, now: Date): Promise<void> {
    await this.mutateClaim(mediaResourceId, expectedVersion, async (client, row) => {
      const attempts = Number(row.scan_attempt_count) + 1
      if (attempts >= maximumFailures) {
        await client.query(
          `UPDATE media.media_resources SET status='rejected',scan_result='unscannable',
             rejection_reason_code='SCAN_RETRY_EXHAUSTED',scan_attempt_count=$2,next_scan_at=NULL,
             version=version+1,updated_at=GREATEST($3,updated_at+interval '1 microsecond')
           WHERE media_resource_id=$1`, [mediaResourceId, attempts, now],
        )
        await this.audit(client, row, 'media_scan_retry_exhausted', now)
        return
      }
      const next = boundedNext(row, now, 30 * Math.pow(2, attempts - 1))
      await client.query(
        `UPDATE media.media_resources SET scan_attempt_count=$2,next_scan_at=$3,
           version=version+1,updated_at=GREATEST($4,updated_at+interval '1 microsecond')
         WHERE media_resource_id=$1`, [mediaResourceId, attempts, next, now],
      )
      await this.schedule(client, mediaResourceId, next, now)
      await this.audit(client, row, 'media_scan_retry_scheduled', now)
    })
  }

  async finishRejected(
    mediaResourceId: string, expectedVersion: number,
    result: 'malicious' | 'unscannable', now: Date,
  ): Promise<void> {
    await this.mutateClaim(mediaResourceId, expectedVersion, async (client, row) => {
      await this.reject(
        client, row, result === 'malicious' ? 'MALWARE_DETECTED' : 'SCAN_UNSCANNABLE', result, now,
      )
      await this.audit(client, row, `media_scan_${result}`, now)
    })
  }

  async finishReady(
    mediaResourceId: string, expectedVersion: number,
    result: Awaited<ReturnType<MediaScanStorage['sanitizeImage']>>, now: Date,
  ): Promise<void> {
    await this.mutateClaim(mediaResourceId, expectedVersion, async (client, row) => {
      const updated = await client.query(
        `UPDATE media.media_resources SET storage_key=$2,detected_mime=$3,width=$4,height=$5,
           status='ready',scan_result='clean',exif_removed=true,rejection_reason_code=NULL,
           next_scan_at=NULL,version=version+1,
           updated_at=GREATEST($6,updated_at+interval '1 microsecond')
         WHERE media_resource_id=$1`,
        [mediaResourceId, result.finalStorageKey, result.detectedMime, result.width, result.height, now],
      )
      if (updated.rowCount !== 1) throw mediaError('MEDIA_SCAN_FINALIZE_FAILED', 500, true)
      await this.audit(client, row, 'media_scan_ready', now)
    })
  }

  async sweepExpired(now: Date, limit: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE media.media_resources SET status='rejected',scan_result='unscannable',
         rejection_reason_code=CASE WHEN status='uploading' THEN 'UPLOAD_EXPIRED' ELSE 'SCAN_DEADLINE_EXCEEDED' END,
         next_scan_at=NULL,version=version+1,updated_at=GREATEST($1,updated_at+interval '1 microsecond')
       WHERE media_resource_id IN (
         SELECT media_resource_id FROM media.media_resources
         WHERE (status='uploading' AND upload_expires_at<$1)
            OR (status IN ('uploaded','scanning') AND processing_deadline_at<$1)
         ORDER BY COALESCE(processing_deadline_at,upload_expires_at),media_resource_id
         FOR UPDATE SKIP LOCKED LIMIT $2
       )`, [now, limit],
    )
    return result.rowCount ?? 0
  }

  private async mutateClaim(
    id: string, expectedVersion: number,
    mutation: (client: PoolClient, row: ScanRow) => Promise<void>,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const row = (await client.query<ScanRow>(
        'SELECT * FROM media.media_resources WHERE media_resource_id=$1 FOR UPDATE', [id],
      )).rows[0]
      if (!row) throw mediaError('MEDIA_RESOURCE_NOT_FOUND', 404)
      if (['ready', 'rejected', 'deleted'].includes(row.status)) {
        await client.query('COMMIT'); return
      }
      if (row.status !== 'scanning' || Number(row.version) !== expectedVersion) {
        throw mediaError('MEDIA_SCAN_VERSION_CONFLICT', 409)
      }
      await mutation(client, row)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK'); throw error
    } finally { client.release() }
  }

  private reject(
    client: PoolClient, row: ScanRow, reason: string,
    result: 'malicious' | 'unscannable', now: Date,
  ): Promise<unknown> {
    return client.query(
      `UPDATE media.media_resources SET status='rejected',scan_result=$2,
         rejection_reason_code=$3,next_scan_at=NULL,version=version+1,
         updated_at=GREATEST($4,updated_at+interval '1 microsecond')
       WHERE media_resource_id=$1`, [row.media_resource_id, result, reason, now],
    )
  }

  private schedule(client: PoolClient, id: string, next: Date, now: Date): Promise<unknown> {
    return client.query(
      `INSERT INTO ops.outbox_events (
         event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
         transaction_id,status,next_attempt_at,created_at
       ) VALUES ($1,'media_resource',$2,'media_scan_requested',1,
         jsonb_build_object('media_resource_id',$2),$3,'pending',$4,$5)`,
      [randomUUID(), id, randomUUID(), next, now],
    )
  }

  private audit(client: PoolClient, row: ScanRow, reason: string, now: Date): Promise<unknown> {
    return client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_roles_json,target_type,target_id,
         after_hash,diff_json,reason_code,request_id,result,created_at
       ) VALUES ($1,'OP-MEDIA-SCAN','system','[]'::jsonb,'media_resource',$2,$3,
         jsonb_build_object('status',$4),'media_scan','worker','succeeded',$5)`,
      [randomUUID(), row.media_resource_id,
        createHash('sha256').update(`${row.media_resource_id}:${reason}`).digest('hex'), reason, now],
    )
  }
}

export interface MediaScanStorePort {
  claim: PostgresMediaScanStore['claim']
  deferPending: PostgresMediaScanStore['deferPending']
  recordFailure: PostgresMediaScanStore['recordFailure']
  finishRejected: PostgresMediaScanStore['finishRejected']
  finishReady: PostgresMediaScanStore['finishReady']
}

export class MediaScanProcessor {
  constructor(private readonly dependencies: Readonly<{
    store: MediaScanStorePort
    storage: MediaScanStorage
    now?: () => Date
  }>) {}

  async process(mediaResourceId: string): Promise<void> {
    const now = this.dependencies.now?.() ?? new Date()
    const row = await this.dependencies.store.claim(mediaResourceId, now)
    if (!row) return
    const result = await this.dependencies.storage.getScanResult({ storageKey: row.storage_key })
    if (result === 'pending') {
      await this.dependencies.store.deferPending(mediaResourceId, Number(row.version), now); return
    }
    if (result === 'retryable_failure') {
      await this.dependencies.store.recordFailure(mediaResourceId, Number(row.version), now); return
    }
    if (result === 'malicious' || result === 'unscannable') {
      await this.dependencies.store.finishRejected(mediaResourceId, Number(row.version), result, now); return
    }
    try {
      const processed = await this.dependencies.storage.sanitizeImage({
        storageKey: row.storage_key, mediaResourceId: row.media_resource_id,
        ownerUserId: row.owner_user_id, declaredMime: row.declared_mime,
      })
      await this.dependencies.store.finishReady(mediaResourceId, Number(row.version), processed, now)
    } catch {
      await this.dependencies.store.recordFailure(mediaResourceId, Number(row.version), now)
    }
  }
}

function boundedNext(row: ScanRow, now: Date, seconds: number): Date {
  const proposed = new Date(now.getTime() + seconds * 1_000)
  return row.processing_deadline_at && proposed > row.processing_deadline_at
    ? row.processing_deadline_at : proposed
}
