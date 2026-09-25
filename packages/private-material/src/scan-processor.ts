import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import { privateMaterialError } from './errors.js'
import type { PrivateMaterialStorageKeyResolver } from './service.js'
import type { StoredMaterial } from './store.js'
import type { PrivateMaterialScanSource, PrivateMaterialStorage } from './types.js'

const pendingPollSeconds = 15
const providerRetryBaseSeconds = 30
const maximumProviderFailures = 3
const scanClaimLeaseSeconds = 60

export class PostgresPrivateMaterialScanStore {
  constructor(private readonly pool: Pool) {}

  async claim(materialId: string, now: Date): Promise<StoredMaterial | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query<StoredMaterial>(
        `SELECT * FROM private_material.verification_materials
         WHERE material_id=$1::uuid FOR UPDATE`,
        [materialId],
      )
      let row = locked.rows[0]
      if (!row) throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND', 404)
      if (['ready','abandoned','rejected','revoked','deleted'].includes(row.status)) {
        await client.query('COMMIT')
        return null
      }
      if (row.status==='prepared') throw privateMaterialError('MATERIAL_SCAN_NOT_UPLOADED', 409)
      if (row.processing_deadline_at && row.processing_deadline_at<=now) {
        await client.query(
          `UPDATE private_material.verification_materials SET status='rejected',
             rejection_reason_code='SCAN_DEADLINE_EXCEEDED',next_scan_at=NULL,version=version+1,
             updated_at=GREATEST($2::timestamptz,updated_at+interval '1 microsecond')
           WHERE material_id=$1::uuid`,
          [materialId, now],
        )
        await this.audit(client, materialId, 'scan_result', 'deadline_exceeded', now)
        await client.query('COMMIT')
        return null
      }
      if (row.next_scan_at && row.next_scan_at>now) {
        await client.query('COMMIT')
        return null
      }
      const claimLeaseUntil = boundedNextScanAt(row, now, scanClaimLeaseSeconds)
      row = (await client.query<StoredMaterial>(
        `UPDATE private_material.verification_materials SET
           status='scanning',next_scan_at=$3::timestamptz,version=version+1,
           updated_at=GREATEST($2::timestamptz,updated_at+interval '1 microsecond')
         WHERE material_id=$1::uuid RETURNING *`,
        [materialId, now, claimLeaseUntil],
      )).rows[0]!
      await this.audit(client, materialId, 'scan_claim', 'guardduty_tag_poll', now)
      await client.query('COMMIT')
      return row
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async deferPending(materialId: string, expectedVersion: number, now: Date): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const row = await this.lockCurrent(client, materialId)
      if (this.isTerminal(row)) {
        await client.query('COMMIT')
        return
      }
      this.assertScanningVersion(row, expectedVersion)
      const nextScanAt = boundedNextScanAt(row, now, pendingPollSeconds)
      await client.query(
        `UPDATE private_material.verification_materials SET next_scan_at=$2::timestamptz,
           version=version+1,
           updated_at=GREATEST($3::timestamptz,updated_at+interval '1 microsecond')
         WHERE material_id=$1::uuid`,
        [materialId, nextScanAt, now],
      )
      await this.schedule(client, materialId, nextScanAt, now)
      await this.audit(client, materialId, 'scan_result', 'pending', now)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async finish(
    materialId: string,
    expectedVersion: number,
    result: 'clean' | 'malicious' | 'unscannable',
    now: Date,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const row = await this.lockCurrent(client, materialId)
      if (this.isTerminal(row)) {
        await client.query('COMMIT')
        return
      }
      this.assertScanningVersion(row, expectedVersion)
      const status = result==='clean' ? 'ready' : 'rejected'
      const reason = result==='malicious'
        ? 'MALWARE_DETECTED'
        : result==='unscannable'
          ? 'SCAN_UNSCANNABLE'
          : null
      await client.query(
        `UPDATE private_material.verification_materials SET status=$3::varchar,
           scan_result=$4::varchar,rejection_reason_code=$5::varchar,next_scan_at=NULL,
           version=version+1,
           updated_at=GREATEST($2::timestamptz,updated_at+interval '1 microsecond')
         WHERE material_id=$1::uuid`,
        [materialId, now, status, result, reason],
      )
      await this.audit(client, materialId, 'scan_result', result, now)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async recordFailure(materialId: string, expectedVersion: number, now: Date): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const row = await this.lockCurrent(client, materialId)
      if (this.isTerminal(row)) {
        await client.query('COMMIT')
        return
      }
      this.assertScanningVersion(row, expectedVersion)
      const attemptCount = Number(row.scan_attempt_count)+1
      const exhausted = attemptCount>=maximumProviderFailures
      const delaySeconds = providerRetryBaseSeconds*Math.pow(2, Math.max(0, attemptCount-1))
      const nextScanAt = exhausted ? null : boundedNextScanAt(row, now, delaySeconds)
      await client.query(
        `UPDATE private_material.verification_materials SET
           status=CASE WHEN $3::boolean THEN 'rejected' ELSE 'scanning' END,
           scan_attempt_count=$4::integer,
           rejection_reason_code=CASE WHEN $3::boolean THEN 'SCAN_RETRY_EXHAUSTED' ELSE NULL END,
           next_scan_at=$5::timestamptz,version=version+1,
           updated_at=GREATEST($2::timestamptz,updated_at+interval '1 microsecond')
         WHERE material_id=$1::uuid`,
        [materialId, now, exhausted, attemptCount, nextScanAt],
      )
      if (nextScanAt) await this.schedule(client, materialId, nextScanAt, now)
      await this.audit(
        client,
        materialId,
        'scan_result',
        exhausted ? 'retry_exhausted' : 'retryable_failure',
        now,
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async sweepExpired(now: Date, limit: number): Promise<number> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{ material_id: string; result: string }>(
        `WITH candidates AS (
           SELECT material_id FROM private_material.verification_materials
           WHERE (status='prepared' AND upload_expires_at<$1::timestamptz)
              OR (status IN ('uploaded','scanning') AND processing_deadline_at<$1::timestamptz)
           ORDER BY COALESCE(processing_deadline_at,upload_expires_at),material_id
           FOR UPDATE SKIP LOCKED LIMIT $2::integer
         )
         UPDATE private_material.verification_materials AS material SET
           status=CASE WHEN material.status='prepared' THEN 'abandoned' ELSE 'rejected' END,
           rejection_reason_code=CASE WHEN material.status='prepared'
             THEN 'UPLOAD_EXPIRED' ELSE 'SCAN_DEADLINE_EXCEEDED' END,
           next_scan_at=NULL,version=version+1,
           updated_at=GREATEST($1::timestamptz,updated_at+interval '1 microsecond')
         FROM candidates WHERE material.material_id=candidates.material_id
         RETURNING material.material_id,
           CASE WHEN material.status='abandoned' THEN 'upload_expired' ELSE 'deadline_exceeded' END AS result`,
        [now, limit],
      )
      for (const row of result.rows) {
        await this.audit(client, row.material_id, 'scan_result', row.result, now)
      }
      await client.query('COMMIT')
      return result.rowCount ?? 0
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async lockCurrent(client: PoolClient, materialId: string): Promise<StoredMaterial> {
    const result = await client.query<StoredMaterial>(
      `SELECT * FROM private_material.verification_materials
       WHERE material_id=$1::uuid FOR UPDATE`,
      [materialId],
    )
    const row = result.rows[0]
    if (!row) throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND', 404)
    return row
  }

  private isTerminal(row: StoredMaterial): boolean {
    return ['ready','abandoned','rejected','revoked','deleted'].includes(row.status)
  }

  private assertScanningVersion(row: StoredMaterial, expectedVersion: number): void {
    if (row.status!=='scanning' || Number(row.version)!==expectedVersion) {
      throw privateMaterialError('MATERIAL_SCAN_VERSION_CONFLICT', 409)
    }
  }

  private async schedule(
    client: PoolClient,
    materialId: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ops.outbox_events (
         event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
         transaction_id,status,next_attempt_at,created_at
       ) VALUES ($1::uuid,'verification_material',$2::varchar,
         'verification_material_scan_requested',1,jsonb_build_object('material_id',$2::varchar),
         $3::uuid,'pending',$4::timestamptz,$5::timestamptz)`,
      [randomUUID(), materialId, randomUUID(), nextAttemptAt, now],
    )
  }

  private async audit(
    client: PoolClient,
    materialId: string,
    action: string,
    result: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO private_material.material_access_logs
       (material_id,action,purpose,result,request_id,occurred_at)
       VALUES ($1::uuid,$2::varchar,'malware_scan',$3::varchar,'worker',$4::timestamptz)`,
      [materialId, action, result, now],
    )
  }
}

function boundedNextScanAt(row: StoredMaterial, now: Date, delaySeconds: number): Date {
  const proposed = new Date(now.getTime()+delaySeconds*1_000)
  return row.processing_deadline_at && proposed>row.processing_deadline_at
    ? row.processing_deadline_at
    : proposed
}

export interface PrivateMaterialScanStorePort {
  claim: PostgresPrivateMaterialScanStore['claim']
  deferPending: PostgresPrivateMaterialScanStore['deferPending']
  finish: PostgresPrivateMaterialScanStore['finish']
  recordFailure: PostgresPrivateMaterialScanStore['recordFailure']
}

export class PrivateMaterialScanProcessor {
  constructor(private readonly dependencies: Readonly<{
    store: PrivateMaterialScanStorePort
    scanner: PrivateMaterialScanSource
    storage: Pick<PrivateMaterialStorage, 'allowReads'>
    resolveStorageKey: PrivateMaterialStorageKeyResolver
    now?: () => Date
  }>) {}

  async process(materialId: string): Promise<void> {
    const now = this.dependencies.now?.() ?? new Date()
    const row = await this.dependencies.store.claim(materialId, now)
    if (!row) return
    const storageKey = this.dependencies.resolveStorageKey(row)
    const result = await this.dependencies.scanner.getScanResult({ storageKey })
    if (result==='pending') {
      await this.dependencies.store.deferPending(materialId, Number(row.version), now)
      return
    }
    if (result==='retryable_failure') {
      await this.dependencies.store.recordFailure(materialId, Number(row.version), now)
      return
    }
    if (result==='clean') {
      try {
        await this.dependencies.storage.allowReads({ storageKey })
      } catch {
        await this.dependencies.store.recordFailure(materialId, Number(row.version), now)
        return
      }
    }
    await this.dependencies.store.finish(materialId, Number(row.version), result, now)
  }
}
