/**
 * Typed browser client for the owner-bound media resource and reference
 * operations.  Uploading the returned URL is intentionally outside this
 * client; this module only speaks to the VibeCheck API.
 */

export type MediaTargetType =
  | 'submission_draft'
  | 'admin_project_creation_draft'
  | 'admin_project_edit_draft'
  | 'project_update'
  | 'creator_profile_draft'
  | 'project_version'
  | 'creator_profile_version'

export type MediaResourceStatus =
  | 'created'
  | 'uploading'
  | 'uploaded'
  | 'scanning'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'deleted'

export type MediaScanResult = 'not_scanned' | 'clean' | 'malicious' | 'unscannable'

export type MediaPublicMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

export interface MediaResource {
  readonly media_resource_id: string
  readonly declared_mime: string
  readonly detected_mime: string | null
  readonly byte_size: number
  readonly width: number | null
  readonly height: number | null
  readonly duration_ms: number | null
  readonly checksum_sha256: string
  readonly source: 'upload' | 'migration'
  readonly status: MediaResourceStatus
  readonly scan_result: MediaScanResult
  readonly rejection_reason_code: string | null
  readonly scan_attempt_count: number
  readonly next_scan_at: string | null
  readonly exif_removed: boolean
  readonly deletion_guard_active: boolean
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface MediaResourcePrepareRequest {
  readonly purpose: 'project_cover'
  readonly declared_mime: MediaPublicMime
  readonly byte_size: number
  readonly checksum_sha256: string
}

export interface MediaResourcePrepareResponse {
  readonly media: MediaResource
  readonly upload_url: string
  readonly upload_headers: Readonly<Record<string, string>>
  readonly upload_expires_at: string
}

export interface MediaResourceCompleteRequest {
  readonly checksum_sha256: string
  readonly upload_receipt: string
}

export interface MediaResourceCompleteResponse {
  readonly media: MediaResource
  readonly scan_queued: true
}

export interface MediaCropFocus {
  readonly x: number
  readonly y: number
}

export interface MediaReference {
  readonly media_reference_id: string
  readonly media_resource_id: string
  readonly target_type: MediaTargetType
  readonly target_id: string
  readonly role: string
  readonly alt_text: string
  readonly sort_order: number
  readonly crop_focus: MediaCropFocus | null
  readonly variant: string | null
  readonly source_media_reference_id: string | null
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface MediaReferencePage {
  readonly items: readonly MediaReference[]
  readonly total_count: number
}

export interface MediaReferenceCreateRequest {
  readonly media_resource_id: string
  readonly target_type: MediaTargetType
  readonly target_id: string
  readonly role: string
  readonly alt_text: string
  readonly sort_order: number
  readonly crop_focus: MediaCropFocus | null
  readonly variant: string | null
  readonly client_request_id: string
}

export interface MediaReferenceListRequest {
  readonly target_type: MediaTargetType
  readonly target_id: string
  readonly role?: string
}

export interface MediaReferenceDeleteRequest {
  readonly expected_version: number
  readonly operation_id: string
}

export type MediaResourceProjection = MediaResource
export type MediaReferenceProjection = MediaReference
export type PrepareMediaResourceProjection = MediaResourcePrepareResponse
export type CompleteMediaResourceProjection = MediaResourceCompleteResponse

export type MediaClientErrorKind = 'transport' | 'protocol' | 'http'

export type MediaFieldError =
  | string
  | Readonly<{
      readonly path: string
      readonly code: string
    }>

export interface MediaClientErrorOptions {
  readonly kind: MediaClientErrorKind
  readonly code: string
  readonly message: string
  readonly messageKey?: string | null
  readonly status: number | null
  readonly requestId: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly fieldErrors?: readonly MediaFieldError[]
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

/** Stable error type for transport failures, protocol failures, and API errors. */
export class MediaClientError extends Error {
  readonly name = 'MediaClientError'
  readonly kind: MediaClientErrorKind
  readonly type: MediaClientErrorKind
  readonly status: number | null
  readonly code: string
  readonly messageKey: string | null
  readonly message_key: string | null
  readonly requestId: string | null
  readonly request_id: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly retry_after_ms: number | null
  readonly fieldErrors: readonly MediaFieldError[]
  readonly field_errors: readonly MediaFieldError[]
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(options: MediaClientErrorOptions) {
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

export const MediaHttpClientError = MediaClientError

export type MediaClientFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface MediaClientOptions {
  /** Injected fetch implementation. Defaults to the platform fetch. */
  readonly fetch?: MediaClientFetch
  /** An explicit API origin/prefix. Omitted means the browser same origin. */
  readonly baseUrl?: string | URL
  /** Supplies the session-bound CSRF token for each mutation. */
  readonly getCsrfToken?: () => string | Promise<string>
  /** Preferred request-id generator. */
  readonly requestIdGenerator?: () => string
  /** Backwards-compatible spelling for requestIdGenerator. */
  readonly generateRequestId?: () => string
}

export interface MediaRequestOptions {
  readonly signal?: AbortSignal
}

export interface MediaIdempotencyRequestOptions extends MediaRequestOptions {
  readonly idempotencyKey: string
}

export interface MediaClientContract {
  prepare(
    request: MediaResourcePrepareRequest,
    options: MediaIdempotencyRequestOptions,
  ): Promise<MediaResourcePrepareResponse>
  get(
    mediaResourceId: string,
    options?: MediaRequestOptions,
  ): Promise<MediaResource>
  complete(
    mediaResourceId: string,
    request: MediaResourceCompleteRequest,
    options: MediaIdempotencyRequestOptions,
  ): Promise<MediaResourceCompleteResponse>
  createReference(
    request: MediaReferenceCreateRequest,
    options?: MediaRequestOptions,
  ): Promise<MediaReference>
  listReferences(
    request: MediaReferenceListRequest,
    options?: MediaRequestOptions,
  ): Promise<MediaReferencePage>
  deleteReference(
    mediaReferenceId: string,
    request: MediaReferenceDeleteRequest,
    options?: MediaRequestOptions,
  ): Promise<void>
}

const resourceCollectionPath = '/api/v1/media-resources'
const referenceCollectionPath = '/api/v1/media-references'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha256Pattern = /^[a-f0-9]{64}$/
const operationIdPattern = /^[A-Za-z0-9._:-]{8,128}$/
const rolePattern = /^[a-z][a-z0-9_]{0,63}$/
const variantPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const mediaResourceKeys = [
  'media_resource_id',
  'declared_mime',
  'detected_mime',
  'byte_size',
  'width',
  'height',
  'duration_ms',
  'checksum_sha256',
  'source',
  'status',
  'scan_result',
  'rejection_reason_code',
  'scan_attempt_count',
  'next_scan_at',
  'exif_removed',
  'deletion_guard_active',
  'version',
  'created_at',
  'updated_at',
] as const

const prepareResponseKeys = ['media', 'upload_url', 'upload_headers', 'upload_expires_at'] as const
const completeResponseKeys = ['media', 'scan_queued'] as const
const mediaReferenceKeys = [
  'media_reference_id',
  'media_resource_id',
  'target_type',
  'target_id',
  'role',
  'alt_text',
  'sort_order',
  'crop_focus',
  'variant',
  'source_media_reference_id',
  'version',
  'created_at',
  'updated_at',
] as const

const mediaReferencePageKeys = ['items', 'total_count'] as const
const prepareRequestKeys = ['purpose', 'declared_mime', 'byte_size', 'checksum_sha256'] as const
const completeRequestKeys = ['checksum_sha256', 'upload_receipt'] as const
const createReferenceRequestKeys = [
  'media_resource_id',
  'target_type',
  'target_id',
  'role',
  'alt_text',
  'sort_order',
  'crop_focus',
  'variant',
  'client_request_id',
] as const
const listReferenceRequestKeys = ['target_type', 'target_id', 'role'] as const
const deleteReferenceRequestKeys = ['expected_version', 'operation_id'] as const

const targetTypes: readonly MediaTargetType[] = [
  'submission_draft',
  'admin_project_creation_draft',
  'admin_project_edit_draft',
  'project_update',
  'creator_profile_draft',
  'project_version',
  'creator_profile_version',
]

const publicMimes: readonly MediaPublicMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]

const resourceStatuses: readonly MediaResourceStatus[] = [
  'created',
  'uploading',
  'uploaded',
  'scanning',
  'processing',
  'ready',
  'rejected',
  'deleted',
]

const scanResults: readonly MediaScanResult[] = [
  'not_scanned',
  'clean',
  'malicious',
  'unscannable',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Object.keys(value).length !== expected.length) return false
  const expectedSet = new Set(expected)
  return Object.keys(value).every((key) => expectedSet.has(key))
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function hasAllKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key))
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
}

function isChecksum(value: unknown): value is string {
  return typeof value === 'string' && sha256Pattern.test(value)
}

function isTargetType(value: unknown): value is MediaTargetType {
  return typeof value === 'string' && targetTypes.includes(value as MediaTargetType)
}

function isPublicMime(value: unknown): value is MediaPublicMime {
  return typeof value === 'string' && publicMimes.includes(value as MediaPublicMime)
}

function isRole(value: unknown): value is string {
  return typeof value === 'string' && rolePattern.test(value)
}

function isVariant(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && variantPattern.test(value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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

function isCropFocus(value: unknown): value is MediaCropFocus | null {
  if (value === null) return true
  return isRecord(value) &&
    hasExactKeys(value, ['x', 'y']) &&
    isFiniteNumber(value.x) && value.x >= 0 && value.x <= 1 &&
    isFiniteNumber(value.y) && value.y >= 0 && value.y <= 1
}

function isUploadHeaders(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isUploadUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || !value.startsWith('https://')) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.length > 0 &&
      parsed.username === '' && parsed.password === '' && parsed.hash === ''
  } catch {
    return false
  }
}

function validPrepareRequest(value: unknown): value is MediaResourcePrepareRequest {
  return isRecord(value) &&
    hasExactKeys(value, prepareRequestKeys) &&
    value.purpose === 'project_cover' &&
    isPublicMime(value.declared_mime) &&
    isPositiveInteger(value.byte_size) && value.byte_size <= 5_242_880 &&
    isChecksum(value.checksum_sha256)
}

function validCompleteRequest(value: unknown): value is MediaResourceCompleteRequest {
  return isRecord(value) &&
    hasExactKeys(value, completeRequestKeys) &&
    isChecksum(value.checksum_sha256) &&
    isString(value.upload_receipt, 1, 4_096) &&
    !Array.from(value.upload_receipt).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 32 || codePoint === 127
    })
}

