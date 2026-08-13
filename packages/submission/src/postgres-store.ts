import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { submissionError } from './errors.js'
import { assertDraftIdentity, mergeDraftPayload, validateDraftPayload } from './payload.js'
import { canonicalJson, validateSubmissionReadySnapshot } from './submission-ready.js'
import type { SubmissionStore } from './store-port.js'
import type {
  SubmissionCategoryId,
  SubmissionDraftProjection,
  SubmissionDraftStatus,
  SubmissionDuplicateCandidate,
  SubmissionSchemaVersion,
  SubmissionProjection,
  SubmissionReviewStatus,
  SubmissionWithdrawalProjection,
  SubmissionUrlCheckProjection,
  UrlCheckAccessResult,
  UrlCheckDuplicateResult,
  UrlCheckRiskResult,
} from './types.js'

interface UrlCheckRow extends QueryResultRow {
  readonly check_id: string
  readonly owner_user_id: string
  readonly category_id: SubmissionCategoryId
  readonly category_schema_version: SubmissionSchemaVersion
  readonly input_hash: string
  readonly canonical_url: string | null
  readonly redirect_chain_json: unknown
  readonly risk_result: UrlCheckRiskResult
  readonly access_result: UrlCheckAccessResult
  readonly category_result: 'matched' | 'mismatched' | 'unconfirmed'
  readonly duplicate_result: UrlCheckDuplicateResult
  readonly duplicate_candidates_json: unknown
  readonly risk_reasons_json: unknown
  readonly client_request_id: string
  readonly request_hash: string
  readonly checked_at: Date
  readonly expires_at: Date
}

interface DraftRow extends QueryResultRow {
  readonly draft_id: string
  readonly submission_chain_id: string
  readonly owner_user_id: string
  readonly category_id: SubmissionCategoryId
  readonly category_schema_version: SubmissionSchemaVersion
  readonly check_id: string
  readonly draft_revision: number
  readonly supersedes_draft_id: string | null
  readonly base_submission_id: string | null
  readonly payload_snapshot: unknown
  readonly media_reference_ids_json: unknown
  readonly evidence_draft_ids_json: unknown
  readonly asset_drafts_json: unknown
  readonly status: SubmissionDraftStatus
  readonly version: number
  readonly request_hash: string
  readonly created_at: Date
  readonly updated_at: Date
  readonly saved_at: Date
  readonly expires_at: Date
}

interface DuplicateRow extends QueryResultRow {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: SubmissionCategoryId
}

interface DraftReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

interface SubmissionRow extends QueryResultRow {
  readonly submission_id: string
  readonly submission_chain_id: string
  readonly draft_id: string
  readonly owner_user_id: string
  readonly snapshot_version: number
  readonly evidence_draft_ids_json: unknown
  readonly media_reference_ids_json: unknown
  readonly review_status: SubmissionReviewStatus
  readonly review_work_item_id: string
  readonly preview_hash: string
  readonly request_hash: string
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface ReadyReferenceRow extends QueryResultRow {
  readonly media_reference_id: string
  readonly role: string
  readonly sort_order: number
  readonly resource_owner_user_id: string
  readonly resource_status: string
  readonly scan_result: string
  readonly deletion_guard_job_id: string | null
}

interface SubmissionOperationReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

interface SubmissionWorkItemRow extends QueryResultRow {
  readonly work_item_id: string
  readonly work_type: string
  readonly target_type: string
  readonly target_id: string
  readonly status: 'queued' | 'claimed' | 'decided' | 'cancelled'
  readonly assignee_user_id: string | null
  readonly version: number
}

export class PostgresSubmissionStore implements SubmissionStore {
  constructor(private readonly pool: Pool) {}

  async getUrlCheckByRequest(input: {
    readonly userId: string
    readonly clientRequestId: string
  }) {
    const result = await this.pool.query<UrlCheckRow>(
      `SELECT url_check.* FROM workflow.submission_url_check_receipts receipt
       JOIN workflow.submission_url_checks url_check ON url_check.check_id=receipt.check_id
       WHERE receipt.owner_user_id=$1 AND receipt.client_request_id=$2`,
      [input.userId, input.clientRequestId],
    )
    const row = result.rows[0]
    return row
      ? Object.freeze({
          requestHash: row.request_hash,
          projection: this.urlCheckProjection(row),
        })
      : null
  }

  async getReusableUrlCheck(input: {
    readonly userId: string
    readonly inputHash: string
    readonly now: Date
  }): Promise<SubmissionUrlCheckProjection | null> {
    const result = await this.pool.query<UrlCheckRow>(
      `SELECT * FROM workflow.submission_url_checks
       WHERE owner_user_id=$1 AND input_hash=$2 AND expires_at>$3
       ORDER BY checked_at DESC,check_id DESC LIMIT 1`,
      [input.userId, input.inputHash, input.now],
    )
    return result.rows[0] ? this.urlCheckProjection(result.rows[0]) : null
  }

