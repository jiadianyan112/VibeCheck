import { randomUUID } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import { privateMaterialError } from './errors.js'
import type { ApplicantMaterialSummary, StorageKeyCiphertext, VerificationMaterialMime } from './types.js'

export interface StoredMaterial extends QueryResultRow {
  readonly material_id: string
  readonly verification_id: string
  readonly owner_user_id: string
  readonly storage_key_ciphertext: Buffer
  readonly storage_key_nonce: Buffer
  readonly storage_key_auth_tag: Buffer
  readonly storage_key_version: string
  readonly declared_mime: VerificationMaterialMime
  readonly detected_mime: string | null
  readonly byte_size: number
  readonly checksum_sha256: string
  readonly status: 'prepared' | 'uploaded' | 'scanning' | 'ready' | 'abandoned' | 'rejected' | 'revoked' | 'deleted'
  readonly scan_result: 'not_scanned' | 'clean' | 'malicious' | 'unscannable'
  readonly rejection_reason_code: string | null
  readonly applicant_terminal_state_json: unknown
  readonly idempotency_key: string
  readonly request_hash: string
  readonly version: string
  readonly created_at: Date
  readonly updated_at: Date
  readonly upload_expires_at: Date
  readonly processing_deadline_at: Date | null
  readonly revoked_at: Date | null
}

export interface MaterialOperationReplay {
  readonly requestHash: string
  readonly response: unknown
}

export interface CompleteStoreResult {
  readonly material: StoredMaterial
  readonly operationResponse: unknown
  readonly replayed: boolean
}

export class PostgresPrivateMaterialStore {
  constructor(private readonly pool: Pool) {}

  async findPrepareReplay(userId: string, idempotencyKey: string): Promise<StoredMaterial | null> {
    const result = await this.pool.query<StoredMaterial>(
      `SELECT * FROM private_material.verification_materials
       WHERE owner_user_id=$1 AND idempotency_key=$2`,
      [userId, idempotencyKey],
    )
    return result.rows[0] ?? null
  }

  async getOwned(userId: string, materialId: string): Promise<StoredMaterial | null> {
    const result = await this.pool.query<StoredMaterial>(
      `SELECT * FROM private_material.verification_materials
       WHERE material_id=$1 AND owner_user_id=$2`,
      [materialId, userId],
    )
    return result.rows[0] ?? null
  }