function validMediaResource(value: unknown): value is MediaResource {
  if (!isRecord(value) || !hasExactKeys(value, mediaResourceKeys)) return false
  if (!isUuid(value.media_resource_id) || !isString(value.declared_mime, 0, 128)) return false
  if (value.detected_mime !== null && !isString(value.detected_mime, 0, 128)) return false
  if (!isPositiveInteger(value.byte_size)) return false
  if (value.width !== null && !isPositiveInteger(value.width)) return false
  if (value.height !== null && !isPositiveInteger(value.height)) return false
  if (value.duration_ms !== null && !isNonNegativeInteger(value.duration_ms)) return false
  if (!isChecksum(value.checksum_sha256)) return false
  if (value.source !== 'upload' && value.source !== 'migration') return false
  if (!resourceStatuses.includes(value.status as MediaResourceStatus)) return false
  if (!scanResults.includes(value.scan_result as MediaScanResult)) return false
  if (value.rejection_reason_code !== null && !isString(value.rejection_reason_code, 0, 64)) return false
  if (!isNonNegativeInteger(value.scan_attempt_count)) return false
  if (value.next_scan_at !== null && !isDateTime(value.next_scan_at)) return false
  if (typeof value.exif_removed !== 'boolean' || typeof value.deletion_guard_active !== 'boolean') return false
  return isPositiveInteger(value.version) && isDateTime(value.created_at) && isDateTime(value.updated_at)
}

