/**
 * Typed browser client for OP-DRAFT-CREATE, OP-DRAFT-GET, OP-DRAFT-PATCH,
 * OP-DRAFT-PREVIEW, and OP-SUBMIT.  Revision, media, and evidence remain
 * deliberately outside this module.
 */

export type SubmissionDraftCategoryId =
  | 'ai_learning_quiz'
  | 'personal_site_portfolio'

export type SubmissionDraftCategorySchemaVersion = 'learning.v1' | 'portfolio.v1'

export type SubmissionDraftStatus = 'editing' | 'submitted' | 'closed' | 'expired'

export interface SubmissionDraftCreateRequest {
  readonly check_id: string
  readonly category_id: SubmissionDraftCategoryId
  readonly client_request_id: string
}

export interface SubmissionDraftPatchRequest {
  readonly expected_version: number
  readonly patch: Readonly<Record<string, unknown>>
  readonly operation_id: string
}

export interface SubmissionPreviewRequest {
  readonly expected_version: number
  readonly check_id: string
}

export interface SubmissionPreview {
  readonly draft_id: string
  readonly draft_version: number
  readonly check_id: string
  readonly preview_hash: string
  readonly payload_snapshot: Readonly<Record<string, unknown>>
  readonly media_reference_ids: readonly string[]
  readonly evidence_draft_ids: readonly string[]
  readonly validation: Readonly<{
    readonly valid: true
    readonly issue_count: 0
  }>
  readonly generated_at: string
}

export type SubmissionPreviewProjection = SubmissionPreview

export interface SubmissionCreateRequest {
  readonly draft_id: string
  readonly draft_version: number
  readonly check_id: string
  readonly preview_hash: string
  readonly submission_key: string
}

export type SubmissionSubmitRequest = SubmissionCreateRequest

export interface Submission {
  readonly submission_id: string
  readonly submission_chain_id: string
  readonly draft_id: string
  readonly snapshot_version: number
  readonly review_status: 'pending_review'
  readonly review_work_item_id: string
  readonly media_reference_ids: readonly string[]
  readonly evidence_draft_ids: readonly string[]
  readonly preview_hash: string
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export type SubmissionProjection = Submission

/** The exact JSON projection described by the SubmissionDraft schema. */
export interface SubmissionDraft {
  readonly draft_id: string
  readonly submission_chain_id: string
  readonly category_id: SubmissionDraftCategoryId
  readonly category_schema_version: SubmissionDraftCategorySchemaVersion
  readonly check_id: string
  readonly draft_revision: number
  readonly supersedes_draft_id: string | null
  readonly base_submission_id: string | null
  readonly payload_snapshot: Readonly<Record<string, unknown>>
  readonly media_reference_ids: readonly string[]
  readonly evidence_draft_ids: readonly string[]
  readonly asset_drafts: readonly Readonly<Record<string, unknown>>[]
  readonly status: SubmissionDraftStatus
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
  readonly saved_at: string
  readonly expires_at: string
}

export interface SubmissionDraftFieldError {
  readonly path: string
  readonly code: string
}

/** Accept the legacy string form used by some details.field_errors payloads. */
export type SubmissionDraftFieldErrorValue = SubmissionDraftFieldError | string

export interface SubmissionDraftErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message_key: string
    readonly request_id: string
    readonly retryable: boolean
    readonly retry_after_ms: number | null
    readonly field_errors?: readonly SubmissionDraftFieldErrorValue[]
    readonly details?: Readonly<Record<string, unknown>>
  }
}

export type SubmissionDraftClientErrorKind = 'transport' | 'protocol' | 'http'

