/**
 * Typed browser client for the owner-bound evidence-draft HTTP operations.
 * This module deliberately does not upload or create evidence attachments.
 */

export type EvidenceParentType =
  | 'submission_draft'
  | 'admin_project_creation_draft'
  | 'admin_project_edit_draft'
  | 'project_update'
  | 'relation_candidate'

export type EvidenceFinalTargetKind = 'project' | 'version' | 'event' | 'asset' | 'relation'

export type EvidenceType =
  | 'platform_verified_fact'
  | 'verified_author_statement'
  | 'trusted_external_source'
  | 'system_inference'

export type EvidenceSourceChannel =
  | 'official_site'
  | 'repository'
  | 'release_note'
  | 'media_report'
  | 'author_statement'
  | 'platform_check'

export type EvidenceVisibility = 'public' | 'reviewer_only' | 'private'

export type EvidenceCollectorActorType = 'system' | 'platform_editor' | 'verified_author' | 'user'

export type EvidenceDraftStatus = 'editing' | 'ready' | 'withdrawn' | 'promoted' | 'expired'

export type EvidenceAttachmentRole = 'supporting_document' | 'supporting_image'

export type EvidenceAttachmentDraftStatus = 'active' | 'withdrawn' | 'promoted' | 'expired'

export interface EvidenceFinalFieldPreview {
  readonly source_summary: string
  readonly captured_at: string
  readonly collected_by: EvidenceCollectorActorType
  readonly confidence: 'high' | 'medium' | 'low'
  readonly source_channel: EvidenceSourceChannel
}

export interface EvidenceAttachmentDraft {
  readonly attachment_draft_id: string
  readonly evidence_draft_id: string
  readonly media_resource_id: string
  readonly role: EvidenceAttachmentRole
  readonly requested_visibility: EvidenceVisibility
  readonly status: EvidenceAttachmentDraftStatus
  readonly version: number
  readonly evidence_draft_version: number
  readonly created_at: string
  readonly updated_at: string
}

/** The exact JSON projection returned by the evidence-draft endpoints. */
export interface EvidenceDraft {
  readonly evidence_draft_id: string
  readonly collector_actor_type: EvidenceCollectorActorType
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly final_target_kind: EvidenceFinalTargetKind
  readonly target_asset_draft_key: string | null
  readonly evidence_type: EvidenceType
  readonly source_channel: EvidenceSourceChannel
  readonly field_path: string | null
  readonly requested_visibility: EvidenceVisibility
  readonly source_url: string | null
  readonly text_excerpt: string | null
  readonly attachment_drafts: readonly EvidenceAttachmentDraft[]
  readonly status: EvidenceDraftStatus
  readonly bound: boolean
  readonly source_hash: string
  readonly final_field_preview: EvidenceFinalFieldPreview | null
  readonly completed_at: string | null
  readonly promoted_evidence_id: string | null
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface EvidenceDraftCreateRequest {
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly final_target_kind: EvidenceFinalTargetKind
  readonly target_asset_draft_key?: string | null
  readonly field_path?: string | null
  readonly requested_visibility: EvidenceVisibility
  readonly evidence_type: EvidenceType
  readonly source_channel: EvidenceSourceChannel
  readonly client_request_id: string
}

export interface EvidenceDraftPatchRequest {
  readonly expected_version: number
  readonly source_url?: string | null
  readonly internal_record_ref?: string | null
  readonly text_excerpt?: string | null
  readonly field_path?: string | null
  readonly requested_visibility?: EvidenceVisibility
}

export interface EvidenceDraftBindRequest {
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly expected_parent_version: number
  readonly operation_id: string
}

export interface EvidenceDraftCompleteRequest {
  readonly expected_version: number
  readonly operation_id: string
}

export interface EvidenceDraftWithdrawRequest {
  readonly expected_version: number
  readonly reason_code: string
  readonly operation_id: string
}

export interface EvidenceBinding {
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly evidence_draft_ids: readonly string[]
  readonly parent_version: number
  readonly evidence_draft_version: number
}

export type EvidenceDraftProjection = EvidenceDraft
export type EvidenceBindingProjection = EvidenceBinding
export type EvidenceAttachmentDraftProjection = EvidenceAttachmentDraft
export type EvidenceFinalFieldPreviewProjection = EvidenceFinalFieldPreview

export interface EvidenceDraftFieldError {
  readonly path: string
  readonly code: string
}

/** Some existing API details use a legacy string path form. */
export type EvidenceDraftFieldErrorValue = EvidenceDraftFieldError | string

export interface EvidenceDraftErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message_key: string
    readonly request_id: string
    readonly retryable: boolean
    readonly retry_after_ms: number | null
    readonly details?: Readonly<Record<string, unknown>>
  }
}