function validPrepareResponse(value: unknown): value is MediaResourcePrepareResponse {
  return isRecord(value) &&
    hasExactKeys(value, prepareResponseKeys) &&
    validMediaResource(value.media) &&
    isUploadUrl(value.upload_url) &&
    isUploadHeaders(value.upload_headers) &&
    isDateTime(value.upload_expires_at)
}

function validCompleteResponse(value: unknown): value is MediaResourceCompleteResponse {
  return isRecord(value) &&
    hasExactKeys(value, completeResponseKeys) &&
    validMediaResource(value.media) &&
    value.scan_queued === true
}

function validMediaReference(value: unknown): value is MediaReference {
  if (!isRecord(value) || !hasExactKeys(value, mediaReferenceKeys)) return false
  if (!isUuid(value.media_reference_id) || !isUuid(value.media_resource_id) ||
      !isTargetType(value.target_type) || !isUuid(value.target_id) || !isRole(value.role)) return false
  if (!isString(value.alt_text, 1, 200) || !isNonNegativeInteger(value.sort_order) || value.sort_order > 999) return false
  if (!isCropFocus(value.crop_focus) || !isVariant(value.variant)) return false
  if (value.source_media_reference_id !== null && !isUuid(value.source_media_reference_id)) return false
  return isPositiveInteger(value.version) && isDateTime(value.created_at) && isDateTime(value.updated_at)
}

