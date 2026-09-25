/**
 * The typed browser client for OP-URL-CHECK.
 *
 * This module deliberately contains only the URL-check operation.  It does
 * not know how to create a draft, submit a project, or retry a request.  A
 * caller can therefore decide how to handle an uncertain result without
 * accidentally creating a second check.
 */

export type SubmissionUrlCheckCategoryId =
  | 'ai_learning_quiz'
  | 'personal_site_portfolio'

export type SubmissionUrlCheckCategorySchemaVersion = 'learning.v1' | 'portfolio.v1'

export type SubmissionUrlCheckRiskResult = 'allowed' | 'blocked' | 'uncertain'

export type SubmissionUrlCheckAccessResult =
  | 'accessible'
  | 'unavailable'
  | 'uncertain'
  | 'not_checked'

export type SubmissionUrlCheckCategoryResult = 'matched' | 'mismatched' | 'unconfirmed'

export type SubmissionUrlCheckDuplicateResult = 'none' | 'exact' | 'candidate'

/** The exact JSON request body described by SubmissionUrlCheckRequest. */
export interface SubmissionUrlCheckRequest {
  readonly raw_url: string
  readonly category_hint: SubmissionUrlCheckCategoryId
  readonly client_request_id: string
}

export interface SubmissionDuplicateCandidate {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: SubmissionUrlCheckCategoryId
  readonly reason: 'canonical_url_exact'
}

/** The exact JSON projection described by SubmissionUrlCheck. */
export interface SubmissionUrlCheck {
  readonly check_id: string
  readonly category_id: SubmissionUrlCheckCategoryId
  readonly category_schema_version: SubmissionUrlCheckCategorySchemaVersion
  readonly input_hash: string
  readonly canonical_url: string | null
  readonly redirect_chain: readonly string[]
  readonly risk_result: SubmissionUrlCheckRiskResult
  readonly access_result: SubmissionUrlCheckAccessResult
  readonly category_result: SubmissionUrlCheckCategoryResult
  readonly duplicate_result: SubmissionUrlCheckDuplicateResult
  readonly duplicate_candidates: readonly SubmissionDuplicateCandidate[]
  readonly risk_reasons: readonly string[]
  readonly can_create_draft: boolean
  readonly checked_at: string
  readonly expires_at: string
}

export interface SubmissionUrlCheckFieldError {
  readonly path: string
  readonly code: string
}

/**
 * The common API error envelope has these fields.  `field_errors` is accepted
 * in both the canonical object form and the legacy string form because the
 * existing API stores some validation paths as strings in `details`.
 */
export type SubmissionUrlCheckFieldErrorValue = SubmissionUrlCheckFieldError | string

export interface SubmissionUrlCheckErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message_key: string
    readonly request_id: string
    readonly retryable: boolean
    readonly retry_after_ms: number | null
    readonly details?: Readonly<Record<string, unknown>>
    readonly field_errors?: readonly SubmissionUrlCheckFieldErrorValue[]
  }
}

export type SubmissionUrlCheckClientErrorKind = 'transport' | 'protocol' | 'http'