  async create(input: Readonly<{
    materialId: string
    verificationId: string
    userId: string
    storageKey: StorageKeyCiphertext
    declaredMime: VerificationMaterialMime
    byteSize: number
    checksum: string
    idempotencyKey: string
    requestHash: string
    now: Date
    requestId: string
  }>): Promise<StoredMaterial> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${input.userId}:${input.idempotencyKey}`,
      ])
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [input.verificationId])
      const replay = await client.query<StoredMaterial>(
        `SELECT * FROM private_material.verification_materials
         WHERE owner_user_id=$1 AND idempotency_key=$2`,
        [input.userId, input.idempotencyKey],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw privateMaterialError('MATERIAL_IDEMPOTENCY_KEY_REUSED', 409)
        }
        await client.query('COMMIT')
        return replay.rows[0]
      }
      const verification = await client.query<{ status: string }>(
        `SELECT status FROM workflow.verification_requests
         WHERE verification_id=$1 AND applicant_user_id=$2 FOR UPDATE`,
        [input.verificationId, input.userId],
      )
      if (!verification.rows[0]) throw privateMaterialError('VERIFICATION_REQUEST_NOT_FOUND', 404)
      if (!['draft','changes_requested'].includes(verification.rows[0].status)) {
        throw privateMaterialError('VERIFICATION_REQUEST_NOT_EDITABLE', 409)
      }
      const quota = await client.query<{ item_count: number; byte_count: string }>(
        `SELECT count(*)::int AS item_count,COALESCE(sum(byte_size),0)::text AS byte_count
         FROM private_material.verification_materials
         WHERE verification_id=$1 AND owner_user_id=$2 AND status<>'deleted'`,
        [input.verificationId, input.userId],
      )
      if ((quota.rows[0]?.item_count ?? 0) >= 5) throw privateMaterialError('MATERIAL_ITEM_QUOTA_EXCEEDED', 429)
      if (Number(quota.rows[0]?.byte_count ?? 0) + input.byteSize > 31_457_280) {
        throw privateMaterialError('MATERIAL_BYTE_QUOTA_EXCEEDED', 413)
      }
      const result = await client.query<StoredMaterial>(
        `INSERT INTO private_material.verification_materials (
           material_id,verification_id,owner_user_id,storage_key_ciphertext,storage_key_nonce,
           storage_key_auth_tag,storage_key_version,declared_mime,byte_size,checksum_sha256,
           status,scan_result,idempotency_key,request_hash,created_at,updated_at,upload_expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prepared','not_scanned',$11,$12,$13,$13,$13+interval '30 minutes')
         RETURNING *`,
        [input.materialId, input.verificationId, input.userId, input.storageKey.ciphertext,
          input.storageKey.nonce, input.storageKey.authTag, input.storageKey.keyVersion,
          input.declaredMime, input.byteSize, input.checksum, input.idempotencyKey,
          input.requestHash, input.now],
      )
      await client.query(
        `INSERT INTO private_material.material_access_logs (
           material_id,actor_user_id,action,purpose,result,request_id,occurred_at
         ) VALUES ($1,$2,'prepare','author_verification','success',left($3,128),$4)`,
        [input.materialId, input.userId, input.requestId, input.now],
      )
      await client.query('COMMIT')
      return result.rows[0]!
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async recordSelfRead(userId: string, materialId: string, requestId: string, now: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO private_material.material_access_logs (
         material_id,actor_user_id,action,purpose,result,request_id,occurred_at
       ) VALUES ($1,$2,'self_read','applicant_status','success',left($3,128),$4)`,
      [materialId, userId, requestId, now],
    )
  }

  async getOperationReplay(input: Readonly<{
    materialId: string
    userId: string
    operationId: string
  }>): Promise<MaterialOperationReplay | null> {
    const result = await this.pool.query<{ request_hash: string; response_json: unknown }>(
      `SELECT request_hash,response_json FROM private_material.verification_material_operations
       WHERE material_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
      [input.materialId, input.userId, input.operationId],
    )
    return result.rows[0] ? {
      requestHash: result.rows[0].request_hash,
      response: result.rows[0].response_json,
    } : null
  }

  async complete(input: Readonly<{
    materialId: string
    userId: string
    checksum: string
    uploadReceiptHash: string
    detectedMime: string
    detectedByteSize: number
    detectedChecksum: string
    operationId: string
    requestHash: string
    accepted: boolean
    rejectionReason: 'MIME_MISMATCH' | 'CHECKSUM_MISMATCH' | null
    now: Date
    requestId: string
  }>): Promise<CompleteStoreResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash,response_json FROM private_material.verification_material_operations
         WHERE material_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
        [input.materialId, input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) throw privateMaterialError('MATERIAL_OPERATION_REUSED', 409)
        const current = await client.query<StoredMaterial>(
          `SELECT * FROM private_material.verification_materials WHERE material_id=$1`, [input.materialId],
        )
        await client.query('COMMIT')
        return Object.freeze({
          material: current.rows[0]!,
          operationResponse: receipt.rows[0].response_json,
          replayed: true,
        })
      }
      const locked = await client.query<StoredMaterial>(
        `SELECT * FROM private_material.verification_materials
         WHERE material_id=$1 AND owner_user_id=$2 FOR UPDATE`,
        [input.materialId, input.userId],
      )
      const row = locked.rows[0]
      if (!row) throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND', 404)
      if (row.status !== 'prepared') throw privateMaterialError('VERIFICATION_MATERIAL_NOT_COMPLETABLE', 409)
      if (row.upload_expires_at<=input.now) throw privateMaterialError('VERIFICATION_MATERIAL_UPLOAD_EXPIRED', 410)
      const nextStatus = input.accepted ? 'uploaded' : 'rejected'
      const updated = await client.query<StoredMaterial>(
        `UPDATE private_material.verification_materials SET
           detected_mime=$3,upload_receipt_hash=$4,status=$5,
           rejection_reason_code=$6,completed_at=$7,processing_deadline_at=$7+interval '30 minutes',
           scan_queued_at=CASE WHEN $8 THEN $7 ELSE NULL END,version=version+1,
           updated_at=GREATEST($7,updated_at+interval '1 microsecond')
         WHERE material_id=$1 AND owner_user_id=$2 RETURNING *`,
        [input.materialId, input.userId, input.detectedMime, input.uploadReceiptHash,
          nextStatus, input.rejectionReason, input.now, input.accepted],
      )
      const material = updated.rows[0]!
      const response = Object.freeze({
        material: applicantSummary(material),
        scan_queued: input.accepted,
        error_code: input.rejectionReason,
      })
      await client.query(
        `INSERT INTO private_material.verification_material_operations (
           material_id,owner_user_id,operation_id,operation_type,request_hash,resulting_version,response_json,created_at
         ) VALUES ($1,$2,$3,'complete',$4,$5,$6::jsonb,$7)`,
        [input.materialId, input.userId, input.operationId, input.requestHash,
          material.version, JSON.stringify(response), input.now],
      )
      if (input.accepted) {
        const eventId = randomUUID()
        await client.query(
          `INSERT INTO ops.outbox_events (
           event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
             transaction_id,status,next_attempt_at,created_at
           ) VALUES ($1,'verification_material',$2,'verification_material_scan_requested',1,
             jsonb_build_object('material_id',$2::text),$3,'pending',$4,$4)`,
          [eventId, input.materialId, randomUUID(), input.now],
        )
      }
      await client.query(
        `INSERT INTO private_material.material_access_logs (
           material_id,actor_user_id,action,purpose,result,request_id,occurred_at
         ) VALUES ($1,$2,'complete','author_verification',$3,left($4,128),$5)`,
        [input.materialId, input.userId, input.accepted ? 'scan_queued' : 'file_rejected',
          input.requestId, input.now],
      )
      await client.query('COMMIT')
      return Object.freeze({ material, operationResponse: response, replayed: false })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async revoke(input: Readonly<{
    materialId: string
    userId: string
    expectedVersion: number
    operationId: string
    requestHash: string
    reasonCode: string
    now: Date
    requestId: string
  }>): Promise<StoredMaterial> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{ request_hash: string }>(
        `SELECT request_hash FROM private_material.verification_material_operations
         WHERE material_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
        [input.materialId, input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) throw privateMaterialError('MATERIAL_OPERATION_REUSED', 409)
        const replay = await client.query<StoredMaterial>(
          `SELECT * FROM private_material.verification_materials WHERE material_id=$1`, [input.materialId],
        )
        await client.query('COMMIT')
        return replay.rows[0]!
      }
      const locked = await client.query<StoredMaterial>(
        `SELECT * FROM private_material.verification_materials
         WHERE material_id=$1 AND owner_user_id=$2 FOR UPDATE`,
        [input.materialId, input.userId],
      )
      const row = locked.rows[0]
      if (!row) throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND', 404)
      if (Number(row.version)!==input.expectedVersion) {
        throw privateMaterialError('VERIFICATION_MATERIAL_VERSION_CONFLICT', 409, false, {
          current_version: Number(row.version), expected_version: input.expectedVersion,
        })
      }
      if (row.status==='deleted') throw privateMaterialError('VERIFICATION_MATERIAL_DELETED', 410)
      if (row.status==='revoked') throw privateMaterialError('VERIFICATION_MATERIAL_ALREADY_REVOKED', 409)
      const terminal = applicantSummary(row)
      const updated = await client.query<StoredMaterial>(
        `UPDATE private_material.verification_materials SET
           status='revoked',pre_terminal_scan_result=scan_result,
           applicant_terminal_state_json=$3::jsonb,revoked_at=$4,version=version+1,
           updated_at=GREATEST($4,updated_at+interval '1 microsecond')
         WHERE material_id=$1 AND owner_user_id=$2 RETURNING *`,
        [input.materialId, input.userId, JSON.stringify(terminal), input.now],
      )
      const material = updated.rows[0]!
      const response = applicantSummary(material)
      await client.query(
        `INSERT INTO private_material.verification_material_operations (
           material_id,owner_user_id,operation_id,operation_type,request_hash,resulting_version,response_json,created_at
         ) VALUES ($1,$2,$3,'revoke',$4,$5,$6::jsonb,$7)`,
        [input.materialId, input.userId, input.operationId, input.requestHash,
          material.version, JSON.stringify(response), input.now],
      )
      await client.query(
        `INSERT INTO private_material.material_access_logs (
           material_id,actor_user_id,action,purpose,result,request_id,occurred_at
         ) VALUES ($1,$2,'revoke',$3,'success',left($4,128),$5)`,
        [input.materialId, input.userId, input.reasonCode, input.requestId, input.now],
      )
      await client.query('COMMIT')
      return material
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

export function applicantSummary(row: StoredMaterial): ApplicantMaterialSummary {
  if ((row.status==='revoked' || row.status==='deleted') && row.applicant_terminal_state_json) {
    const stored = row.applicant_terminal_state_json as ApplicantMaterialSummary
    return Object.freeze({ ...stored, next_action: 'none', upload_expires_at: null, version: Number(row.version) })
  }
  if (row.status==='prepared') return summary(row, 'pending', null, 'complete_upload', row.upload_expires_at.toISOString())
  if (row.status==='uploaded' || row.status==='scanning') return summary(row, 'pending', null, 'wait', null)
  if (row.status==='ready') return summary(row, 'accepted', null, 'continue_submission', null)
  if (row.status==='abandoned') return summary(row, 'rejected', 'upload_expired', 'upload_new_material', null)
  if (row.rejection_reason_code==='SCAN_RETRY_EXHAUSTED' || row.rejection_reason_code==='SCAN_DEADLINE_EXCEEDED') {
    return summary(row, 'rejected', 'processing_unavailable', 'upload_new_material', null)
  }
  return summary(row, 'rejected', 'file_rejected', row.status==='revoked' ? 'none' : 'upload_new_material', null)
}

function summary(
  row: StoredMaterial,
  state: ApplicantMaterialSummary['applicant_scan_state'],
  reason: ApplicantMaterialSummary['reason_key'],
  action: ApplicantMaterialSummary['next_action'],
  expires: string | null,
): ApplicantMaterialSummary {
  return Object.freeze({
    material_id: row.material_id,
    verification_id: row.verification_id,
    applicant_scan_state: state,
    reason_key: reason,
    next_action: action,
    upload_expires_at: expires,
    version: Number(row.version),
  })
}