function validReferencePage(value: unknown): value is MediaReferencePage {
  return isRecord(value) &&
    hasExactKeys(value, mediaReferencePageKeys) &&
    Array.isArray(value.items) && value.items.every(validMediaReference) &&
    isNonNegativeInteger(value.total_count)
}

function validCreateReferenceRequest(value: unknown): value is MediaReferenceCreateRequest {
  return isRecord(value) &&
    hasExactKeys(value, createReferenceRequestKeys) &&
    isUuid(value.media_resource_id) &&
    isTargetType(value.target_type) &&
    isUuid(value.target_id) &&
    isRole(value.role) &&
    isString(value.alt_text, 1, 200) &&
    isNonNegativeInteger(value.sort_order) && value.sort_order <= 999 &&
    isCropFocus(value.crop_focus) &&
    isVariant(value.variant) &&
    typeof value.client_request_id === 'string' && operationIdPattern.test(value.client_request_id)
}

function validListReferenceRequest(value: unknown): value is MediaReferenceListRequest {
  return isRecord(value) &&
    hasAllowedKeys(value, listReferenceRequestKeys) &&
    hasAllKeys(value, ['target_type', 'target_id']) &&
    isTargetType(value.target_type) &&
    isUuid(value.target_id) &&
    (value.role === undefined || isRole(value.role))
}

function validDeleteReferenceRequest(value: unknown): value is MediaReferenceDeleteRequest {
  return isRecord(value) &&
    hasExactKeys(value, deleteReferenceRequestKeys) &&
    isPositiveInteger(value.expected_version) &&
    typeof value.operation_id === 'string' && operationIdPattern.test(value.operation_id)
}

