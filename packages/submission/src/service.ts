import { createHash } from 'node:crypto'

import { submissionError, SubmissionError } from './errors.js'
import { validateDraftPayload } from './payload.js'
import type { SubmissionStore, SubmissionUrlSafetyResolver } from './store-port.js'
import {
  submissionCategoryIds,
  type CheckSubmissionUrlCommand,
  type CreateSubmissionDraftCommand,
  type GetSubmissionDraftCommand,
  type PatchSubmissionDraftCommand,
  type PreviewSubmissionDraftCommand,
  type SubmitSubmissionDraftCommand,
  type WithdrawSubmissionCommand,
  type SubmissionCategoryId,
  type SubmissionDraftProjection,
  type SubmissionPreviewProjection,
  type SubmissionProjection,
  type SubmissionWithdrawalProjection,
  type SubmissionSchemaVersion,
  type SubmissionUrlCheckProjection,
  type UrlCheckAccessResult,
  type UrlCheckRiskResult,
} from './types.js'

const categorySchemas: Readonly<Record<SubmissionCategoryId, SubmissionSchemaVersion>> = Object.freeze({
  ai_learning_quiz: 'learning.v1',
  personal_site_portfolio: 'portfolio.v1',
})

export interface SubmissionServiceConfig {
  readonly enabled: boolean
  readonly urlCheckTtlSeconds: number
  readonly draftTtlSeconds: number
}

export class SubmissionService {
  private readonly now: () => Date

  constructor(private readonly dependencies: Readonly<{
    store: SubmissionStore
    urlSafetyResolver: SubmissionUrlSafetyResolver
    config: SubmissionServiceConfig
    now?: () => Date
  }>) {
    this.now = dependencies.now ?? (() => new Date())
    if (
      !dependencies.config.enabled ||
      !Number.isSafeInteger(dependencies.config.urlCheckTtlSeconds) ||
      dependencies.config.urlCheckTtlSeconds < 60 || dependencies.config.urlCheckTtlSeconds > 3_600 ||
      !Number.isSafeInteger(dependencies.config.draftTtlSeconds) ||
      dependencies.config.draftTtlSeconds < 86_400 || dependencies.config.draftTtlSeconds > 7_776_000
    ) throw submissionError('SUBMISSION_CONFIG_INVALID', 503, true)
  }

  async checkUrl(command: CheckSubmissionUrlCommand): Promise<SubmissionUrlCheckProjection> {
    const userId = this.uuid(command.userId, 'SUBMISSION_USER_INVALID')
    const categoryId = this.category(command.categoryHint)
    const schemaVersion = categorySchemas[categoryId]
    const clientRequestId = this.operationId(command.clientRequestId)
    const canonicalInput = this.normalizePublicUrl(command.rawUrl)
    const inputHash = this.hash(`${categoryId}|${canonicalInput}`)
    const requestHash = this.hash(JSON.stringify({ category_id: categoryId, canonical_input: canonicalInput }))
    const replay = await this.dependencies.store.getUrlCheckByRequest({ userId, clientRequestId })
    if (replay) {
      if (replay.requestHash !== requestHash) throw submissionError('CLIENT_REQUEST_ID_REUSED', 409)
      return replay.projection
    }
    const now = this.now()
    const reusable = await this.dependencies.store.getReusableUrlCheck({ userId, inputHash, now })
    if (reusable) {
      return this.dependencies.store.bindReusableUrlCheck({
        userId,
        clientRequestId,
        requestHash,
        checkId: reusable.check_id,
        now,
      })
    }

    const resolved = await this.dependencies.urlSafetyResolver.resolve(canonicalInput)
    const classified = this.classifySafety(
      resolved.result,
      resolved.reasonCode,
      resolved.httpStatusCode ?? null,
    )
    const canonicalUrl = resolved.safeWebUrl === null
      ? null
      : this.normalizePublicUrl(resolved.safeWebUrl)
    const canonicalUrlHash = canonicalUrl === null
      ? null
      : createHash('sha256').update(canonicalUrl, 'utf8').digest()
    const duplicates = canonicalUrlHash === null
      ? Object.freeze([])
      : await this.dependencies.store.findDuplicateCandidates({ canonicalUrlHash, categoryId })
    const riskReasons = resolved.reasonCode === null
      ? Object.freeze([])
      : Object.freeze([resolved.reasonCode])
    return this.dependencies.store.saveUrlCheck({
      userId,
      categoryId,
      schemaVersion,
      inputHash,
      canonicalUrl,
      canonicalUrlHash,
      redirectChain: Object.freeze(resolved.redirectChain.map((item) => this.redactedRedirect(item))),
      riskResult: classified.riskResult,
      accessResult: classified.accessResult,
      duplicateCandidates: duplicates,
      riskReasons,
      clientRequestId,
      requestHash,
      requestId: this.requestId(command.requestId),
      checkedAt: now,
      expiresAt: new Date(now.getTime() + this.dependencies.config.urlCheckTtlSeconds * 1_000),
    })
  }