export interface SubmissionDraftClientErrorOptions {
  readonly kind: SubmissionDraftClientErrorKind
  readonly code: string
  readonly message: string
  readonly messageKey?: string | null
  readonly status: number | null
  readonly requestId: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly fieldErrors?: readonly SubmissionDraftFieldErrorValue[]
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

/** Stable error type for transport failures, protocol failures, and API errors. */
export class SubmissionDraftClientError extends Error {
  readonly name = 'SubmissionDraftClientError'
  readonly kind: SubmissionDraftClientErrorKind
  readonly type: SubmissionDraftClientErrorKind
  readonly status: number | null
  readonly code: string
  readonly messageKey: string | null
  readonly message_key: string | null
  readonly requestId: string | null
  readonly request_id: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly retry_after_ms: number | null
  readonly fieldErrors: readonly SubmissionDraftFieldErrorValue[]
  readonly field_errors: readonly SubmissionDraftFieldErrorValue[]
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(options: SubmissionDraftClientErrorOptions) {
    super(options.message, { cause: options.cause })
    this.kind = options.kind
    this.type = options.kind
    this.status = options.status
    this.code = options.code
    this.messageKey = options.messageKey ?? null
    this.message_key = this.messageKey
    this.requestId = options.requestId
    this.request_id = options.requestId
    this.retryable = options.retryable
    this.retryAfterMs = options.retryAfterMs
    this.retry_after_ms = options.retryAfterMs
    this.fieldErrors = options.fieldErrors ?? []
    this.field_errors = this.fieldErrors
    this.details = options.details
  }
}

export type SubmissionDraftFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface SubmissionDraftClientOptions {
  /** Injected fetch implementation. Defaults to the platform fetch. */
  readonly fetch?: SubmissionDraftFetch
  /** API origin/prefix. The operation path is appended exactly once. */
  readonly baseUrl?: string | URL
  /** Supplies the session-bound CSRF token for each write request. */
  readonly getCsrfToken?: () => string | Promise<string>
  /** Preferred request-id generator. */
  readonly requestIdGenerator?: () => string
  /** Backwards-compatible spelling for requestIdGenerator. */
  readonly generateRequestId?: () => string
}

export interface SubmissionDraftRequestOptions {
  readonly signal?: AbortSignal
}

export interface SubmissionDraftClientContract {
  create(
    request: SubmissionDraftCreateRequest,
    options?: SubmissionDraftRequestOptions,
  ): Promise<SubmissionDraft>
  get(
    draftId: string,
    options?: SubmissionDraftRequestOptions,
  ): Promise<SubmissionDraft>
  patch(
    draftId: string,
    request: SubmissionDraftPatchRequest,
    options?: SubmissionDraftRequestOptions,
  ): Promise<SubmissionDraft>
  preview(
    draftId: string,
    request: SubmissionPreviewRequest,
    options?: SubmissionDraftRequestOptions,
  ): Promise<SubmissionPreview>
  submit(
    request: SubmissionCreateRequest,
    options?: SubmissionDraftRequestOptions,
  ): Promise<Submission>
}

const collectionPath = '/api/v1/submission-drafts'
const submissionCollectionPath = '/api/v1/submissions'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/
const previewHashPattern = /^[a-f0-9]{64}$/
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const draftKeys = [
  'draft_id',
  'submission_chain_id',
  'category_id',
  'category_schema_version',
  'check_id',
  'draft_revision',
  'supersedes_draft_id',
  'base_submission_id',
  'payload_snapshot',
  'media_reference_ids',
  'evidence_draft_ids',
  'asset_drafts',
  'status',
  'version',
  'created_at',
  'updated_at',
  'saved_at',
  'expires_at',
] as const
const previewKeys = [
  'draft_id',
  'draft_version',
  'check_id',
  'preview_hash',
  'payload_snapshot',
  'media_reference_ids',
  'evidence_draft_ids',
  'validation',
  'generated_at',
] as const
const submissionKeys = [
  'submission_id',
  'submission_chain_id',
  'draft_id',
  'snapshot_version',
  'review_status',
  'review_work_item_id',
  'media_reference_ids',
  'evidence_draft_ids',
  'preview_hash',
  'version',
  'created_at',
  'updated_at',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  if (keys.length !== expected.length) return false
  const expectedSet = new Set(expected)
  return keys.every((key) => expectedSet.has(key))
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isCategoryId(value: unknown): value is SubmissionDraftCategoryId {
  return value === 'ai_learning_quiz' || value === 'personal_site_portfolio'
}

function isCategorySchemaVersion(value: unknown): value is SubmissionDraftCategorySchemaVersion {
  return value === 'learning.v1' || value === 'portfolio.v1'
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = dateTimePattern.exec(value)
  if (match === null) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const timezone = match[7]!
  const daysInMonth = [
    31,
    (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) return false
  if (hour > 23 || minute > 59 || second > 59) return false
  if (timezone !== 'Z') {
    const offsetHour = Number(timezone.slice(1, 3))
    const offsetMinute = Number(timezone.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return false
  }
  return !Number.isNaN(Date.parse(value))
}

function isClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && requestIdPattern.test(value)
}

function isJsonValue(value: unknown, seen: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)

  if (Array.isArray(value)) {
    const valid = value.every((item) => isJsonValue(item, seen))
    seen.delete(value)
    return valid
  }

  const valid = Object.values(value).every((item) => isJsonValue(item, seen))
  seen.delete(value)
  return valid
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isJsonValue(value, new Set<object>())
}

function validCreateRequest(value: unknown): value is SubmissionDraftCreateRequest {
  return isRecord(value) &&
    hasExactKeys(value, ['check_id', 'category_id', 'client_request_id']) &&
    isUuid(value.check_id) &&
    isCategoryId(value.category_id) &&
    isClientRequestId(value.client_request_id)
}

function validPatchRequest(value: unknown): value is SubmissionDraftPatchRequest {
  return isRecord(value) &&
    hasExactKeys(value, ['expected_version', 'patch', 'operation_id']) &&
    isPositiveInteger(value.expected_version) &&
    isJsonObject(value.patch) &&
    Object.keys(value.patch).length <= 100 &&
    isClientRequestId(value.operation_id)
}

function validPreviewRequest(value: unknown): value is SubmissionPreviewRequest {
  return isRecord(value) &&
    hasExactKeys(value, ['expected_version', 'check_id']) &&
    isPositiveInteger(value.expected_version) &&
    isUuid(value.check_id)
}

function validSubmitRequest(value: unknown): value is SubmissionCreateRequest {
  return isRecord(value) &&
    hasExactKeys(value, ['draft_id', 'draft_version', 'check_id', 'preview_hash', 'submission_key']) &&
    isUuid(value.draft_id) &&
    isPositiveInteger(value.draft_version) &&
    isUuid(value.check_id) &&
    typeof value.preview_hash === 'string' && previewHashPattern.test(value.preview_hash) &&
    isClientRequestId(value.submission_key)
}

function isUniqueUuidArray(
  value: unknown,
  maxItems: number,
  minItems = 0,
): value is readonly string[] {
  return Array.isArray(value) &&
    value.length >= minItems &&
    value.length <= maxItems &&
    value.every(isUuid) &&
    new Set(value).size === value.length
}

function validSubmissionDraftProjection(value: unknown): value is SubmissionDraft {
  if (!isRecord(value) || !hasExactKeys(value, draftKeys)) return false
  if (!isUuid(value.draft_id) || !isUuid(value.submission_chain_id) ||
      !isCategoryId(value.category_id) || !isCategorySchemaVersion(value.category_schema_version) ||
      !isUuid(value.check_id) || !isPositiveInteger(value.draft_revision)) return false
  if (value.supersedes_draft_id !== null && !isUuid(value.supersedes_draft_id)) return false
  if (value.base_submission_id !== null && !isUuid(value.base_submission_id)) return false
  if (!isJsonObject(value.payload_snapshot)) return false
  if (!isUniqueUuidArray(value.media_reference_ids, 20) ||
      !isUniqueUuidArray(value.evidence_draft_ids, 50)) return false
  if (!Array.isArray(value.asset_drafts) || value.asset_drafts.length !== 0) return false
  if (value.status !== 'editing' && value.status !== 'submitted' &&
      value.status !== 'closed' && value.status !== 'expired') return false
  return isPositiveInteger(value.version) &&
    isDateTime(value.created_at) &&
    isDateTime(value.updated_at) &&
    isDateTime(value.saved_at) &&
    isDateTime(value.expires_at)
}

function validPreviewProjection(value: unknown): value is SubmissionPreview {
  if (!isRecord(value) || !hasExactKeys(value, previewKeys)) return false
  if (!isUuid(value.draft_id) || !isPositiveInteger(value.draft_version) ||
      !isUuid(value.check_id) || typeof value.preview_hash !== 'string' ||
      !previewHashPattern.test(value.preview_hash) || !isJsonObject(value.payload_snapshot)) return false
  if (!isUniqueUuidArray(value.media_reference_ids, 20, 1) ||
      !isUniqueUuidArray(value.evidence_draft_ids, 50, 1)) return false
  if (!isRecord(value.validation) || !hasExactKeys(value.validation, ['valid', 'issue_count']) ||
      value.validation.valid !== true || value.validation.issue_count !== 0) return false
  return isDateTime(value.generated_at)
}

function validSubmissionProjection(value: unknown): value is Submission {
  if (!isRecord(value) || !hasExactKeys(value, submissionKeys)) return false
  if (!isUuid(value.submission_id) || !isUuid(value.submission_chain_id) ||
      !isUuid(value.draft_id) || !isPositiveInteger(value.snapshot_version) ||
      value.review_status !== 'pending_review' || !isUuid(value.review_work_item_id) ||
      !isUniqueUuidArray(value.media_reference_ids, 20, 1) ||
      !isUniqueUuidArray(value.evidence_draft_ids, 50, 1) ||
      typeof value.preview_hash !== 'string' || !previewHashPattern.test(value.preview_hash) ||
      !isPositiveInteger(value.version)) return false
  return isDateTime(value.created_at) && isDateTime(value.updated_at)
}

function normalizeBaseUrl(baseUrl: string | URL | undefined): string {
  if (baseUrl === undefined) return ''
  const value = String(baseUrl).trim()
  if (value === '') return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError('baseUrl must use http or https')
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new TypeError('baseUrl must not contain credentials, query, or hash')
    }
    return parsed.toString().replace(/\/+$/, '')
  }
  if (value.startsWith('//')) {
    throw new TypeError('baseUrl must be same-origin or use an explicit http(s) origin')
  }
  if (!value.startsWith('/')) throw new TypeError('relative baseUrl must start with /')
  return value.replace(/\/+$/, '')
}