function normalizeBaseUrl(baseUrl: string | URL | undefined): string {
  if (baseUrl === undefined) return ''
  let raw: string
  try {
    raw = String(baseUrl)
  } catch (cause) {
    throw new TypeError('baseUrl must be a valid http(s) URL', { cause })
  }
  if (raw === '' || raw.trim() !== raw) throw new TypeError('baseUrl must be a valid http(s) URL')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (cause) {
    throw new TypeError('baseUrl must be a valid http(s) URL', { cause })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('baseUrl must use http or https')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('baseUrl must not contain credentials, query, or hash')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function defaultRequestId(): string {
  const runtimeCrypto = globalThis.crypto
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') return runtimeCrypto.randomUUID()
  return `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function headerValue(response: Response, name: string): string | null {
  return response.headers?.get(name) ?? null
}

function isFieldError(value: unknown): value is MediaFieldError {
  if (typeof value === 'string') return isString(value, 1, 256)
  return isRecord(value) &&
    hasExactKeys(value, ['path', 'code']) &&
    isString(value.path, 1, 256) &&
    isString(value.code, 1, 64)
}

function validFieldErrors(value: unknown): value is readonly MediaFieldError[] {
  return Array.isArray(value) && value.length <= 50 && value.every(isFieldError)
}

function validErrorObject(value: Record<string, unknown>): boolean {
  const required = ['code', 'message_key', 'request_id', 'retryable', 'retry_after_ms'] as const
  const allowed = [...required, 'details'] as const
  if (!hasAllowedKeys(value, allowed) || !hasAllKeys(value, required)) return false
  if (!isString(value.code, 1, 64) || !isString(value.message_key, 1, 128) ||
      !isString(value.request_id, 1, 64) || typeof value.retryable !== 'boolean') return false
  if (value.retry_after_ms !== null && !isNonNegativeInteger(value.retry_after_ms)) return false
  if (Object.hasOwn(value, 'details')) {
    if (!isRecord(value.details)) return false
    if (Object.hasOwn(value.details, 'field_errors') && !validFieldErrors(value.details.field_errors)) return false
  }
  return true
}

function validErrorEnvelope(value: unknown): value is { readonly error: Record<string, unknown> } {
  return isRecord(value) &&
    hasExactKeys(value, ['error']) &&
    isRecord(value.error) &&
    validErrorObject(value.error)
}

function errorDetails(error: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  return isRecord(error.details) ? error.details : undefined
}

function errorFieldErrors(error: Record<string, unknown>): readonly MediaFieldError[] {
  const details = errorDetails(error)
  if (details && Array.isArray(details.field_errors)) return details.field_errors as readonly MediaFieldError[]
  return []
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
): MediaClientError {
  return new MediaClientError({
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

function networkError(requestId: string, cause: unknown): MediaClientError {
  return new MediaClientError({
    kind: 'transport',
    code: 'TRANSPORT_NETWORK_ERROR',
    message: 'The media request could not reach the API.',
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
): MediaClientError {
  const responseRequestId = headerValue(response, 'x-request-id') ?? sentRequestId
  if (!validErrorEnvelope(payload)) {
    return protocolError('The API returned an invalid error response.', responseRequestId, response.status, payload)
  }

  const error = payload.error
  const details = errorDetails(error)
  return new MediaClientError({
    kind: 'http',
    code: error.code as string,
    message: error.message_key as string,
    messageKey: error.message_key as string,
    status: response.status,
    requestId: error.request_id as string,
    retryable: error.retryable as boolean,
    retryAfterMs: error.retry_after_ms as number | null,
    fieldErrors: errorFieldErrors(error),
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

function resourcePath(mediaResourceId: string): string {
  return `${resourceCollectionPath}/${encodeURIComponent(mediaResourceId)}`
}

function referencePath(mediaReferenceId: string): string {
  return `${referenceCollectionPath}/${encodeURIComponent(mediaReferenceId)}`
}

function buildListUrl(baseUrl: string, request: MediaReferenceListRequest): string {
  const params = new URLSearchParams()
  params.set('target_type', request.target_type)
  params.set('target_id', request.target_id)
  if (request.role !== undefined) params.set('role', request.role)
  return `${baseUrl}${referenceCollectionPath}?${params.toString()}`
}

/** Independent typed client for the six P10 media HTTP operations. */
export class MediaClient implements MediaClientContract {
  private readonly requestFetch: MediaClientFetch
  private readonly baseUrl: string
  private readonly csrfToken: () => string | Promise<string>
  private readonly requestIdGenerator: () => string

  constructor(options: MediaClientOptions = {}) {
    this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.csrfToken = options.getCsrfToken ?? (() => '')
    this.requestIdGenerator = options.requestIdGenerator ?? options.generateRequestId ?? defaultRequestId
  }

  async prepare(
    request: MediaResourcePrepareRequest,
    requestOptions: MediaIdempotencyRequestOptions = { idempotencyKey: '' },
  ): Promise<MediaResourcePrepareResponse> {
    if (!validPrepareRequest(request)) throw new TypeError('Invalid MediaResourcePrepareRequest')
    if (!operationIdPattern.test(requestOptions.idempotencyKey)) {
      throw new TypeError('Invalid MediaResource prepare Idempotency-Key')
    }
    const body = serializeBody({
      purpose: request.purpose,
      declared_mime: request.declared_mime,
      byte_size: request.byte_size,
      checksum_sha256: request.checksum_sha256,
    }, 'MediaResourcePrepareRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${resourceCollectionPath}`, body, requestOptions, 201,
      validPrepareResponse, 'media resource prepare', requestOptions.idempotencyKey,
    )
  }

  async get(
    mediaResourceId: string,
    requestOptions: MediaRequestOptions = {},
  ): Promise<MediaResource> {
    if (!isUuid(mediaResourceId)) throw new TypeError('Invalid MediaResource media_resource_id')
    return this.send(
      'GET', `${this.baseUrl}${resourcePath(mediaResourceId)}`, requestOptions, 200,
      validMediaResource, 'media resource',
    )
  }

  async complete(
    mediaResourceId: string,
    request: MediaResourceCompleteRequest,
    requestOptions: MediaIdempotencyRequestOptions = { idempotencyKey: '' },
  ): Promise<MediaResourceCompleteResponse> {
    if (!isUuid(mediaResourceId)) throw new TypeError('Invalid MediaResource media_resource_id')
    if (!validCompleteRequest(request)) throw new TypeError('Invalid MediaResourceCompleteRequest')
    if (!operationIdPattern.test(requestOptions.idempotencyKey)) {
      throw new TypeError('Invalid MediaResource complete Idempotency-Key')
    }
    const body = serializeBody({
      checksum_sha256: request.checksum_sha256,
      upload_receipt: request.upload_receipt,
    }, 'MediaResourceCompleteRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${resourcePath(mediaResourceId)}/complete`, body,
      requestOptions, 202, validCompleteResponse, 'media resource complete', requestOptions.idempotencyKey,
    )
  }

  async createReference(
    request: MediaReferenceCreateRequest,
    requestOptions: MediaRequestOptions = {},
  ): Promise<MediaReference> {
    if (!validCreateReferenceRequest(request)) throw new TypeError('Invalid MediaReferenceCreateRequest')
    const body = serializeBody({
      media_resource_id: request.media_resource_id,
      target_type: request.target_type,
      target_id: request.target_id,
      role: request.role,
      alt_text: request.alt_text,
      sort_order: request.sort_order,
      crop_focus: request.crop_focus === null ? null : { x: request.crop_focus.x, y: request.crop_focus.y },
      variant: request.variant,
      client_request_id: request.client_request_id,
    }, 'MediaReferenceCreateRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${referenceCollectionPath}`, body, requestOptions, 201,
      validMediaReference, 'media reference',
    )
  }

  async listReferences(
    request: MediaReferenceListRequest,
    requestOptions: MediaRequestOptions = {},
  ): Promise<MediaReferencePage> {
    if (!validListReferenceRequest(request)) throw new TypeError('Invalid MediaReferenceListRequest')
    return this.send(
      'GET', buildListUrl(this.baseUrl, request), requestOptions, 200,
      validReferencePage, 'media reference page',
    )
  }

  async deleteReference(
    mediaReferenceId: string,
    request: MediaReferenceDeleteRequest,
    requestOptions: MediaRequestOptions = {},
  ): Promise<void> {
    if (!isUuid(mediaReferenceId)) throw new TypeError('Invalid MediaReference media_reference_id')
    if (!validDeleteReferenceRequest(request)) throw new TypeError('Invalid MediaReferenceDeleteRequest')
    const body = serializeBody({
      expected_version: request.expected_version,
      operation_id: request.operation_id,
    }, 'MediaReferenceDeleteRequest')
    await this.sendJson(
      'DELETE', `${this.baseUrl}${referencePath(mediaReferenceId)}`, body, requestOptions, 204,
      null, 'media reference delete',
    )
  }

  private async sendJson<T>(
    method: 'POST' | 'DELETE',
    url: string,
    body: string,
    requestOptions: MediaRequestOptions,
    expectedStatus: number,
    validateProjection: ((value: unknown) => value is T) | null,
    projectionName: string,
    idempotencyKey?: string,
  ): Promise<T> {
    const requestId = this.requestIdGenerator()
    const csrf = await this.csrfToken()
    if (typeof csrf !== 'string') throw new TypeError('CSRF token must be a string')
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      'X-Request-Id': requestId,
    }
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey
    const init: RequestInit = {
      method,
      headers,
      credentials: 'include',
      body,
    }
    if (requestOptions.signal !== undefined) init.signal = requestOptions.signal
    return this.sendWithRequestId(url, init, requestId, expectedStatus, validateProjection, projectionName)
  }

  private async send<T>(
    method: 'GET',
    url: string,
    requestOptions: MediaRequestOptions,
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
    validateProjection: ((value: unknown) => value is T) | null,
    projectionName: string,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.requestFetch(url, init)
    } catch (cause) {
      throw networkError(requestId, cause)
    }

    if (response.status === expectedStatus && expectedStatus === 204) {
      return undefined as T
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
    if (validateProjection === null || !validateProjection(payload)) {
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
export function createMediaClient(options: MediaClientOptions = {}): MediaClient {
  return new MediaClient(options)
}

/** Alias retained for callers that name the HTTP transport explicitly. */
export const createMediaHttpClient = createMediaClient