  async createDraft(command: CreateSubmissionDraftCommand): Promise<SubmissionDraftProjection> {
    const userId = this.uuid(command.userId, 'SUBMISSION_USER_INVALID')
    const checkId = this.uuid(command.checkId, 'SUBMISSION_CHECK_ID_INVALID')
    const categoryId = this.category(command.categoryId)
    const schemaVersion = categorySchemas[categoryId]
    const clientRequestId = this.operationId(command.clientRequestId)
    const payloadSnapshot = validateDraftPayload({
      project_core: {},
      category_id: categoryId,
      category_schema_version: schemaVersion,
      category_data: {},
    })
    const requestHash = this.hash(JSON.stringify({ check_id: checkId, category_id: categoryId }))
    const now = this.now()
    return this.dependencies.store.createDraft({
      userId,
      checkId,
      categoryId,
      schemaVersion,
      payloadSnapshot,
      clientRequestId,
      requestHash,
      requestId: this.requestId(command.requestId),
      now,
      expiresAt: new Date(now.getTime() + this.dependencies.config.draftTtlSeconds * 1_000),
    })
  }

  async getDraft(command: GetSubmissionDraftCommand): Promise<SubmissionDraftProjection> {
    return this.dependencies.store.getDraft({
      userId: this.uuid(command.userId, 'SUBMISSION_USER_INVALID'),
      draftId: this.uuid(command.draftId, 'SUBMISSION_DRAFT_ID_INVALID'),
      now: this.now(),
    })
  }

