import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { mediaError } from './errors.js'
import type { MediaStore } from './store-port.js'
import type {
  MediaReferencePage,
  MediaReferenceProjection,
  MediaResourceProjection,
  MediaResourceStatus,
  MediaScanResult,
  MediaTargetType,
} from './types.js'

interface ResourceRow extends QueryResultRow {
  readonly media_resource_id: string
  readonly owner_user_id: string
  readonly declared_mime: string
  readonly detected_mime: string | null
  readonly byte_size: string
  readonly width: number | null
  readonly height: number | null
  readonly duration_ms: number | null
  readonly checksum_sha256: string
  readonly source: 'upload' | 'migration'
  readonly status: MediaResourceStatus
  readonly scan_result: MediaScanResult
  readonly rejection_reason_code: string | null
  readonly scan_attempt_count: number
  readonly next_scan_at: Date | null
  readonly exif_removed: boolean
  readonly deletion_guard_job_id: string | null
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface ReferenceRow extends QueryResultRow {
  readonly media_reference_id: string
  readonly media_resource_id: string
  readonly target_type: MediaTargetType
  readonly target_id: string
  readonly role: string
  readonly alt_text: string
  readonly sort_order: number
  readonly crop_focus_json: unknown
  readonly variant: string | null
  readonly source_media_reference_id: string | null
  readonly lifecycle_status: 'active' | 'unlinked'
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface ReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

interface SubmissionDraftRow extends QueryResultRow {
  readonly owner_user_id: string
  readonly status: string
  readonly expires_at: Date
}

export class PostgresMediaStore implements MediaStore {
  constructor(private readonly pool: Pool) {}

  async getResource(input: Parameters<MediaStore['getResource']>[0]): Promise<MediaResourceProjection> {
    const result = await this.pool.query<ResourceRow>(
      'SELECT * FROM media.media_resources WHERE media_resource_id=$1',
      [input.mediaResourceId],
    )
    const row = result.rows[0]
    if (!row) throw mediaError('MEDIA_RESOURCE_NOT_FOUND', 404)
    if (row.owner_user_id !== input.userId) throw mediaError('MEDIA_RESOURCE_FORBIDDEN', 403)
    if (row.status === 'deleted') throw mediaError('MEDIA_RESOURCE_GONE', 410)
    return this.resourceProjection(row)
  }

  async createReference(
    input: Parameters<MediaStore['createReference']>[0],
  ): Promise<MediaReferenceProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.referenceReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const resource = await this.lockReadyResource(client, input.mediaResourceId, input.userId)
      await this.authorizeTarget(client, input.targetType, input.targetId, input.userId, input.now, true)
      const mediaReferenceId = randomUUID()
      let inserted
      try {
        inserted = await client.query<ReferenceRow>(
          `INSERT INTO media.media_references (
             media_reference_id,media_resource_id,target_type,target_id,role,alt_text,
             sort_order,crop_focus_json,variant,created_at,updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$10) RETURNING *`,
          [
            mediaReferenceId, resource.media_resource_id, input.targetType, input.targetId,
            input.role, input.altText, input.sortOrder,
            input.cropFocus === null ? null : JSON.stringify(input.cropFocus), input.variant, input.now,
          ],
        )
      } catch (error) {
        if (this.pgCode(error) === '23505') throw mediaError('MEDIA_REFERENCE_POSITION_CONFLICT', 409)
        throw error
      }
      const row = inserted.rows[0]
      if (!row) throw mediaError('MEDIA_REFERENCE_CREATE_FAILED', 500, true)
      await this.addReferenceToTarget(client, input.targetType, input.targetId, row.media_reference_id, input.now)
      const projection = this.referenceProjection(row)
      await this.saveReceipt(
        client, input.userId, input.operationId, 'create', input.requestHash,
        row.media_reference_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-MEDIA-REF-CREATE', userId: input.userId,
        targetId: row.media_reference_id, requestId: input.requestId,
        reasonCode: 'media_reference_created', before: null, after: projection, now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listReferences(
    input: Parameters<MediaStore['listReferences']>[0],
  ): Promise<MediaReferencePage> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      await this.authorizeTarget(client, input.targetType, input.targetId, input.userId, input.now, false)
      const result = await client.query<ReferenceRow>(
        `SELECT * FROM media.media_references
         WHERE target_type=$1 AND target_id=$2 AND lifecycle_status='active'
           AND ($3::varchar IS NULL OR role=$3)
         ORDER BY role,sort_order,media_reference_id`,
        [input.targetType, input.targetId, input.role],
      )
      await client.query('COMMIT')
      return Object.freeze({
        items: Object.freeze(result.rows.map((row) => this.referenceProjection(row))),
        total_count: result.rows.length,
      })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async patchReference(
    input: Parameters<MediaStore['patchReference']>[0],
  ): Promise<MediaReferenceProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.referenceReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const before = await this.lockReference(client, input.mediaReferenceId)
      if (before.lifecycle_status === 'unlinked') throw mediaError('MEDIA_REFERENCE_GONE', 410)
      if (['project_version', 'creator_profile_version'].includes(before.target_type)) {
        throw mediaError('MEDIA_REFERENCE_IMMUTABLE', 409)
      }
      await this.authorizeTarget(client, before.target_type, before.target_id, input.userId, input.now, true)
      if (before.version !== input.expectedVersion) {
        throw mediaError('MEDIA_REFERENCE_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: before.version,
        })
      }
      let updated
      try {
        updated = await client.query<ReferenceRow>(
          `UPDATE media.media_references SET alt_text=$2,sort_order=$3,crop_focus_json=$4::jsonb,
             variant=$5,version=version+1,updated_at=$6
           WHERE media_reference_id=$1 AND lifecycle_status='active' AND version=$7 RETURNING *`,
          [
            before.media_reference_id, input.altText, input.sortOrder,
            input.cropFocus === null ? null : JSON.stringify(input.cropFocus), input.variant,
            input.now, input.expectedVersion,
          ],
        )
      } catch (error) {
        if (this.pgCode(error) === '23505') throw mediaError('MEDIA_REFERENCE_POSITION_CONFLICT', 409)
        throw error
      }
      const row = updated.rows[0]
      if (!row) throw mediaError('MEDIA_REFERENCE_VERSION_CONFLICT', 409)
      const projection = this.referenceProjection(row)
      await this.saveReceipt(
        client, input.userId, input.operationId, 'patch', input.requestHash,
        row.media_reference_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-MEDIA-REF-PATCH', userId: input.userId,
        targetId: row.media_reference_id, requestId: input.requestId,
        reasonCode: 'media_reference_updated', before: this.referenceProjection(before),
        after: projection, now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async deleteReference(input: Parameters<MediaStore['deleteReference']>[0]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        await client.query('COMMIT')
        return
      }
      const before = await this.lockReference(client, input.mediaReferenceId)
      if (['project_version', 'creator_profile_version'].includes(before.target_type)) {
        throw mediaError('MEDIA_REFERENCE_IMMUTABLE', 409)
      }
      await this.authorizeTarget(client, before.target_type, before.target_id, input.userId, input.now, true)
      if (before.lifecycle_status === 'unlinked') throw mediaError('MEDIA_REFERENCE_GONE', 410)
      if (before.version !== input.expectedVersion) {
        throw mediaError('MEDIA_REFERENCE_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: before.version,
        })
      }
      const updated = await client.query<ReferenceRow>(
        `UPDATE media.media_references SET lifecycle_status='unlinked',unlinked_at=$2,
           version=version+1,updated_at=$2
         WHERE media_reference_id=$1 AND lifecycle_status='active' AND version=$3 RETURNING *`,
        [before.media_reference_id, input.now, input.expectedVersion],
      )
      if (!updated.rows[0]) throw mediaError('MEDIA_REFERENCE_VERSION_CONFLICT', 409)
      await this.removeReferenceFromTarget(
        client, before.target_type, before.target_id, before.media_reference_id, input.now,
      )
      await this.saveReceipt(
        client, input.userId, input.operationId, 'delete', input.requestHash,
        before.media_reference_id, Object.freeze({ deleted: true }), input.now,
      )
      await this.audit(client, {
        operationId: 'OP-MEDIA-REF-DELETE', userId: input.userId,
        targetId: before.media_reference_id, requestId: input.requestId,
        reasonCode: 'media_reference_unlinked', before: this.referenceProjection(before),
        after: Object.freeze({ lifecycle_status: 'unlinked' }), now: input.now,
      })
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async authorizeTarget(
    client: PoolClient,
    targetType: MediaTargetType,
    targetId: string,
    userId: string,
    now: Date,
    requireEditing: boolean,
  ): Promise<void> {
    if (targetType !== 'submission_draft') {
      throw mediaError('MEDIA_TARGET_TYPE_UNAVAILABLE', 503, true)
    }
    const result = await client.query<SubmissionDraftRow>(
      `SELECT owner_user_id,status,expires_at FROM workflow.submission_drafts
       WHERE draft_id=$1 ${requireEditing ? 'FOR UPDATE' : ''}`,
      [targetId],
    )
    const row = result.rows[0]
    if (!row) throw mediaError('MEDIA_TARGET_NOT_FOUND', 404)
    if (row.owner_user_id !== userId) throw mediaError('MEDIA_TARGET_FORBIDDEN', 403)
    if (row.expires_at <= now) throw mediaError('MEDIA_TARGET_GONE', 410)
    if (requireEditing && row.status !== 'editing') throw mediaError('MEDIA_TARGET_READ_ONLY', 409)
  }

  private async lockReadyResource(
    client: PoolClient,
    mediaResourceId: string,
    userId: string,
  ): Promise<ResourceRow> {
    const result = await client.query<ResourceRow>(
      'SELECT * FROM media.media_resources WHERE media_resource_id=$1 FOR UPDATE',
      [mediaResourceId],
    )
    const row = result.rows[0]
    if (!row) throw mediaError('MEDIA_RESOURCE_NOT_FOUND', 404)
    if (row.owner_user_id !== userId) throw mediaError('MEDIA_RESOURCE_FORBIDDEN', 403)
    if (row.deletion_guard_job_id !== null) throw mediaError('MEDIA_DELETE_IN_PROGRESS', 409)
    if (row.status === 'deleted') throw mediaError('MEDIA_RESOURCE_GONE', 410)
    if (row.status !== 'ready' || row.scan_result !== 'clean') {
      throw mediaError('MEDIA_RESOURCE_NOT_READY', 422)
    }
    return row
  }

  private async lockReference(client: PoolClient, mediaReferenceId: string): Promise<ReferenceRow> {
    const result = await client.query<ReferenceRow>(
      'SELECT * FROM media.media_references WHERE media_reference_id=$1 FOR UPDATE',
      [mediaReferenceId],
    )
    const row = result.rows[0]
    if (!row) throw mediaError('MEDIA_REFERENCE_NOT_FOUND', 404)
    return row
  }

  private async addReferenceToTarget(
    client: PoolClient,
    targetType: MediaTargetType,
    targetId: string,
    referenceId: string,
    now: Date,
  ): Promise<void> {
    if (targetType !== 'submission_draft') return
    await client.query(
      `UPDATE workflow.submission_drafts
       SET media_reference_ids_json = CASE
         WHEN media_reference_ids_json @> jsonb_build_array($2::text) THEN media_reference_ids_json
         ELSE media_reference_ids_json || jsonb_build_array($2::text)
       END,version=version+1,updated_at=$3,saved_at=$3
       WHERE draft_id=$1`,
      [targetId, referenceId, now],
    )
  }

  private async removeReferenceFromTarget(
    client: PoolClient,
    targetType: MediaTargetType,
    targetId: string,
    referenceId: string,
    now: Date,
  ): Promise<void> {
    if (targetType !== 'submission_draft') return
    await client.query(
      `UPDATE workflow.submission_drafts SET media_reference_ids_json=COALESCE((
         SELECT jsonb_agg(value) FROM jsonb_array_elements(media_reference_ids_json) value
         WHERE value <> to_jsonb($2::text)
       ),'[]'::jsonb),version=version+1,updated_at=$3,saved_at=$3 WHERE draft_id=$1`,
      [targetId, referenceId, now],
    )
  }

  private async receipt(
    client: PoolClient,
    userId: string,
    operationId: string,
  ): Promise<ReceiptRow | null> {
    const result = await client.query<ReceiptRow>(
      `SELECT request_hash,response_json FROM media.media_reference_operation_receipts
       WHERE owner_user_id=$1 AND operation_id=$2`,
      [userId, operationId],
    )
    return result.rows[0] ?? null
  }

  private assertReceipt(receipt: { readonly request_hash: string }, requestHash: string): void {
    if (receipt.request_hash !== requestHash) throw mediaError('OPERATION_ID_REUSED', 409)
  }

  private async saveReceipt(
    client: PoolClient,
    userId: string,
    operationId: string,
    operationType: 'create' | 'patch' | 'delete',
    requestHash: string,
    mediaReferenceId: string,
    response: unknown,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO media.media_reference_operation_receipts (
         owner_user_id,operation_id,operation_type,request_hash,
         media_reference_id,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [userId, operationId, operationType, requestHash, mediaReferenceId, JSON.stringify(response), now],
    )
  }

  private async audit(
    client: PoolClient,
    input: {
      readonly operationId: string
      readonly userId: string
      readonly targetId: string
      readonly requestId: string
      readonly reasonCode: string
      readonly before: unknown
      readonly after: unknown
      readonly now: Date
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,diff_json,reason_code,request_id,result,created_at
       ) VALUES ($1,$2,'user',$3,'["user"]'::jsonb,'media_reference',$4,$5,$6,$7::jsonb,$8,$9,'succeeded',$10)`,
      [
        randomUUID(), input.operationId.slice(0, 64),
        createHash('sha256').update(input.userId).digest(), input.targetId,
        input.before === null ? null : this.objectHash(input.before), this.objectHash(input.after),
        JSON.stringify({ operation: input.reasonCode }), input.reasonCode,
        input.requestId.slice(0, 64), input.now,
      ],
    )
  }

  private resourceProjection(row: ResourceRow): MediaResourceProjection {
    const byteSize = Number(row.byte_size)
    if (!Number.isSafeInteger(byteSize)) throw mediaError('MEDIA_RESOURCE_STATE_INVALID', 500, true)
    return Object.freeze({
      media_resource_id: row.media_resource_id,
      declared_mime: row.declared_mime,
      detected_mime: row.detected_mime,
      byte_size: byteSize,
      width: row.width,
      height: row.height,
      duration_ms: row.duration_ms,
      checksum_sha256: row.checksum_sha256,
      source: row.source,
      status: row.status,
      scan_result: row.scan_result,
      rejection_reason_code: row.rejection_reason_code,
      scan_attempt_count: row.scan_attempt_count,
      next_scan_at: row.next_scan_at?.toISOString() ?? null,
      exif_removed: row.exif_removed,
      deletion_guard_active: row.deletion_guard_job_id !== null,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private referenceProjection(row: ReferenceRow): MediaReferenceProjection {
    const cropFocus = row.crop_focus_json === null
      ? null
      : Object.freeze(row.crop_focus_json as Record<string, unknown>)
    return Object.freeze({
      media_reference_id: row.media_reference_id,
      media_resource_id: row.media_resource_id,
      target_type: row.target_type,
      target_id: row.target_id,
      role: row.role,
      alt_text: row.alt_text,
      sort_order: row.sort_order,
      crop_focus: cropFocus,
      variant: row.variant,
      source_media_reference_id: row.source_media_reference_id,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private referenceReceipt(value: unknown): MediaReferenceProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw mediaError('MEDIA_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as MediaReferenceProjection
  }

  private objectHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
  }

  private pgCode(error: unknown): string | null {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      return error.code
    }
    return null
  }
}