function defaultRequestId(): string {
  const runtimeCrypto = globalThis.crypto
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') return runtimeCrypto.randomUUID()
  return `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function headerValue(response: Response, name: string): string | null {
  return response.headers?.get(name) ?? null
}

function isFieldError(value: unknown): value is SubmissionDraftFieldErrorValue {
  if (typeof value === 'string') return value.length >= 1 && value.length <= 256
  return isRecord(value) &&
    hasExactKeys(value, ['path', 'code']) &&
    typeof value.path === 'string' && value.path.length >= 1 && value.path.length <= 256 &&
    typeof value.code === 'string' && value.code.length >= 1 && value.code.length <= 64
}

function extractFieldErrors(value: unknown): readonly SubmissionDraftFieldErrorValue[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 50 || !value.every(isFieldError)) return undefined
  return value
}

function errorDetails(error: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  return error.details === undefined ? undefined : isRecord(error.details) ? error.details : undefined
}

function bodyErrorFieldErrors(
  error: Record<string, unknown>,
  details: Readonly<Record<string, unknown>> | undefined,
): readonly SubmissionDraftFieldErrorValue[] {
  const direct = extractFieldErrors(error.field_errors)
  if (direct !== undefined) return direct
  const nested = details === undefined ? undefined : extractFieldErrors(details.field_errors)
  return nested ?? []
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers?.get('content-type')
  if (contentType !== null && contentType !== undefined && !/\bjson\b/i.test(contentType)) {
    throw new SyntaxError('response content type is not JSON')
  }
  return response.json() as Promise<unknown>
}

function protocolError(
  message: string,
  requestId: string | null,
  status: number | null,
  cause?: unknown,
): SubmissionDraftClientError {
  return new SubmissionDraftClientError({
    kind: 'protocol',
    code: 'PROTOCOL_INVALID_RESPONSE',
    message,
    messageKey: null,
    status,
    requestId,
    retryable: false,
    retryAfterMs: null,
    cause,
  })
}

function networkError(requestId: string, cause: unknown): SubmissionDraftClientError {
  return new SubmissionDraftClientError({
    kind: 'transport',
    code: 'TRANSPORT_NETWORK_ERROR',
    message: 'The submission draft request could not reach the API.',
    messageKey: null,
    status: null,
    requestId,
    retryable: true,
    retryAfterMs: null,
    cause,
  })
}

function httpError(
  response: Response,
  payload: unknown,
  sentRequestId: string,
): SubmissionDraftClientError {
  const responseRequestId = headerValue(response, 'x-request-id') ?? sentRequestId
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return protocolError('The API returned an invalid error response.', responseRequestId, response.status)
  }

  const error = payload.error
  const code = error.code
  const messageKey = error.message_key
  const requestId = error.request_id
  const retryable = error.retryable
  const retryAfterMs = error.retry_after_ms
  const details = errorDetails(error)
  if (typeof code !== 'string' || code.length < 1 || code.length > 64 ||
      typeof messageKey !== 'string' || messageKey.length < 1 || messageKey.length > 128 ||
      typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 64 ||
      typeof retryable !== 'boolean' ||
      (retryAfterMs !== null &&
        (typeof retryAfterMs !== 'number' || !Number.isInteger(retryAfterMs) || retryAfterMs < 0)) ||
      (error.details !== undefined && details === undefined) ||
      (error.field_errors !== undefined && extractFieldErrors(error.field_errors) === undefined)) {
    return protocolError('The API returned an invalid error envelope.', responseRequestId, response.status)
  }

  return new SubmissionDraftClientError({
    kind: 'http',
    code,
    message: messageKey,
    messageKey,
    status: response.status,
    requestId,
    retryable,
    retryAfterMs,
    fieldErrors: bodyErrorFieldErrors(error, details),
    ...(details === undefined ? {} : { details }),
  })
}

function serializeBody(value: object, label: string): string {
  try {
    const body = JSON.stringify(value)
    if (body === undefined) throw new TypeError('request body is not JSON')
    return body
  } catch (cause) {
    throw new TypeError(`Invalid ${label}`, { cause })
  }
}

function draftPath(draftId: string): string {
  return `${collectionPath}/${encodeURIComponent(draftId)}`
}

/** Independent typed client for the five P10→P11 draft HTTP operations. */
export class SubmissionDraftClient implements SubmissionDraftClientContract {
  private readonly requestFetch: SubmissionDraftFetch
  private readonly baseUrl: string
  private readonly csrfToken: () => string | Promise<string>
  private readonly requestIdGenerator: () => string

  constructor(options: SubmissionDraftClientOptions = {}) {
    this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.csrfToken = options.getCsrfToken ?? (() => '')
    this.requestIdGenerator = options.requestIdGenerator ?? options.generateRequestId ?? defaultRequestId
  }

  async create(
    request: SubmissionDraftCreateRequest,
    requestOptions: SubmissionDraftRequestOptions = {},
  ): Promise<SubmissionDraft> {
    if (!validCreateRequest(request)) throw new TypeError('Invalid SubmissionDraftCreateRequest')
    const body = serializeBody(request, 'SubmissionDraftCreateRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${collectionPath}`, body, requestOptions, 201,
      validSubmissionDraftProjection, 'submission draft',
    )
  }

  async get(
    draftId: string,
    requestOptions: SubmissionDraftRequestOptions = {},
  ): Promise<SubmissionDraft> {
    if (!isUuid(draftId)) throw new TypeError('Invalid SubmissionDraft draft_id')
    return this.send(
      'GET', `${this.baseUrl}${draftPath(draftId)}`, requestOptions, 200,
      validSubmissionDraftProjection, 'submission draft',
    )
  }

  async patch(
    draftId: string,
    request: SubmissionDraftPatchRequest,
    requestOptions: SubmissionDraftRequestOptions = {},
  ): Promise<SubmissionDraft> {
    if (!isUuid(draftId)) throw new TypeError('Invalid SubmissionDraft draft_id')
    if (!validPatchRequest(request)) throw new TypeError('Invalid SubmissionDraftPatchRequest')
    const body = serializeBody(request, 'SubmissionDraftPatchRequest')
    return this.sendJson(
      'PATCH', `${this.baseUrl}${draftPath(draftId)}`, body, requestOptions, 200,
      validSubmissionDraftProjection, 'submission draft',
    )
  }

  async preview(
    draftId: string,
    request: SubmissionPreviewRequest,
    requestOptions: SubmissionDraftRequestOptions = {},
  ): Promise<SubmissionPreview> {
    if (!isUuid(draftId)) throw new TypeError('Invalid SubmissionDraft draft_id')
    if (!validPreviewRequest(request)) throw new TypeError('Invalid SubmissionPreviewRequest')
    const body = serializeBody(request, 'SubmissionPreviewRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${draftPath(draftId)}/preview`, body, requestOptions, 200,
      validPreviewProjection, 'submission preview',
    )
  }

  async submit(
    request: SubmissionCreateRequest,
    requestOptions: SubmissionDraftRequestOptions = {},
  ): Promise<Submission> {
    if (!validSubmitRequest(request)) throw new TypeError('Invalid SubmissionCreateRequest')
    const body = serializeBody(request, 'SubmissionCreateRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${submissionCollectionPath}`, body, requestOptions, 202,
      validSubmissionProjection, 'submission',
    )
  }

  private async sendJson<T>(
    method: 'POST' | 'PATCH',
    url: string,
    body: string,
    requestOptions: SubmissionDraftRequestOptions,
    expectedStatus: number,
    validateProjection: (value: unknown) => value is T,
    projectionName: string,
  ): Promise<T> {
    const requestId = this.requestIdGenerator()
    const csrf = await this.csrfToken()
    const init: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        'X-Request-Id': requestId,
      },
      credentials: 'include',
      body,
    }
    if (requestOptions.signal !== undefined) init.signal = requestOptions.signal
    return this.sendWithRequestId(url, init, requestId, expectedStatus, validateProjection, projectionName)
  }

  private async send<T>(
    method: 'GET',
    url: string,
    requestOptions: SubmissionDraftRequestOptions,
    expectedStatus: number,
    validateProjection: (value: unknown) => value is T,
    projectionName: string,
  ): Promise<T> {
    const requestId = this.requestIdGenerator()
    const init: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        'X-Request-Id': requestId,
      },
      credentials: 'include',
    }
    if (requestOptions.signal !== undefined) init.signal = requestOptions.signal
    return this.sendWithRequestId(url, init, requestId, expectedStatus, validateProjection, projectionName)
  }

  private async sendWithRequestId<T>(
    url: string,
    init: RequestInit,
    requestId: string,
    expectedStatus: number,
    validateProjection: (value: unknown) => value is T,
    projectionName: string,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.requestFetch(url, init)
    } catch (cause) {
      throw networkError(requestId, cause)
    }

    let payload: unknown
    try {
      payload = await readJson(response)
    } catch (cause) {
      throw protocolError(
        'The API returned a non-JSON response.',
        headerValue(response, 'x-request-id') ?? requestId,
        response.status,
        cause,
      )
    }

    if (response.status !== expectedStatus) throw httpError(response, payload, requestId)
    if (!validateProjection(payload)) {
      throw protocolError(
        `The API returned an invalid ${projectionName} projection.`,
        headerValue(response, 'x-request-id') ?? requestId,
        response.status,
        payload,
      )
    }
    return payload
  }
}

/** Factory form matching the existing typed contracts clients. */
export function createSubmissionDraftClient(
  options: SubmissionDraftClientOptions = {},
): SubmissionDraftClient {
  return new SubmissionDraftClient(options)
}

/** Alias retained for callers that name the HTTP transport explicitly. */
export const createSubmissionDraftHttpClient = createSubmissionDraftClient