export type EvidenceDraftClientErrorKind = 'transport' | 'protocol' | 'http'

export interface EvidenceDraftClientErrorOptions {
  readonly kind: EvidenceDraftClientErrorKind
  readonly code: string
  readonly message: string
  readonly messageKey?: string | null
  readonly status: number | null
  readonly requestId: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly fieldErrors?: readonly EvidenceDraftFieldErrorValue[]
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

/** Stable error type for transport failures, protocol failures, and API errors. */
export class EvidenceDraftClientError extends Error {
  readonly name = 'EvidenceDraftClientError'
  readonly kind: EvidenceDraftClientErrorKind
  readonly type: EvidenceDraftClientErrorKind
  readonly status: number | null
  readonly code: string
  readonly messageKey: string | null
  readonly message_key: string | null
  readonly requestId: string | null
  readonly request_id: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly retry_after_ms: number | null
  readonly fieldErrors: readonly EvidenceDraftFieldErrorValue[]
  readonly field_errors: readonly EvidenceDraftFieldErrorValue[]
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(options: EvidenceDraftClientErrorOptions) {
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

export type EvidenceDraftFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface EvidenceDraftClientOptions {
  /** Injected fetch implementation. Defaults to the platform fetch. */
  readonly fetch?: EvidenceDraftFetch
  /** API origin/prefix. Omitted means the browser same origin. */
  readonly baseUrl?: string | URL
  /** Supplies the session-bound CSRF token for each mutation. */
  readonly getCsrfToken?: () => string | Promise<string>
  /** Preferred request-id generator. */
  readonly requestIdGenerator?: () => string
  /** Backwards-compatible spelling for requestIdGenerator. */
  readonly generateRequestId?: () => string
}

export interface EvidenceDraftRequestOptions {
  readonly signal?: AbortSignal
}

export interface EvidenceDraftPatchRequestOptions extends EvidenceDraftRequestOptions {
  readonly idempotencyKey: string
}

export type EvidenceDraftIdempotencyRequestOptions = EvidenceDraftPatchRequestOptions

export interface EvidenceDraftClientContract {
  create(
    request: EvidenceDraftCreateRequest,
    options?: EvidenceDraftRequestOptions,
  ): Promise<EvidenceDraft>
  get(
    evidenceDraftId: string,
    options?: EvidenceDraftRequestOptions,
  ): Promise<EvidenceDraft>
  patch(
    evidenceDraftId: string,
    request: EvidenceDraftPatchRequest,
    options: EvidenceDraftPatchRequestOptions,
  ): Promise<EvidenceDraft>
  bind(
    evidenceDraftId: string,
    request: EvidenceDraftBindRequest,
    options?: EvidenceDraftRequestOptions,
  ): Promise<EvidenceBinding>
  complete(
    evidenceDraftId: string,
    request: EvidenceDraftCompleteRequest,
    options?: EvidenceDraftRequestOptions,
  ): Promise<EvidenceDraft>
  withdraw(
    evidenceDraftId: string,
    request: EvidenceDraftWithdrawRequest,
    options?: EvidenceDraftRequestOptions,
  ): Promise<EvidenceDraft>
}

const collectionPath = '/api/v1/evidence-drafts'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha256Pattern = /^[a-f0-9]{64}$/
const operationIdPattern = /^[A-Za-z0-9._:-]{8,128}$/
const assetDraftKeyPattern = /^[A-Za-z0-9._:-]{1,128}$/
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const parentTypes: readonly EvidenceParentType[] = [
  'submission_draft',
  'admin_project_creation_draft',
  'admin_project_edit_draft',
  'project_update',
  'relation_candidate',
]

const finalTargetKinds: readonly EvidenceFinalTargetKind[] = [
  'project',
  'version',
  'event',
  'asset',
  'relation',
]

const evidenceTypes: readonly EvidenceType[] = [
  'platform_verified_fact',
  'verified_author_statement',
  'trusted_external_source',
  'system_inference',
]

const sourceChannels: readonly EvidenceSourceChannel[] = [
  'official_site',
  'repository',
  'release_note',
  'media_report',
  'author_statement',
  'platform_check',
]

const visibilities: readonly EvidenceVisibility[] = ['public', 'reviewer_only', 'private']
const collectorActorTypes: readonly EvidenceCollectorActorType[] = [
  'system',
  'platform_editor',
  'verified_author',
  'user',
]
const draftStatuses: readonly EvidenceDraftStatus[] = [
  'editing',
  'ready',
  'withdrawn',
  'promoted',
  'expired',
]
const attachmentRoles: readonly EvidenceAttachmentRole[] = ['supporting_document', 'supporting_image']
const attachmentStatuses: readonly EvidenceAttachmentDraftStatus[] = [
  'active',
  'withdrawn',
  'promoted',
  'expired',
]
const confidenceValues = ['high', 'medium', 'low'] as const

const draftKeys = [
  'evidence_draft_id',
  'collector_actor_type',
  'parent_type',
  'parent_id',
  'final_target_kind',
  'target_asset_draft_key',
  'evidence_type',
  'source_channel',
  'field_path',
  'requested_visibility',
  'source_url',
  'text_excerpt',
  'attachment_drafts',
  'status',
  'bound',
  'source_hash',
  'final_field_preview',
  'completed_at',
  'promoted_evidence_id',
  'version',
  'created_at',
  'updated_at',
] as const

const attachmentKeys = [
  'attachment_draft_id',
  'evidence_draft_id',
  'media_resource_id',
  'role',
  'requested_visibility',
  'status',
  'version',
  'evidence_draft_version',
  'created_at',
  'updated_at',
] as const

const finalFieldPreviewKeys = [
  'source_summary',
  'captured_at',
  'collected_by',
  'confidence',
  'source_channel',
] as const

const createRequestKeys = [
  'parent_type',
  'parent_id',
  'final_target_kind',
  'target_asset_draft_key',
  'field_path',
  'requested_visibility',
  'evidence_type',
  'source_channel',
  'client_request_id',
] as const

const patchRequestKeys = [
  'expected_version',
  'source_url',
  'internal_record_ref',
  'text_excerpt',
  'field_path',
  'requested_visibility',
] as const

const bindRequestKeys = ['parent_type', 'parent_id', 'expected_parent_version', 'operation_id'] as const
const completeRequestKeys = ['expected_version', 'operation_id'] as const
const withdrawRequestKeys = ['expected_version', 'reason_code', 'operation_id'] as const
const bindingKeys = [
  'parent_type',
  'parent_id',
  'evidence_draft_ids',
  'parent_version',
  'evidence_draft_version',
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

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
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

function isUuidArray(value: unknown, maximum: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(isUuid)
}

function hasControlOrWhitespace(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 32 || codePoint === 127
  })
}

function isHttpUrl(value: unknown, maximum: number): value is string {
  if (!isString(value, 1, maximum) || hasControlOrWhitespace(value) || !/^(?:http|https):\/\//u.test(value)) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname !== '' && parsed.username === '' && parsed.password === '' && parsed.port === ''
  } catch {
    return false
  }
}

function isNullableString(value: unknown, maximum: number): value is string | null {
  return value === null || isString(value, 0, maximum)
}

function isOptionalNullableString(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
): boolean {
  return !Object.hasOwn(value, key) || isNullableString(value[key], maximum)
}

function isOptionalHttpUrl(value: Record<string, unknown>, key: string, maximum: number): boolean {
  return !Object.hasOwn(value, key) || value[key] === null || isHttpUrl(value[key], maximum)
}

function isFieldPath(value: unknown): value is string | null {
  if (!isNullableString(value, 240)) return false
  if (value === null) return true
  return value.length >= 2 && value.startsWith('/') && !value.includes('//') && !hasControlOrWhitespace(value)
}

function isAssetDraftKey(value: unknown): value is string {
  return typeof value === 'string' && assetDraftKeyPattern.test(value)
}

function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && operationIdPattern.test(value)
}

function validCreateRequest(value: unknown): value is EvidenceDraftCreateRequest {
  if (!isRecord(value) || !hasAllowedKeys(value, createRequestKeys) ||
      !hasAllKeys(value, ['parent_type', 'parent_id', 'final_target_kind', 'requested_visibility', 'evidence_type', 'source_channel', 'client_request_id'])) {
    return false
  }
  if (!isEnum(value.parent_type, parentTypes) || !isUuid(value.parent_id) ||
      !isEnum(value.final_target_kind, finalTargetKinds) || !isEnum(value.requested_visibility, visibilities) ||
      !isEnum(value.evidence_type, evidenceTypes) || !isEnum(value.source_channel, sourceChannels) ||
      !isOperationId(value.client_request_id) || !isOptionalNullableString(value, 'target_asset_draft_key', 128) ||
      !isFieldPath(Object.hasOwn(value, 'field_path') ? value.field_path : null)) {
    return false
  }

  const targetAssetDraftKey = Object.hasOwn(value, 'target_asset_draft_key')
    ? value.target_asset_draft_key
    : null
  if (value.final_target_kind === 'asset') {
    if (!isAssetDraftKey(targetAssetDraftKey)) return false
  } else if (targetAssetDraftKey !== null) {
    return false
  }
  if ((value.parent_type === 'relation_candidate') !== (value.final_target_kind === 'relation')) return false
  return true
}

function validPatchRequest(value: unknown): value is EvidenceDraftPatchRequest {
  if (!isRecord(value) || !hasAllowedKeys(value, patchRequestKeys) ||
      !hasAllKeys(value, ['expected_version']) || Object.keys(value).length < 2 ||
      !isPositiveInteger(value.expected_version) || !isOptionalHttpUrl(value, 'source_url', 2_048) ||
      !isOptionalNullableString(value, 'internal_record_ref', 240) ||
      !isOptionalNullableString(value, 'text_excerpt', 2_000) ||
      (Object.hasOwn(value, 'field_path') && !isFieldPath(value.field_path)) ||
      (Object.hasOwn(value, 'requested_visibility') && !isEnum(value.requested_visibility, visibilities))) {
    return false
  }
  return true
}

function validBindRequest(value: unknown): value is EvidenceDraftBindRequest {
  return isRecord(value) && hasExactKeys(value, bindRequestKeys) &&
    isEnum(value.parent_type, parentTypes) && isUuid(value.parent_id) &&
    isPositiveInteger(value.expected_parent_version) && isOperationId(value.operation_id)
}

function validCompleteRequest(value: unknown): value is EvidenceDraftCompleteRequest {
  return isRecord(value) && hasExactKeys(value, completeRequestKeys) &&
    isPositiveInteger(value.expected_version) && isOperationId(value.operation_id)
}

function validWithdrawRequest(value: unknown): value is EvidenceDraftWithdrawRequest {
  return isRecord(value) && hasExactKeys(value, withdrawRequestKeys) &&
    isPositiveInteger(value.expected_version) && isString(value.reason_code, 1, 64) &&
    /^[a-z][a-z0-9_]{0,63}$/.test(value.reason_code) && isOperationId(value.operation_id)
}

function validFinalFieldPreview(value: unknown): value is EvidenceFinalFieldPreview {
  return isRecord(value) && hasExactKeys(value, finalFieldPreviewKeys) &&
    isString(value.source_summary, 1, 2_000) && isDateTime(value.captured_at) &&
    isEnum(value.collected_by, collectorActorTypes) && isEnum(value.confidence, confidenceValues) &&
    isEnum(value.source_channel, sourceChannels)
}

function validAttachmentDraft(value: unknown): value is EvidenceAttachmentDraft {
  return isRecord(value) && hasExactKeys(value, attachmentKeys) &&
    isUuid(value.attachment_draft_id) && isUuid(value.evidence_draft_id) &&
    isUuid(value.media_resource_id) && isEnum(value.role, attachmentRoles) &&
    isEnum(value.requested_visibility, visibilities) && isEnum(value.status, attachmentStatuses) &&
    isPositiveInteger(value.version) && isPositiveInteger(value.evidence_draft_version) &&
    isDateTime(value.created_at) && isDateTime(value.updated_at)
}

function validEvidenceDraft(value: unknown): value is EvidenceDraft {
  if (!isRecord(value) || !hasExactKeys(value, draftKeys)) return false
  if (!isUuid(value.evidence_draft_id) || !isEnum(value.collector_actor_type, collectorActorTypes) ||
      !isEnum(value.parent_type, parentTypes) || !isUuid(value.parent_id) ||
      !isEnum(value.final_target_kind, finalTargetKinds) ||
      !isNullableString(value.target_asset_draft_key, 128) || !isEnum(value.evidence_type, evidenceTypes) ||
      !isEnum(value.source_channel, sourceChannels) || !isFieldPath(value.field_path) ||
      !isEnum(value.requested_visibility, visibilities) || !isOptionalHttpUrl(value, 'source_url', 2_048) ||
      !isNullableString(value.text_excerpt, 2_000) || !Array.isArray(value.attachment_drafts) ||
      value.attachment_drafts.length > 10 || !value.attachment_drafts.every(validAttachmentDraft) ||
      !isEnum(value.status, draftStatuses) || typeof value.bound !== 'boolean' ||
      typeof value.source_hash !== 'string' || !sha256Pattern.test(value.source_hash) ||
      (value.final_field_preview !== null && !validFinalFieldPreview(value.final_field_preview)) ||
      (value.completed_at !== null && !isDateTime(value.completed_at)) ||
      (value.promoted_evidence_id !== null && !isUuid(value.promoted_evidence_id)) ||
      !isPositiveInteger(value.version) || !isDateTime(value.created_at) || !isDateTime(value.updated_at)) {
    return false
  }
  return true
}

function validBinding(value: unknown): value is EvidenceBinding {
  return isRecord(value) && hasExactKeys(value, bindingKeys) &&
    isEnum(value.parent_type, parentTypes) && isUuid(value.parent_id) &&
    isUuidArray(value.evidence_draft_ids, 50) && isPositiveInteger(value.parent_version) &&
    isPositiveInteger(value.evidence_draft_version)
}

function normalizeBaseUrl(baseUrl: string | URL | undefined): string {
  if (baseUrl === undefined) return ''
  let value: string
  try {
    value = String(baseUrl)
  } catch (cause) {
    throw new TypeError('baseUrl must be a valid http(s) URL', { cause })
  }
  if (value === '') return ''
  if (value.trim() !== value || hasControlOrWhitespace(value)) {
    throw new TypeError('baseUrl must not contain whitespace or control characters')
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    let parsed: URL
    try {
      parsed = new URL(value)
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
  if (value.startsWith('//')) {
    throw new TypeError('baseUrl must be same-origin or use an explicit http(s) origin')
  }
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    throw new TypeError('relative baseUrl must start with / and contain no query or hash')
  }
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

function isFieldError(value: unknown): value is EvidenceDraftFieldErrorValue {
  if (typeof value === 'string') return isString(value, 1, 256)
  return isRecord(value) && hasExactKeys(value, ['path', 'code']) &&
    isString(value.path, 1, 256) && isString(value.code, 1, 64)
}

function validFieldErrors(value: unknown): value is readonly EvidenceDraftFieldErrorValue[] {
  return Array.isArray(value) && value.length <= 50 && value.every(isFieldError)
}

function validDetails(value: unknown): value is Readonly<Record<string, unknown>> {
  return isRecord(value) &&
    (!Object.hasOwn(value, 'field_errors') || validFieldErrors(value.field_errors))
}

function validErrorObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const required = ['code', 'message_key', 'request_id', 'retryable', 'retry_after_ms'] as const
  const allowed = [...required, 'details'] as const
  if (!hasAllowedKeys(value, allowed) || !hasAllKeys(value, required)) return false
  if (!isString(value.code, 1, 64) || !isString(value.message_key, 1, 128) ||
      !isString(value.request_id, 1, 64) || typeof value.retryable !== 'boolean' ||
      (value.retry_after_ms !== null && !isNonNegativeInteger(value.retry_after_ms)) ||
      (Object.hasOwn(value, 'details') && !validDetails(value.details))) {
    return false
  }
  return true
}

function validErrorEnvelope(value: unknown): value is EvidenceDraftErrorEnvelope {
  return isRecord(value) && hasExactKeys(value, ['error']) && validErrorObject(value.error)
}

function errorDetails(error: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  return isRecord(error.details) ? error.details : undefined
}

function errorFieldErrors(error: Record<string, unknown>): readonly EvidenceDraftFieldErrorValue[] {
  const details = errorDetails(error)
  if (details !== undefined && Array.isArray(details.field_errors)) {
    return details.field_errors as readonly EvidenceDraftFieldErrorValue[]
  }
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
): EvidenceDraftClientError {
  return new EvidenceDraftClientError({
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

function networkError(requestId: string, cause: unknown): EvidenceDraftClientError {
  return new EvidenceDraftClientError({
    kind: 'transport',
    code: 'TRANSPORT_NETWORK_ERROR',
    message: 'The evidence-draft request could not reach the API.',
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
): EvidenceDraftClientError {
  const responseRequestId = headerValue(response, 'x-request-id') ?? sentRequestId
  if (!validErrorEnvelope(payload)) {
    return protocolError('The API returned an invalid error response.', responseRequestId, response.status, payload)
  }

  const error = payload.error
  const details = errorDetails(error)
  return new EvidenceDraftClientError({
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

function draftPath(evidenceDraftId: string): string {
  return `${collectionPath}/${encodeURIComponent(evidenceDraftId)}`
}

function createBody(request: EvidenceDraftCreateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    parent_type: request.parent_type,
    parent_id: request.parent_id,
    final_target_kind: request.final_target_kind,
  }
  if (Object.hasOwn(request, 'target_asset_draft_key')) body.target_asset_draft_key = request.target_asset_draft_key
  if (Object.hasOwn(request, 'field_path')) body.field_path = request.field_path
  body.requested_visibility = request.requested_visibility
  body.evidence_type = request.evidence_type
  body.source_channel = request.source_channel
  body.client_request_id = request.client_request_id
  return body
}

function patchBody(request: EvidenceDraftPatchRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { expected_version: request.expected_version }
  for (const key of ['source_url', 'internal_record_ref', 'text_excerpt', 'field_path', 'requested_visibility'] as const) {
    if (Object.hasOwn(request, key)) body[key] = request[key]
  }
  return body
}

/** Independent typed client for the six evidence-draft HTTP operations. */
export class EvidenceDraftClient implements EvidenceDraftClientContract {
  private readonly requestFetch: EvidenceDraftFetch
  private readonly baseUrl: string
  private readonly csrfToken: () => string | Promise<string>
  private readonly requestIdGenerator: () => string

  constructor(options: EvidenceDraftClientOptions = {}) {
    this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.csrfToken = options.getCsrfToken ?? (() => '')
    this.requestIdGenerator = options.requestIdGenerator ?? options.generateRequestId ?? defaultRequestId
  }

  async create(
    request: EvidenceDraftCreateRequest,
    requestOptions: EvidenceDraftRequestOptions = {},
  ): Promise<EvidenceDraft> {
    if (!validCreateRequest(request)) throw new TypeError('Invalid EvidenceDraftCreateRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${collectionPath}`, serializeBody(createBody(request), 'EvidenceDraftCreateRequest'),
      requestOptions, 201, validEvidenceDraft, 'evidence draft',
    )
  }

  async get(
    evidenceDraftId: string,
    requestOptions: EvidenceDraftRequestOptions = {},
  ): Promise<EvidenceDraft> {
    if (!isUuid(evidenceDraftId)) throw new TypeError('Invalid EvidenceDraft evidence_draft_id')
    return this.send(
      `${this.baseUrl}${draftPath(evidenceDraftId)}`, requestOptions, 200,
      validEvidenceDraft, 'evidence draft',
    )
  }

  async patch(
    evidenceDraftId: string,
    request: EvidenceDraftPatchRequest,
    requestOptions: EvidenceDraftPatchRequestOptions,
  ): Promise<EvidenceDraft> {
    if (!isUuid(evidenceDraftId)) throw new TypeError('Invalid EvidenceDraft evidence_draft_id')
    if (!validPatchRequest(request)) throw new TypeError('Invalid EvidenceDraftPatchRequest')
    if (!requestOptions || !isOperationId(requestOptions.idempotencyKey)) {
      throw new TypeError('Invalid EvidenceDraft patch Idempotency-Key')
    }
    return this.sendJson(
      'PATCH', `${this.baseUrl}${draftPath(evidenceDraftId)}`,
      serializeBody(patchBody(request), 'EvidenceDraftPatchRequest'), requestOptions, 200,
      validEvidenceDraft, 'evidence draft', requestOptions.idempotencyKey,
    )
  }

  async bind(
    evidenceDraftId: string,
    request: EvidenceDraftBindRequest,
    requestOptions: EvidenceDraftRequestOptions = {},
  ): Promise<EvidenceBinding> {
    if (!isUuid(evidenceDraftId)) throw new TypeError('Invalid EvidenceDraft evidence_draft_id')
    if (!validBindRequest(request)) throw new TypeError('Invalid EvidenceDraftBindRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${draftPath(evidenceDraftId)}/binding`,
      serializeBody({
        parent_type: request.parent_type,
        parent_id: request.parent_id,
        expected_parent_version: request.expected_parent_version,
        operation_id: request.operation_id,
      }, 'EvidenceDraftBindRequest'), requestOptions, 200, validBinding, 'evidence binding',
    )
  }

  async complete(
    evidenceDraftId: string,
    request: EvidenceDraftCompleteRequest,
    requestOptions: EvidenceDraftRequestOptions = {},
  ): Promise<EvidenceDraft> {
    if (!isUuid(evidenceDraftId)) throw new TypeError('Invalid EvidenceDraft evidence_draft_id')
    if (!validCompleteRequest(request)) throw new TypeError('Invalid EvidenceDraftCompleteRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${draftPath(evidenceDraftId)}/complete`,
      serializeBody({
        expected_version: request.expected_version,
        operation_id: request.operation_id,
      }, 'EvidenceDraftCompleteRequest'), requestOptions, 200, validEvidenceDraft, 'evidence draft',
    )
  }

  async withdraw(
    evidenceDraftId: string,
    request: EvidenceDraftWithdrawRequest,
    requestOptions: EvidenceDraftRequestOptions = {},
  ): Promise<EvidenceDraft> {
    if (!isUuid(evidenceDraftId)) throw new TypeError('Invalid EvidenceDraft evidence_draft_id')
    if (!validWithdrawRequest(request)) throw new TypeError('Invalid EvidenceDraftWithdrawRequest')
    return this.sendJson(
      'POST', `${this.baseUrl}${draftPath(evidenceDraftId)}/withdraw`,
      serializeBody({
        expected_version: request.expected_version,
        reason_code: request.reason_code,
        operation_id: request.operation_id,
      }, 'EvidenceDraftWithdrawRequest'), requestOptions, 200, validEvidenceDraft, 'evidence draft',
    )
  }

  private async sendJson<T>(
    method: 'POST' | 'PATCH',
    url: string,
    body: string,
    requestOptions: EvidenceDraftRequestOptions,
    expectedStatus: number,
    validateProjection: (value: unknown) => value is T,
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
    url: string,
    requestOptions: EvidenceDraftRequestOptions,
    expectedStatus: number,
    validateProjection: (value: unknown) => value is T,
    projectionName: string,
  ): Promise<T> {
    const requestId = this.requestIdGenerator()
    const init: RequestInit = {
      method: 'GET',
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
export function createEvidenceDraftClient(
  options: EvidenceDraftClientOptions = {},
): EvidenceDraftClient {
  return new EvidenceDraftClient(options)
}

/** Alias retained for callers that name the HTTP transport explicitly. */
export const createEvidenceDraftHttpClient = createEvidenceDraftClient