  async patchDraft(command: PatchSubmissionDraftCommand): Promise<SubmissionDraftProjection> {
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw submissionError('SUBMISSION_DRAFT_VERSION_INVALID', 422)
    }
    const patch = validateDraftPayload(command.patch)
    const operationId = this.operationId(command.operationId)
    return this.dependencies.store.patchDraft({
      userId: this.uuid(command.userId, 'SUBMISSION_USER_INVALID'),
      draftId: this.uuid(command.draftId, 'SUBMISSION_DRAFT_ID_INVALID'),
      expectedVersion: command.expectedVersion,
      patch,
      operationId,
      requestHash: this.hash(JSON.stringify({
        expected_version: command.expectedVersion,
        patch,
      })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  async previewDraft(command: PreviewSubmissionDraftCommand): Promise<SubmissionPreviewProjection> {
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw submissionError('SUBMISSION_DRAFT_VERSION_INVALID', 422)
    }
    return this.dependencies.store.previewDraft({
      userId: this.uuid(command.userId, 'SUBMISSION_USER_INVALID'),
      draftId: this.uuid(command.draftId, 'SUBMISSION_DRAFT_ID_INVALID'),
      expectedVersion: command.expectedVersion,
      checkId: this.uuid(command.checkId, 'SUBMISSION_CHECK_ID_INVALID'),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  async submitDraft(command: SubmitSubmissionDraftCommand): Promise<SubmissionProjection> {
    if (!Number.isSafeInteger(command.draftVersion) || command.draftVersion < 1) {
      throw submissionError('SUBMISSION_DRAFT_VERSION_INVALID', 422)
    }
    const draftId = this.uuid(command.draftId, 'SUBMISSION_DRAFT_ID_INVALID')
    const checkId = this.uuid(command.checkId, 'SUBMISSION_CHECK_ID_INVALID')
    const previewHash = command.previewHash.trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(previewHash)) throw submissionError('SUBMISSION_PREVIEW_HASH_INVALID', 422)
    const submissionKey = this.operationId(command.submissionKey)
    const requestHash = this.hash(JSON.stringify({
      draft_id: draftId,
      draft_version: command.draftVersion,
      check_id: checkId,
      preview_hash: previewHash,
    }))
    return this.dependencies.store.submitDraft({
      userId: this.uuid(command.userId, 'SUBMISSION_USER_INVALID'),
      draftId,
      draftVersion: command.draftVersion,
      checkId,
      previewHash,
      submissionKey,
      requestHash,
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  async withdrawSubmission(command: WithdrawSubmissionCommand): Promise<SubmissionWithdrawalProjection> {
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw submissionError('SUBMISSION_VERSION_INVALID', 422)
    }
    const submissionId = this.uuid(command.submissionId, 'SUBMISSION_ID_INVALID')
    const operationId = this.operationId(command.operationId)
    const reasonCode = command.reasonCode === null ? null : this.reasonCode(command.reasonCode)
    return this.dependencies.store.withdrawSubmission({
      userId: this.uuid(command.userId, 'SUBMISSION_USER_INVALID'),
      submissionId,
      expectedVersion: command.expectedVersion,
      operationId,
      reasonCode,
      requestHash: this.hash(JSON.stringify({
        submission_id: submissionId,
        expected_version: command.expectedVersion,
        reason_code: reasonCode,
      })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  private classifySafety(
    result: 'allowed' | 'uncertain' | 'blocked',
    reasonCode: string | null,
    httpStatusCode: number | null,
  ): { readonly riskResult: UrlCheckRiskResult; readonly accessResult: UrlCheckAccessResult } {
    if (result === 'allowed') {
      const accessible = httpStatusCode === null || httpStatusCode < 400 ||
        [401, 403, 429].includes(httpStatusCode)
      return Object.freeze({
        riskResult: 'allowed',
        accessResult: accessible ? 'accessible' : 'unavailable',
      })
    }
    if (result === 'blocked') return Object.freeze({ riskResult: 'blocked', accessResult: 'not_checked' })
    if (reasonCode === 'ASSET_PROBE_UNAVAILABLE' || reasonCode === 'ASSET_UPSTREAM_UNAVAILABLE') {
      return Object.freeze({ riskResult: 'allowed', accessResult: 'uncertain' })
    }
    return Object.freeze({ riskResult: 'uncertain', accessResult: 'not_checked' })
  }

  private category(value: string): SubmissionCategoryId {
    if (!submissionCategoryIds.includes(value as SubmissionCategoryId)) {
      throw submissionError('SUBMISSION_CATEGORY_INVALID', 422)
    }
    return value as SubmissionCategoryId
  }

  private normalizePublicUrl(value: string): string {
    if (typeof value !== 'string' || value.length > 2_048) {
      throw submissionError('SUBMISSION_URL_INVALID', 422)
    }
    let url: URL
    try {
      url = new URL(value.trim())
    } catch {
      throw submissionError('SUBMISSION_URL_INVALID', 422)
    }
    if (
      !['http:', 'https:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.port
    ) throw submissionError('SUBMISSION_URL_INVALID', 422)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    url.searchParams.sort()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    const normalized = `${url.origin}${url.pathname === '/' ? '' : url.pathname}${url.search}`
    if (normalized.length > 2_048) throw submissionError('SUBMISSION_URL_INVALID', 422)
    return normalized
  }

  private redactedRedirect(value: string): string {
    try {
      const url = new URL(value)
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      throw submissionError('SUBMISSION_REDIRECT_CHAIN_INVALID', 502, true)
    }
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw submissionError(code, 422)
    }
    return value.toLowerCase()
  }

  private operationId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
      throw submissionError('CLIENT_REQUEST_ID_INVALID', 422)
    }
    return value
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw submissionError('REQUEST_ID_INVALID', 422)
    return value
  }

  private reasonCode(value: string): string {
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) {
      throw submissionError('SUBMISSION_REASON_CODE_INVALID', 422)
    }
    return normalized
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}

export { SubmissionError }
