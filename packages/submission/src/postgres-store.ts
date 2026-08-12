import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { submissionError } from './errors.js'
import { assertDraftIdentity, mergeDraftPayload, validateDraftPayload } from './payload.js'
import type { SubmissionStore } from './store-port.js'
import type {
  SubmissionCategoryId,
  SubmissionDraftProjection,
  SubmissionDraftStatus,
  SubmissionDuplicateCandidate,
  SubmissionSchemaVersion,
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

  private async lock(client: PoolClient, key: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
  }
}