export interface SubmissionUrlCheckClientErrorOptions {
  readonly kind: SubmissionUrlCheckClientErrorKind
  readonly code: string
  readonly message: string
  readonly status: number | null
  readonly requestId: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly fieldErrors?: readonly SubmissionUrlCheckFieldErrorValue[]
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

/**
 * Stable error type for both HTTP error envelopes and failures before a
 * response could be interpreted.  Snake-case aliases mirror the wire
 * contract, while camel-case properties are convenient for TypeScript users.
 */
export class SubmissionUrlCheckClientError extends Error {
  readonly name = 'SubmissionUrlCheckClientError'
  readonly kind: SubmissionUrlCheckClientErrorKind
  readonly type: SubmissionUrlCheckClientErrorKind
  readonly status: number | null
  readonly code: string
  readonly requestId: string | null
  readonly request_id: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly retry_after_ms: number | null
  readonly fieldErrors: readonly SubmissionUrlCheckFieldErrorValue[]
  readonly field_errors: readonly SubmissionUrlCheckFieldErrorValue[]
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(options: SubmissionUrlCheckClientErrorOptions) {
    super(options.message, { cause: options.cause })
    this.kind = options.kind
    this.type = options.kind
    this.status = options.status
    this.code = options.code
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

export type SubmissionUrlCheckFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface SubmissionUrlCheckClientOptions {
  /** Injected fetch implementation. Defaults to the platform fetch. */
  readonly fetch?: SubmissionUrlCheckFetch
  /** API origin/prefix. The operation path is appended exactly once. */
  readonly baseUrl?: string | URL
  /** Supplies the session-bound CSRF token for each request. */
  readonly getCsrfToken?: () => string | Promise<string>
  /** Preferred request-id generator. */
  readonly requestIdGenerator?: () => string
  /** Backwards-compatible spelling for requestIdGenerator. */
  readonly generateRequestId?: () => string
}

export interface SubmissionUrlCheckRequestOptions {
  readonly signal?: AbortSignal
}

export interface SubmissionUrlCheckClient {
  check(
    request: SubmissionUrlCheckRequest,
    options?: SubmissionUrlCheckRequestOptions,
  ): Promise<SubmissionUrlCheck>
}

const operationPath = '/api/v1/submission-url-checks'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const inputHashPattern = /^[a-f0-9]{64}$/
const clientRequestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const requiredSet = new Set(required)
  return Object.keys(value).every((key) => requiredSet.has(key))
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
}

function isCategoryId(value: unknown): value is SubmissionUrlCheckCategoryId {
  return value === 'ai_learning_quiz' || value === 'personal_site_portfolio'
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(
    (item) => typeof item === 'string' && item.length <= maxLength,
  )
}

function validRequest(request: SubmissionUrlCheckRequest): boolean {
  return isRecord(request) &&
    hasExactKeys(request, ['raw_url', 'category_hint', 'client_request_id']) &&
    typeof request.raw_url === 'string' && request.raw_url.length >= 1 && request.raw_url.length <= 2048 &&
    isCategoryId(request.category_hint) &&
    typeof request.client_request_id === 'string' && clientRequestIdPattern.test(request.client_request_id)
}

function validDuplicateCandidate(value: unknown): value is SubmissionDuplicateCandidate {
  if (!isRecord(value) || !hasExactKeys(value, ['project_id', 'current_name', 'category_id', 'reason'])) return false
  return isUuid(value.project_id) &&
    typeof value.current_name === 'string' && value.current_name.length >= 1 && value.current_name.length <= 80 &&
    isCategoryId(value.category_id) && value.reason === 'canonical_url_exact'
}

function validProjection(value: unknown): value is SubmissionUrlCheck {
  if (!isRecord(value)) return false
  const required = [
    'check_id',
    'category_id',
    'category_schema_version',
    'input_hash',
    'canonical_url',
    'redirect_chain',
    'risk_result',
    'access_result',
    'category_result',
    'duplicate_result',
    'duplicate_candidates',
    'risk_reasons',
    'can_create_draft',
    'checked_at',
    'expires_at',
  ] as const
  if (!hasExactKeys(value, required) || required.some((key) => !(key in value))) return false
  if (!isUuid(value.check_id) || !isCategoryId(value.category_id)) return false
  if (value.category_schema_version !== 'learning.v1' && value.category_schema_version !== 'portfolio.v1') return false
  if (typeof value.input_hash !== 'string' || !inputHashPattern.test(value.input_hash)) return false
  if (value.canonical_url !== null &&
      (typeof value.canonical_url !== 'string' || value.canonical_url.length > 2048)) return false
  if (!isStringArray(value.redirect_chain, 6, 2048)) return false
  if (value.risk_result !== 'allowed' && value.risk_result !== 'blocked' && value.risk_result !== 'uncertain') return false
  if (value.access_result !== 'accessible' && value.access_result !== 'unavailable' &&
      value.access_result !== 'uncertain' && value.access_result !== 'not_checked') return false
  if (value.category_result !== 'matched' && value.category_result !== 'mismatched' && value.category_result !== 'unconfirmed') return false
  if (value.duplicate_result !== 'none' && value.duplicate_result !== 'exact' && value.duplicate_result !== 'candidate') return false
  if (!Array.isArray(value.duplicate_candidates) || value.duplicate_candidates.length > 10 ||
      !value.duplicate_candidates.every(validDuplicateCandidate)) return false
  if (!isStringArray(value.risk_reasons, 10, 128) || new Set(value.risk_reasons).size !== value.risk_reasons.length) return false
  return typeof value.can_create_draft === 'boolean' && isDateTime(value.checked_at) && isDateTime(value.expires_at)
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
  if (value.startsWith('//')) throw new TypeError('baseUrl must be same-origin or use an explicit http(s) origin')
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

function extractFieldErrors(value: unknown): readonly SubmissionUrlCheckFieldErrorValue[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SubmissionUrlCheckFieldErrorValue =>
    typeof item === 'string' ||
    (isRecord(item) && typeof item.path === 'string' && typeof item.code === 'string'),
  )
}

function errorDetails(error: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  return isRecord(error.details) ? error.details : undefined
}

function bodyErrorFieldErrors(error: Record<string, unknown>): readonly SubmissionUrlCheckFieldErrorValue[] {
  const direct = extractFieldErrors(error.field_errors)
  if (direct.length > 0) return direct
  const details = errorDetails(error)
  return details === undefined ? [] : extractFieldErrors(details.field_errors)
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
): SubmissionUrlCheckClientError {
  return new SubmissionUrlCheckClientError({
    kind: 'protocol',
    code: 'PROTOCOL_INVALID_RESPONSE',
    message,
    status,
    requestId,
    retryable: false,
    retryAfterMs: null,
    cause,
  })
}

function networkError(requestId: string, cause: unknown): SubmissionUrlCheckClientError {
  return new SubmissionUrlCheckClientError({
    kind: 'transport',
    code: 'TRANSPORT_NETWORK_ERROR',
    message: 'The submission URL check request could not reach the API.',
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
): SubmissionUrlCheckClientError {
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
  if (typeof code !== 'string' || code.length < 1 || code.length > 64 ||
      typeof messageKey !== 'string' || messageKey.length < 1 || messageKey.length > 128 ||
      typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 64 ||
      typeof retryable !== 'boolean' ||
      (retryAfterMs !== null && (typeof retryAfterMs !== 'number' || !Number.isInteger(retryAfterMs) || retryAfterMs < 0))) {
    return protocolError('The API returned an invalid error envelope.', responseRequestId, response.status)
  }

  const details = errorDetails(error)
  const options: SubmissionUrlCheckClientErrorOptions = {
    kind: 'http',
    code,
    message: messageKey,
    status: response.status,
    requestId,
    retryable,
    retryAfterMs,
    fieldErrors: bodyErrorFieldErrors(error),
    ...(details === undefined ? {} : { details }),
  }
  return new SubmissionUrlCheckClientError(options)
}

function buildRequestUrl(baseUrl: string): string {
  return `${baseUrl}${operationPath}`
}

/** Create the single-operation typed client for OP-URL-CHECK. */
export function createSubmissionUrlCheckClient(
  options: SubmissionUrlCheckClientOptions = {},
): SubmissionUrlCheckClient {
  const requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const csrfToken = options.getCsrfToken ?? (() => '')
  const requestIdGenerator = options.requestIdGenerator ?? options.generateRequestId ?? defaultRequestId

  return {
    async check(request, requestOptions = {}) {
      if (!validRequest(request)) {
        throw new TypeError('Invalid SubmissionUrlCheckRequest')
      }
      const requestId = requestIdGenerator()
      const csrf = await csrfToken()
      const init: RequestInit = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'X-Request-Id': requestId,
        },
        credentials: 'include',
        body: JSON.stringify({
          raw_url: request.raw_url,
          category_hint: request.category_hint,
          client_request_id: request.client_request_id,
        }),
      }
      if (requestOptions.signal !== undefined) init.signal = requestOptions.signal

      let response: Response
      try {
        response = await requestFetch(buildRequestUrl(baseUrl), init)
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

      if (response.status !== 201) throw httpError(response, payload, requestId)
      if (!validProjection(payload)) {
        throw protocolError(
          'The API returned an invalid submission URL check projection.',
          headerValue(response, 'x-request-id') ?? requestId,
          response.status,
          payload,
        )
      }
      return payload
    },
  }
}

/** Alias retained for callers that name the operation rather than the client. */
export const createSubmissionUrlCheckHttpClient = createSubmissionUrlCheckClient
