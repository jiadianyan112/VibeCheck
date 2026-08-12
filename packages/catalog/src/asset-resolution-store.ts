import { createHash } from 'node:crypto'

import type { Pool } from 'pg'

import { catalogError } from './errors.js'
import type {
  AssetResolutionProjection,
  AssetResolutionStore,
  StoredAssetResolutionTarget,
} from './asset-resolution.js'

interface ReceiptRow {
  readonly subject_hash: Buffer
  readonly request_hash: string
  readonly response_json: AssetResolutionProjection
  readonly expires_at: Date
}

interface TargetRow {
  readonly asset_id: string
  readonly project_id: string
  readonly safe_web_url: string | null
  readonly contact_uri: string | null
  readonly target_hash: Buffer
  readonly availability_status: string
  readonly asset_visibility: string
  readonly project_review_status: string
}

export class PostgresAssetResolutionStore implements AssetResolutionStore {
  constructor(private readonly pool: Pool) {}

  async getReceipt(
    attemptId: string,
    subjectHash: Buffer,
    requestHash: string,
    now: Date,
  ): Promise<AssetResolutionProjection | null> {
    const result = await this.pool.query<ReceiptRow>(
      `SELECT subject_hash,request_hash,response_json,expires_at
       FROM workflow.asset_resolution_receipts WHERE attempt_id=$1`,
      [attemptId],
    )
    const receipt = result.rows[0]
    if (!receipt) return null
    if (!receipt.subject_hash.equals(subjectHash) || receipt.request_hash !== requestHash) {
      throw catalogError('ASSET_ATTEMPT_CONFLICT', 409)
    }
    if (receipt.expires_at <= now) throw catalogError('ASSET_RESOLUTION_EXPIRED', 410)
    return Object.freeze(receipt.response_json)
  }

  async consumeRateLimit(input: {
    readonly subjectHash: Buffer
    readonly now: Date
    readonly windowStartedAt: Date
    readonly windowEndsAt: Date
    readonly limit: number
  }): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }> {
    const result = await this.pool.query<{ hit_count: number; blocked_until: Date | null }>(
      `INSERT INTO workflow.asset_resolution_rate_limit_buckets (
         subject_hash,window_started_at,hit_count,blocked_until,updated_at
       ) VALUES ($1,$2,1,NULL,now())
       ON CONFLICT (subject_hash,window_started_at) DO UPDATE
       SET hit_count=workflow.asset_resolution_rate_limit_buckets.hit_count+1,
           blocked_until=CASE
             WHEN workflow.asset_resolution_rate_limit_buckets.hit_count+1 > $3
             THEN $4::timestamptz
             ELSE workflow.asset_resolution_rate_limit_buckets.blocked_until
           END,
           updated_at=now()
       RETURNING hit_count,blocked_until`,
      [input.subjectHash, input.windowStartedAt, input.limit, input.windowEndsAt],
    )
    const row = result.rows[0]!
    return Object.freeze({
      allowed: row.hit_count <= input.limit && (row.blocked_until === null || row.blocked_until <= input.windowStartedAt),
      retryAfterSeconds: row.blocked_until === null
        ? 0
        : Math.max(1, Math.ceil((row.blocked_until.getTime() - input.now.getTime()) / 1_000)),
    })
  }

  async getTarget(assetId: string): Promise<StoredAssetResolutionTarget> {
    const result = await this.pool.query<TargetRow>(
      `SELECT asset.asset_id,asset.project_id,asset.safe_web_url,asset.contact_uri,
         asset.target_hash,asset.availability_status,asset.visibility AS asset_visibility,
         project.review_status AS project_review_status
       FROM catalog.assets asset
       JOIN catalog.projects project ON project.project_id=asset.project_id
       WHERE asset.asset_id=$1`,
      [assetId],
    )
    const row = result.rows[0]
    if (!row) return Object.freeze({ kind: 'missing' })
    if (row.project_review_status === 'deleted' || row.project_review_status === 'archived' || row.availability_status === 'removed') {
      return Object.freeze({ kind: 'gone' })
    }
    if (
      row.asset_visibility !== 'public' ||
      !['published_platform', 'published_author'].includes(row.project_review_status)
    ) return Object.freeze({ kind: 'forbidden' })
    return Object.freeze({
      kind: 'active',
      assetId: row.asset_id,
      projectId: row.project_id,
      safeWebUrl: row.safe_web_url,
      contactUri: row.contact_uri,
      targetHash: row.target_hash,
    })
  }

  async saveReceipt(input: {
    readonly projection: AssetResolutionProjection
    readonly subject: { readonly kind: 'anonymous' | 'user'; readonly id: string }
    readonly subjectHash: Buffer
    readonly targetHash: Buffer
    readonly requestHash: string
    readonly requestId: string
  }): Promise<AssetResolutionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `asset-resolution:${input.projection.attempt_id}`,
      ])
      const existing = await client.query<ReceiptRow>(
        `SELECT subject_hash,request_hash,response_json,expires_at
         FROM workflow.asset_resolution_receipts WHERE attempt_id=$1`,
        [input.projection.attempt_id],
      )
      if (existing.rows[0]) {
        const receipt = existing.rows[0]
        if (!receipt.subject_hash.equals(input.subjectHash) || receipt.request_hash !== input.requestHash) {
          throw catalogError('ASSET_ATTEMPT_CONFLICT', 409)
        }
        await client.query('COMMIT')
        return Object.freeze(receipt.response_json)
      }
      await client.query(
        `INSERT INTO workflow.asset_resolution_receipts (
           attempt_id,asset_id,project_id,subject_kind,subject_hash,target_kind,target_hash,
           request_hash,result,reason_code,response_json,request_id,created_at,expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          input.projection.attempt_id,
          input.projection.asset_id,
          input.projection.project_id,
          input.subject.kind,
          input.subjectHash,
          input.projection.target_kind,
          input.targetHash,
          input.requestHash,
          input.projection.result,
          input.projection.reason_code,
          input.projection,
          input.requestId,
          input.projection.checked_at,
          input.projection.expires_at,
        ],
      )
      const domainHash = input.projection.target_domain === null
        ? null
        : createHash('sha256').update(input.projection.target_domain, 'utf8').digest('hex')
      await client.query(
        `INSERT INTO audit.security_events (
           event_type,severity,actor_user_id_hash,target_type,target_id_hash,error_code,
           metadata_json,request_id,created_at
         ) VALUES ($1,$2,$3,'asset',digest($4::text,'sha256'),$5,$6,$7,$8)`,
        [
          `asset_resolution_${input.projection.result}`,
          input.projection.result === 'blocked' ? 'warning' : 'info',
          input.subject.kind === 'user' ? input.subjectHash : null,
          input.projection.asset_id,
          input.projection.reason_code,
          {
            attempt_id: input.projection.attempt_id,
            target_kind: input.projection.target_kind,
            result: input.projection.result,
            redirect_count: input.projection.redirect_count,
            target_domain_hash: domainHash,
          },
          input.requestId,
          input.projection.checked_at,
        ],
      )
      await client.query('COMMIT')
      return input.projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