  async bindReusableUrlCheck(input: {
    readonly userId: string
    readonly clientRequestId: string
    readonly requestHash: string
    readonly checkId: string
    readonly now: Date
  }): Promise<SubmissionUrlCheckProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `submission-url-check:${input.userId}:${input.clientRequestId}`)
      const existing = await client.query<{
        readonly request_hash: string
        readonly check_id: string
      } & QueryResultRow>(
        `SELECT request_hash,check_id FROM workflow.submission_url_check_receipts
         WHERE owner_user_id=$1 AND client_request_id=$2`,
        [input.userId, input.clientRequestId],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== input.requestHash) {
          throw submissionError('CLIENT_REQUEST_ID_REUSED', 409)
        }
      } else {
        await client.query(
          `INSERT INTO workflow.submission_url_check_receipts (
             owner_user_id,client_request_id,request_hash,check_id,created_at
           ) VALUES ($1,$2,$3,$4,$5)`,
          [input.userId, input.clientRequestId, input.requestHash, input.checkId, input.now],
        )
      }
      const check = await client.query<UrlCheckRow>(
        `SELECT * FROM workflow.submission_url_checks
         WHERE check_id=$1 AND owner_user_id=$2 AND expires_at>$3`,
        [existing.rows[0]?.check_id ?? input.checkId, input.userId, input.now],
      )
      if (!check.rows[0]) throw submissionError('SUBMISSION_URL_CHECK_EXPIRED', 410)
      await client.query('COMMIT')
      return this.urlCheckProjection(check.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async findDuplicateCandidates(input: {
    readonly canonicalUrlHash: Buffer
    readonly categoryId: SubmissionCategoryId
  }): Promise<readonly SubmissionDuplicateCandidate[]> {
    const result = await this.pool.query<DuplicateRow>(
      `SELECT project_id,current_name,category_id
       FROM catalog.projects
       WHERE canonical_url_hash=$1 AND review_status<>'deleted'
       ORDER BY (category_id=$2) DESC,updated_at DESC,project_id
       LIMIT 10`,
      [input.canonicalUrlHash, input.categoryId],
    )
    return Object.freeze(result.rows.map((row) => Object.freeze({
      project_id: row.project_id,
      current_name: row.current_name,
      category_id: row.category_id,
      reason: 'canonical_url_exact' as const,
    })))
  }

  async saveUrlCheck(input: Parameters<SubmissionStore['saveUrlCheck']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `submission-url-check:${input.userId}:${input.clientRequestId}`)
      await this.lock(client, `submission-url-check-input:${input.userId}:${input.inputHash}`)
      const existing = await client.query<UrlCheckRow>(
        `SELECT url_check.* FROM workflow.submission_url_check_receipts receipt
         JOIN workflow.submission_url_checks url_check ON url_check.check_id=receipt.check_id
         WHERE receipt.owner_user_id=$1 AND receipt.client_request_id=$2`,
        [input.userId, input.clientRequestId],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== input.requestHash) {
          throw submissionError('CLIENT_REQUEST_ID_REUSED', 409)
        }
        await client.query('COMMIT')
        return this.urlCheckProjection(existing.rows[0])
      }
      const reusable = await client.query<UrlCheckRow>(
        `SELECT * FROM workflow.submission_url_checks
         WHERE owner_user_id=$1 AND input_hash=$2 AND expires_at>$3
         ORDER BY checked_at DESC,check_id DESC LIMIT 1`,
        [input.userId, input.inputHash, input.checkedAt],
      )
      if (reusable.rows[0]) {
        await client.query(
          `INSERT INTO workflow.submission_url_check_receipts (
             owner_user_id,client_request_id,request_hash,check_id,created_at
           ) VALUES ($1,$2,$3,$4,$5)`,
          [
            input.userId, input.clientRequestId, input.requestHash,
            reusable.rows[0].check_id, input.checkedAt,
          ],
        )
        await client.query('COMMIT')
        return this.urlCheckProjection(reusable.rows[0])
      }
      const duplicateResult: UrlCheckDuplicateResult = input.duplicateCandidates.length > 0
        ? 'exact'
        : 'none'
      const checkId = randomUUID()
      const inserted = await client.query<UrlCheckRow>(
        `INSERT INTO workflow.submission_url_checks (
           check_id,owner_user_id,category_id,category_schema_version,input_hash,
           canonical_url,canonical_url_hash,redirect_chain_json,risk_result,access_result,
           duplicate_result,duplicate_candidates_json,risk_reasons_json,client_request_id,
           request_hash,request_id,checked_at,expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18
         ) RETURNING *`,
        [
          checkId, input.userId, input.categoryId, input.schemaVersion, input.inputHash,
          input.canonicalUrl, input.canonicalUrlHash, JSON.stringify(input.redirectChain),
          input.riskResult, input.accessResult, duplicateResult,
          JSON.stringify(input.duplicateCandidates), JSON.stringify(input.riskReasons),
          input.clientRequestId, input.requestHash, input.requestId, input.checkedAt, input.expiresAt,
        ],
      )
      await client.query(
        `INSERT INTO workflow.submission_url_check_receipts (
           owner_user_id,client_request_id,request_hash,check_id,created_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [input.userId, input.clientRequestId, input.requestHash, checkId, input.checkedAt],
      )
      await client.query('COMMIT')
      return this.urlCheckProjection(inserted.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async createDraft(input: Parameters<SubmissionStore['createDraft']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `submission-draft-create:${input.userId}:${input.clientRequestId}`)
      const replay = await client.query<DraftRow>(
        `SELECT * FROM workflow.submission_drafts
         WHERE owner_user_id=$1 AND idempotency_key=$2`,
        [input.userId, input.clientRequestId],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw submissionError('CLIENT_REQUEST_ID_REUSED', 409)
        }
        await client.query('COMMIT')
        return this.draftProjection(replay.rows[0])
      }

      const checkResult = await client.query<UrlCheckRow>(
        `SELECT * FROM workflow.submission_url_checks WHERE check_id=$1 FOR UPDATE`,
        [input.checkId],
      )
      const check = checkResult.rows[0]
      if (!check) throw submissionError('SUBMISSION_URL_CHECK_NOT_FOUND', 404)
      if (check.owner_user_id !== input.userId) throw submissionError('SUBMISSION_URL_CHECK_FORBIDDEN', 403)
      if (check.expires_at.getTime() <= input.now.getTime()) {
        throw submissionError('SUBMISSION_URL_CHECK_EXPIRED', 410)
      }
      if (check.category_id !== input.categoryId || check.category_schema_version !== input.schemaVersion) {
        throw submissionError('SUBMISSION_URL_CHECK_CATEGORY_MISMATCH', 409)
      }
      if (
        check.risk_result !== 'allowed' ||
        !['accessible', 'uncertain'].includes(check.access_result) ||
        check.duplicate_result !== 'none' || !check.canonical_url
      ) throw submissionError('SUBMISSION_URL_CHECK_NOT_ELIGIBLE', 422)

      await this.lock(client, `submission-url:${check.canonical_url}`)

      const currentDuplicate = await client.query<{ readonly project_id: string } & QueryResultRow>(
        `SELECT project_id FROM catalog.projects
         WHERE canonical_url_hash=digest($1,'sha256') AND review_status<>'deleted'
         LIMIT 1 FOR SHARE`,
        [check.canonical_url],
      )
      if (currentDuplicate.rows[0]) {
        throw submissionError('SUBMISSION_DUPLICATE_FOUND', 409, false, {
          project_id: currentDuplicate.rows[0].project_id,
        })
      }
      const activeDraft = await client.query<DraftRow>(
        `SELECT draft.* FROM workflow.submission_drafts draft
         JOIN workflow.submission_url_checks url_check ON url_check.check_id=draft.check_id
         WHERE url_check.canonical_url_hash=digest($1,'sha256')
           AND draft.status='editing' AND draft.expires_at>$2
         ORDER BY draft.created_at,draft.draft_id LIMIT 1 FOR UPDATE OF draft`,
        [check.canonical_url, input.now],
      )
      if (activeDraft.rows[0]) {
        if (activeDraft.rows[0].owner_user_id === input.userId) {
          await client.query('COMMIT')
          return this.draftProjection(activeDraft.rows[0])
        }
        throw submissionError('SUBMISSION_URL_IN_PROGRESS', 409)
      }

      const payloadSnapshot = validateDraftPayload({
        ...input.payloadSnapshot,
        project_core: { public_url: check.canonical_url },
      })
      const draftId = randomUUID()
      const chainId = randomUUID()
      const inserted = await client.query<DraftRow>(
        `INSERT INTO workflow.submission_drafts (
           draft_id,submission_chain_id,owner_user_id,category_id,category_schema_version,
           check_id,payload_snapshot,idempotency_key,request_hash,created_at,updated_at,saved_at,expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$10,$10,$11)
         RETURNING *`,
        [
          draftId, chainId, input.userId, input.categoryId, input.schemaVersion,
          input.checkId, JSON.stringify(payloadSnapshot), input.clientRequestId,
          input.requestHash, input.now, input.expiresAt,
        ],
      )
      await client.query('COMMIT')
      return this.draftProjection(inserted.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getDraft(input: Parameters<SubmissionStore['getDraft']>[0]) {
    const result = await this.pool.query<DraftRow>(
      `SELECT * FROM workflow.submission_drafts WHERE draft_id=$1`,
      [input.draftId],
    )
    const row = result.rows[0]
    if (!row) throw submissionError('SUBMISSION_DRAFT_NOT_FOUND', 404)
    if (row.owner_user_id !== input.userId) throw submissionError('SUBMISSION_DRAFT_FORBIDDEN', 403)
    if (row.status === 'expired' || row.expires_at.getTime() <= input.now.getTime()) {
      throw submissionError('SUBMISSION_DRAFT_EXPIRED', 410)
    }
    return this.draftProjection(row)
  }

  async patchDraft(input: Parameters<SubmissionStore['patchDraft']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `submission-draft-patch:${input.draftId}:${input.operationId}`)
      const receipt = await client.query<DraftReceiptRow>(
        `SELECT request_hash,response_json FROM workflow.submission_draft_operation_receipts
         WHERE draft_id=$1 AND operation_id=$2`,
        [input.draftId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw submissionError('OPERATION_ID_REUSED', 409)
        }
        const replay = this.draftProjectionFromJson(receipt.rows[0].response_json)
        await client.query('COMMIT')
        return replay
      }
      const current = await client.query<DraftRow>(
        `SELECT * FROM workflow.submission_drafts WHERE draft_id=$1 FOR UPDATE`,
        [input.draftId],
      )
      const row = current.rows[0]
      if (!row) throw submissionError('SUBMISSION_DRAFT_NOT_FOUND', 404)
      if (row.owner_user_id !== input.userId) throw submissionError('SUBMISSION_DRAFT_FORBIDDEN', 403)
      if (row.status !== 'editing') throw submissionError('SUBMISSION_DRAFT_READ_ONLY', 409)
      if (row.expires_at.getTime() <= input.now.getTime()) {
        throw submissionError('SUBMISSION_DRAFT_EXPIRED', 410)
      }
      if (row.version !== input.expectedVersion) {
        throw submissionError('SUBMISSION_DRAFT_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: row.version,
        })
      }
      const check = await client.query<Pick<UrlCheckRow, 'canonical_url'> & QueryResultRow>(
        `SELECT canonical_url FROM workflow.submission_url_checks WHERE check_id=$1`,
        [row.check_id],
      )
      if (!check.rows[0]?.canonical_url) throw submissionError('SUBMISSION_URL_CHECK_STATE_INVALID', 500, true)
      const merged = mergeDraftPayload(validateDraftPayload(row.payload_snapshot), input.patch)
      assertDraftIdentity(merged, {
        categoryId: row.category_id,
        schemaVersion: row.category_schema_version,
        canonicalUrl: check.rows[0].canonical_url,
      })
      const updated = await client.query<DraftRow>(
        `UPDATE workflow.submission_drafts
         SET payload_snapshot=$2::jsonb,version=version+1,updated_at=$3,saved_at=$3
         WHERE draft_id=$1 RETURNING *`,
        [input.draftId, JSON.stringify(merged), input.now],
      )
      const projection = this.draftProjection(updated.rows[0]!)
      await client.query(
        `INSERT INTO workflow.submission_draft_operation_receipts (
           draft_id,operation_id,operation_type,request_hash,response_json,created_at
         ) VALUES ($1,$2,'patch',$3,$4::jsonb,$5)`,
        [input.draftId, input.operationId, input.requestHash, JSON.stringify(projection), input.now],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async previewDraft(input: Parameters<SubmissionStore['previewDraft']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const ready = await this.readReadySnapshot(client, input, false)
      const previewHash = this.hash(canonicalJson(ready.previewHashInput))
      const generatedAt = input.now.toISOString()
      await client.query(
        `INSERT INTO workflow.submission_preview_audits (
           draft_id,owner_user_id,draft_version,check_id,preview_hash,validation_hash,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.draftId, input.userId, input.expectedVersion, input.checkId, previewHash,
          this.hash(canonicalJson({ valid: true, issue_count: 0 })), input.now,
        ],
      )
      await client.query('COMMIT')
      return Object.freeze({
        draft_id: input.draftId,
        draft_version: input.expectedVersion,
        check_id: input.checkId,
        preview_hash: previewHash,
        payload_snapshot: ready.payloadSnapshot,
        media_reference_ids: ready.mediaReferenceIds,
        evidence_draft_ids: ready.evidenceDraftIds,
        validation: Object.freeze({ valid: true as const, issue_count: 0 as const }),
        generated_at: generatedAt,
      })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async submitDraft(input: Parameters<SubmissionStore['submitDraft']>[0]): Promise<SubmissionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `submission-submit:${input.userId}:${input.submissionKey}`)
      const replay = await client.query<SubmissionRow>(
        `SELECT * FROM workflow.submissions WHERE owner_user_id=$1 AND idempotency_key=$2`,
        [input.userId, input.submissionKey],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw submissionError('SUBMISSION_KEY_REUSED', 409)
        }
        await client.query('COMMIT')
        return this.submissionProjection(replay.rows[0])
      }

      const ready = await this.readReadySnapshot(client, {
        ...input,
        expectedVersion: input.draftVersion,
      }, true)
      const currentPreviewHash = this.hash(canonicalJson(ready.previewHashInput))
      if (currentPreviewHash !== input.previewHash) {
        throw submissionError('SUBMISSION_PREVIEW_STALE', 409, false, {
          current_preview_hash: currentPreviewHash,
        })
      }

      const submissionId = randomUUID()
      const workItemId = randomUUID()
      const transactionId = randomUUID()
      await client.query(
        `INSERT INTO workflow.review_work_items (
           work_item_id,work_type,target_type,target_id,status,version,created_at,updated_at
         ) VALUES ($1,'submission','submission',$2,'queued',1,$3,$3)`,
        [workItemId, submissionId, input.now],
      )
      const inserted = await client.query<SubmissionRow>(
        `INSERT INTO workflow.submissions (
           submission_id,submission_chain_id,draft_id,owner_user_id,snapshot_version,
           payload_snapshot,evidence_draft_ids_json,media_reference_ids_json,review_status,
           review_work_item_id,preview_hash,idempotency_key,request_hash,version,created_at,updated_at
         ) SELECT $1,draft.submission_chain_id,draft.draft_id,draft.owner_user_id,$2,
             $3::jsonb,$4::jsonb,$5::jsonb,'pending_review',$6,$7,$8,$9,1,$10,$10
           FROM workflow.submission_drafts draft WHERE draft.draft_id=$11
         RETURNING *`,
        [
          submissionId, input.draftVersion, JSON.stringify(ready.payloadSnapshot),
          JSON.stringify(ready.evidenceDraftIds), JSON.stringify(ready.mediaReferenceIds),
          workItemId, currentPreviewHash, input.submissionKey, input.requestHash, input.now,
          input.draftId,
        ],
      )
      if (!inserted.rows[0]) throw submissionError('SUBMISSION_DRAFT_NOT_FOUND', 404)
      await client.query(
        `INSERT INTO workflow.review_work_item_conflict_principals (
           work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
         ) VALUES ($1,$2,'submission_owner',$3,1,$4)`,
        [workItemId, input.userId, submissionId, input.now],
      )
      await client.query(
        `UPDATE workflow.submission_drafts
         SET status='submitted',version=version+1,updated_at=$2,saved_at=$2
         WHERE draft_id=$1`,
        [input.draftId, input.now],
      )
      const outboxId = randomUUID()
      await client.query(
        `INSERT INTO ops.outbox_events (
           outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,
           payload_json,transaction_id,status,next_attempt_at,created_at
         ) VALUES ($1,$2,'submission',$3,'project_submitted',1,$4::jsonb,$5,'pending',$6,$6)`,
        [
          outboxId, randomUUID(), submissionId,
          JSON.stringify({
            draft_id: input.draftId,
            submission_id: submissionId,
            submission_chain_id: inserted.rows[0].submission_chain_id,
            category_id: (ready.payloadSnapshot as Record<string, unknown>).category_id,
            result: 'success',
          }),
          transactionId, input.now,
        ],
      )
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           after_hash,reason_code,request_id,trace_id,result,created_at
         ) VALUES ('submission_submit','user',digest($1,'sha256'),'[]'::jsonb,'submission',$2,
           $3,'submission_created',$4,$5,'success',$6)`,
        [input.userId, submissionId, this.hash(canonicalJson(ready.previewHashInput)), input.requestId.slice(0, 64), transactionId, input.now],
      )
      await client.query('COMMIT')
      return this.submissionProjection(inserted.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async withdrawSubmission(
    input: Parameters<SubmissionStore['withdrawSubmission']>[0],
  ): Promise<SubmissionWithdrawalProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, `submission-withdraw:${input.userId}:${input.operationId}`)
      const receipt = await client.query<SubmissionOperationReceiptRow>(
        `SELECT request_hash,response_json FROM workflow.submission_operation_receipts
         WHERE owner_user_id=$1 AND operation_id=$2`,
        [input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw submissionError('OPERATION_ID_REUSED', 409)
        }
        const projection = this.withdrawalProjectionFromJson(receipt.rows[0].response_json)
        await client.query('COMMIT')
        return projection
      }

      const current = await client.query<SubmissionRow>(
        'SELECT * FROM workflow.submissions WHERE submission_id=$1 FOR UPDATE',
        [input.submissionId],
      )
      const submission = current.rows[0]
      if (!submission) throw submissionError('SUBMISSION_NOT_FOUND', 404)
      if (submission.owner_user_id !== input.userId) throw submissionError('SUBMISSION_FORBIDDEN', 403)
      if (submission.version !== input.expectedVersion) {
        throw submissionError('SUBMISSION_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: submission.version,
        })
      }
      if (submission.review_status !== 'pending_review') {
        throw submissionError('SUBMISSION_NOT_WITHDRAWABLE', 409)
      }
      const workItemResult = await client.query<SubmissionWorkItemRow>(
        'SELECT * FROM workflow.review_work_items WHERE work_item_id=$1 FOR UPDATE',
        [submission.review_work_item_id],
      )
      const workItem = workItemResult.rows[0]
      if (
        !workItem || workItem.work_type !== 'submission' || workItem.target_type !== 'submission' ||
        workItem.target_id !== submission.submission_id
      ) throw submissionError('SUBMISSION_WORK_ITEM_STATE_INVALID', 500, true)
      if (!['queued', 'claimed'].includes(workItem.status)) {
        throw submissionError('SUBMISSION_NOT_WITHDRAWABLE', 409)
      }

      const updatedWorkItem = await client.query<SubmissionWorkItemRow>(
        `UPDATE workflow.review_work_items SET status='cancelled',assignee_user_id=NULL,
           claim_token_hash=NULL,lease_expires_at=NULL,last_heartbeat_at=NULL,
           conflict_principal_version_at_claim=NULL,cancel_reason='submission_withdrawn',
           version=version+1,updated_at=$2
         WHERE work_item_id=$1 AND status IN ('queued','claimed') AND version=$3
         RETURNING *`,
        [workItem.work_item_id, input.now, workItem.version],
      )
      const cancelled = updatedWorkItem.rows[0]
      if (!cancelled) throw submissionError('SUBMISSION_WORK_ITEM_CONFLICT', 409)
      await client.query(
        `INSERT INTO workflow.review_work_item_events (
           event_id,work_item_id,event_type,actor_user_id,from_status,to_status,
           work_item_version,reason_code,metadata_json,occurred_at
         ) VALUES ($1,$2,'cancelled',$3,$4,'cancelled',$5,'submission_withdrawn',$6::jsonb,$7)`,
        [
          randomUUID(), workItem.work_item_id, input.userId, workItem.status, cancelled.version,
          JSON.stringify({ submission_id: submission.submission_id }), input.now,
        ],
      )
      const updatedSubmission = await client.query<SubmissionRow>(
        `UPDATE workflow.submissions SET review_status='withdrawn',version=version+1,
           decided_at=$2,updated_at=$2
         WHERE submission_id=$1 AND review_status='pending_review' AND version=$3
         RETURNING *`,
        [submission.submission_id, input.now, input.expectedVersion],
      )
      const withdrawn = updatedSubmission.rows[0]
      if (!withdrawn) throw submissionError('SUBMISSION_VERSION_CONFLICT', 409)
      const projection: SubmissionWithdrawalProjection = Object.freeze({
        submission_id: withdrawn.submission_id,
        review_status: 'withdrawn',
        submission_version: withdrawn.version,
        review_work_item_id: cancelled.work_item_id,
        work_item_status: 'cancelled',
        work_item_version: cancelled.version,
        withdrawn_at: input.now.toISOString(),
      })
      await client.query(
        `INSERT INTO workflow.submission_operation_receipts (
           owner_user_id,operation_id,operation_type,request_hash,submission_id,response_json,created_at
         ) VALUES ($1,$2,'withdraw',$3,$4,$5::jsonb,$6)`,
        [
          input.userId, input.operationId, input.requestHash, submission.submission_id,
          JSON.stringify(projection), input.now,
        ],
      )
      const transactionId = randomUUID()
      await client.query(
        `INSERT INTO ops.outbox_events (
           outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,
           payload_json,transaction_id,status,next_attempt_at,created_at
         ) VALUES ($1,$2,'submission',$3,'submission_withdrawn',1,$4::jsonb,$5,'pending',$6,$6)`,
        [
          randomUUID(), randomUUID(), withdrawn.submission_id,
          JSON.stringify({
            submission_id: withdrawn.submission_id,
            submission_chain_id: withdrawn.submission_chain_id,
            result: 'success',
          }),
          transactionId, input.now,
        ],
      )
      if (workItem.assignee_user_id !== null) {
        await client.query(
          `INSERT INTO ops.outbox_events (
             outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,
             payload_json,transaction_id,status,next_attempt_at,created_at
           ) VALUES ($1,$2,'review_work_item',$3,'review_assignment_cancelled',1,
             $4::jsonb,$5,'pending',$6,$6)`,
          [
            randomUUID(), randomUUID(), workItem.work_item_id,
            JSON.stringify({
              work_item_id: workItem.work_item_id,
              recipient_user_id: workItem.assignee_user_id,
              reason_code: 'submission_withdrawn',
            }),
            transactionId, input.now,
          ],
        )
      }
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at
         ) VALUES ('OP-SUB-WITHDRAW','user',digest($1,'sha256'),'[]'::jsonb,'submission',$2,
           $3,$4,$5::jsonb,$6,$7,$8,'success',$9)`,
        [
          input.userId, withdrawn.submission_id,
          this.hash(canonicalJson({ review_status: submission.review_status, version: submission.version })),
          this.hash(canonicalJson({ review_status: withdrawn.review_status, version: withdrawn.version })),
          JSON.stringify({
            review_status: { from: submission.review_status, to: withdrawn.review_status },
            work_item_status: { from: workItem.status, to: cancelled.status },
            owner_reason_code: input.reasonCode,
          }),
          'submission_owner_withdrawn', input.requestId.slice(0, 64), transactionId, input.now,
        ],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async readReadySnapshot(
    client: PoolClient,
    input: Readonly<{
      userId: string
      draftId: string
      expectedVersion: number
      checkId: string
      now: Date
    }>,
    lockForSubmit: boolean,
  ) {
    const draftResult = await client.query<DraftRow>(
      `SELECT * FROM workflow.submission_drafts WHERE draft_id=$1 ${lockForSubmit ? 'FOR UPDATE' : 'FOR SHARE'}`,
      [input.draftId],
    )
    const draft = draftResult.rows[0]
    if (!draft) throw submissionError('SUBMISSION_DRAFT_NOT_FOUND', 404)
    if (draft.owner_user_id !== input.userId) throw submissionError('SUBMISSION_DRAFT_FORBIDDEN', 403)
    if (draft.status !== 'editing') throw submissionError('SUBMISSION_DRAFT_READ_ONLY', 409)
    if (draft.expires_at.getTime() <= input.now.getTime()) throw submissionError('SUBMISSION_DRAFT_EXPIRED', 410)
    if (draft.version !== input.expectedVersion) {
      throw submissionError('SUBMISSION_DRAFT_VERSION_CONFLICT', 409, false, {
        expected_version: input.expectedVersion,
        current_version: draft.version,
      })
    }
    if (draft.check_id !== input.checkId) throw submissionError('SUBMISSION_CHECK_MISMATCH', 409)
    const checkResult = await client.query<UrlCheckRow>(
      `SELECT * FROM workflow.submission_url_checks WHERE check_id=$1 ${lockForSubmit ? 'FOR UPDATE' : 'FOR SHARE'}`,
      [input.checkId],
    )
    const check = checkResult.rows[0]
    if (!check) throw submissionError('SUBMISSION_URL_CHECK_NOT_FOUND', 404)
    if (check.owner_user_id !== input.userId) throw submissionError('SUBMISSION_URL_CHECK_FORBIDDEN', 403)
    if (check.expires_at.getTime() <= input.now.getTime()) throw submissionError('SUBMISSION_URL_CHECK_EXPIRED', 410)
    if (
      check.category_id !== draft.category_id || check.category_schema_version !== draft.category_schema_version ||
      check.risk_result !== 'allowed' || check.access_result !== 'accessible' ||
      check.duplicate_result !== 'none' || check.canonical_url === null
    ) throw submissionError('SUBMISSION_URL_CHECK_NOT_ELIGIBLE', 422)
    const duplicate = await client.query<{ readonly project_id: string } & QueryResultRow>(
      `SELECT project_id FROM catalog.projects
       WHERE canonical_url_hash=digest($1,'sha256') AND review_status<>'deleted'
       LIMIT 1 FOR SHARE`,
      [check.canonical_url],
    )
    if (duplicate.rows[0]) {
      throw submissionError('SUBMISSION_DUPLICATE_FOUND', 409, false, { project_id: duplicate.rows[0].project_id })
    }

    const boundMediaIds = this.uniqueStringArray(
      draft.media_reference_ids_json,
      'SUBMISSION_MEDIA_BINDING_INVALID',
    )
    const mediaResult = await client.query<ReadyReferenceRow>(
      `SELECT reference.media_reference_id,reference.role,reference.sort_order,
              resource.owner_user_id AS resource_owner_user_id,
              resource.status AS resource_status,resource.scan_result,resource.deletion_guard_job_id
       FROM media.media_references reference
       JOIN media.media_resources resource ON resource.media_resource_id=reference.media_resource_id
       WHERE reference.target_type='submission_draft' AND reference.target_id=$1
         AND reference.lifecycle_status='active'
       ORDER BY reference.role,reference.sort_order,reference.media_reference_id
       ${lockForSubmit ? 'FOR SHARE OF reference,resource' : ''}`,
      [input.draftId],
    )
    const activeMediaIds = mediaResult.rows.map((row) => row.media_reference_id)
    if (!this.sameStringSet(boundMediaIds, activeMediaIds)) {
      throw submissionError('SUBMISSION_MEDIA_BINDING_INVALID', 500, true)
    }
    if (mediaResult.rows.some((row) => (
      row.resource_owner_user_id !== input.userId || row.resource_status !== 'ready' ||
      row.scan_result !== 'clean' || row.deletion_guard_job_id !== null
    ))) throw submissionError('SUBMISSION_MEDIA_NOT_READY', 422)
    const mediaIds = activeMediaIds
    const coverIds = mediaResult.rows.filter((row) => row.role === 'cover')
      .sort((left, right) => left.sort_order - right.sort_order || left.media_reference_id.localeCompare(right.media_reference_id))
      .map((row) => row.media_reference_id)

    const boundEvidenceIds = this.uniqueStringArray(
      draft.evidence_draft_ids_json,
      'SUBMISSION_EVIDENCE_BINDING_INVALID',
    )
    const evidenceResult = await client.query<{
      readonly evidence_draft_id: string
      readonly owner_user_id: string
      readonly parent_type: string
      readonly parent_id: string
      readonly status: string
    } & QueryResultRow>(
      `SELECT evidence_draft_id,owner_user_id,parent_type,parent_id,status
       FROM workflow.evidence_drafts
       WHERE evidence_draft_id=ANY($1::uuid[])
       ORDER BY evidence_draft_id ${lockForSubmit ? 'FOR SHARE' : ''}`,
      [boundEvidenceIds],
    )
    if (
      evidenceResult.rows.length !== boundEvidenceIds.length ||
      evidenceResult.rows.some((row) => (
        row.owner_user_id !== input.userId || row.parent_type !== 'submission_draft' ||
        row.parent_id !== input.draftId
      ))
    ) throw submissionError('SUBMISSION_EVIDENCE_BINDING_INVALID', 500, true)
    if (evidenceResult.rows.some((row) => row.status !== 'ready')) {
      throw submissionError('SUBMISSION_EVIDENCE_NOT_READY', 422)
    }
    const evidenceIds = evidenceResult.rows.map((row) => row.evidence_draft_id)
    const invalidAttachment = await client.query<QueryResultRow>(
      `SELECT 1 FROM workflow.evidence_attachment_drafts attachment
       JOIN workflow.evidence_drafts draft ON draft.evidence_draft_id=attachment.evidence_draft_id
       JOIN media.media_resources resource ON resource.media_resource_id=attachment.media_resource_id
       WHERE draft.evidence_draft_id=ANY($2::uuid[])
         AND attachment.status='active'
         AND (resource.owner_user_id<>$1 OR resource.status<>'ready' OR resource.scan_result<>'clean'
           OR resource.deletion_guard_job_id IS NOT NULL)
       LIMIT 1`,
      [input.userId, boundEvidenceIds],
    )
    if (invalidAttachment.rows[0]) throw submissionError('SUBMISSION_EVIDENCE_ATTACHMENT_NOT_READY', 422)
    return validateSubmissionReadySnapshot({
      payloadSnapshot: draft.payload_snapshot,
      categoryId: draft.category_id,
      schemaVersion: draft.category_schema_version,
      canonicalUrl: check.canonical_url,
      mediaReferenceIds: mediaIds,
      coverMediaReferenceIds: coverIds,
      evidenceDraftIds: evidenceIds,
      draftId: input.draftId,
      draftVersion: input.expectedVersion,
      checkId: input.checkId,
      checkInputHash: check.input_hash,
    })
  }

  private submissionProjection(row: SubmissionRow): SubmissionProjection {
    return Object.freeze({
      submission_id: row.submission_id,
      submission_chain_id: row.submission_chain_id,
      draft_id: row.draft_id,
      snapshot_version: row.snapshot_version,
      review_status: row.review_status,
      review_work_item_id: row.review_work_item_id,
      media_reference_ids: Object.freeze(this.stringArray(row.media_reference_ids_json, 'SUBMISSION_STATE_INVALID')),
      evidence_draft_ids: Object.freeze(this.stringArray(row.evidence_draft_ids_json, 'SUBMISSION_STATE_INVALID')),
      preview_hash: row.preview_hash,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }

  private urlCheckProjection(row: UrlCheckRow): SubmissionUrlCheckProjection {
    const redirectChain = this.stringArray(row.redirect_chain_json, 'SUBMISSION_URL_CHECK_STATE_INVALID')
    const duplicateCandidates = this.duplicateCandidates(row.duplicate_candidates_json)
    const riskReasons = this.stringArray(row.risk_reasons_json, 'SUBMISSION_URL_CHECK_STATE_INVALID')
    return Object.freeze({
      check_id: row.check_id,
      category_id: row.category_id,
      category_schema_version: row.category_schema_version,
      input_hash: row.input_hash,
      canonical_url: row.canonical_url,
      redirect_chain: Object.freeze(redirectChain),
      risk_result: row.risk_result,
      access_result: row.access_result,
      category_result: row.category_result,
      duplicate_result: row.duplicate_result,
      duplicate_candidates: Object.freeze(duplicateCandidates),
      risk_reasons: Object.freeze(riskReasons),
      can_create_draft: row.risk_result === 'allowed' &&
        ['accessible', 'uncertain'].includes(row.access_result) &&
        row.duplicate_result === 'none' && row.canonical_url !== null,
      checked_at: row.checked_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
    })
  }

  private draftProjection(row: DraftRow): SubmissionDraftProjection {
    const assetDrafts = row.asset_drafts_json
    if (!Array.isArray(assetDrafts) || assetDrafts.some((value) => value === null || typeof value !== 'object' || Array.isArray(value))) {
      throw submissionError('SUBMISSION_DRAFT_STATE_INVALID', 500, true)
    }
    return Object.freeze({
      draft_id: row.draft_id,
      submission_chain_id: row.submission_chain_id,
      category_id: row.category_id,
      category_schema_version: row.category_schema_version,
      check_id: row.check_id,
      draft_revision: row.draft_revision,
      supersedes_draft_id: row.supersedes_draft_id,
      base_submission_id: row.base_submission_id,
      payload_snapshot: validateDraftPayload(row.payload_snapshot),
      media_reference_ids: Object.freeze(this.stringArray(row.media_reference_ids_json, 'SUBMISSION_DRAFT_STATE_INVALID')),
      evidence_draft_ids: Object.freeze(this.stringArray(row.evidence_draft_ids_json, 'SUBMISSION_DRAFT_STATE_INVALID')),
      asset_drafts: Object.freeze(assetDrafts.map((value) => Object.freeze({ ...(value as Record<string, unknown>) }))),
      status: row.status,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      saved_at: row.saved_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
    })
  }

  private draftProjectionFromJson(value: unknown): SubmissionDraftProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw submissionError('SUBMISSION_DRAFT_RECEIPT_INVALID', 500, true)
    }
    const record = value as Record<string, unknown>
    const requiredStrings = [
      'draft_id', 'submission_chain_id', 'category_id', 'category_schema_version', 'check_id',
      'status', 'created_at', 'updated_at', 'saved_at', 'expires_at',
    ]
    if (requiredStrings.some((key) => typeof record[key] !== 'string') || !Number.isSafeInteger(record.version)) {
      throw submissionError('SUBMISSION_DRAFT_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze({
      ...(record as unknown as SubmissionDraftProjection),
      payload_snapshot: validateDraftPayload(record.payload_snapshot),
      media_reference_ids: Object.freeze(this.stringArray(record.media_reference_ids, 'SUBMISSION_DRAFT_RECEIPT_INVALID')),
      evidence_draft_ids: Object.freeze(this.stringArray(record.evidence_draft_ids, 'SUBMISSION_DRAFT_RECEIPT_INVALID')),
      asset_drafts: Object.freeze((record.asset_drafts as Readonly<Record<string, unknown>>[]).map((item) => Object.freeze({ ...item }))),
    })
  }

  private duplicateCandidates(value: unknown): SubmissionDuplicateCandidate[] {
    if (!Array.isArray(value)) throw submissionError('SUBMISSION_URL_CHECK_STATE_INVALID', 500, true)
    return value.map((candidate) => {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw submissionError('SUBMISSION_URL_CHECK_STATE_INVALID', 500, true)
      }
      const record = candidate as Record<string, unknown>
      if (
        typeof record.project_id !== 'string' || typeof record.current_name !== 'string' ||
        !['ai_learning_quiz', 'personal_site_portfolio'].includes(String(record.category_id)) ||
        record.reason !== 'canonical_url_exact'
      ) throw submissionError('SUBMISSION_URL_CHECK_STATE_INVALID', 500, true)
      return Object.freeze({
        project_id: record.project_id,
        current_name: record.current_name,
        category_id: record.category_id as SubmissionCategoryId,
        reason: 'canonical_url_exact' as const,
      })
    })
  }

  private stringArray(value: unknown, code: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw submissionError(code, 500, true)
    }
    return [...value]
  }

  private uniqueStringArray(value: unknown, code: string): string[] {
    const values = this.stringArray(value, code)
    if (new Set(values).size !== values.length) throw submissionError(code, 500, true)
    return values
  }

  private sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false
    const rightSet = new Set(right)
    return left.every((value) => rightSet.has(value))
  }

  private withdrawalProjectionFromJson(value: unknown): SubmissionWithdrawalProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw submissionError('SUBMISSION_RECEIPT_INVALID', 500, true)
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.submission_id !== 'string' || record.review_status !== 'withdrawn' ||
      !Number.isSafeInteger(record.submission_version) || typeof record.review_work_item_id !== 'string' ||
      record.work_item_status !== 'cancelled' || !Number.isSafeInteger(record.work_item_version) ||
      typeof record.withdrawn_at !== 'string'
    ) throw submissionError('SUBMISSION_RECEIPT_INVALID', 500, true)
    return Object.freeze(record) as unknown as SubmissionWithdrawalProjection
  }

  private async lock(client: PoolClient, key: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
  }
}
