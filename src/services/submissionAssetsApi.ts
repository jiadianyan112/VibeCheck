import {
  createEvidenceDraftClient,
  createMediaClient,
  type EvidenceDraft,
  type EvidenceDraftBindRequest,
  type EvidenceDraftCreateRequest,
  type EvidenceDraftPatchRequest,
  type EvidenceBinding,
  type MediaReference,
  type MediaResource,
} from '@vibecheck/contracts'
import type { AuthSessionDto } from './authService'

export type SubmissionAssetsApiSession = Pick<AuthSessionDto, 'csrf_token'>
export type SubmissionAssetReadiness = 'pending' | 'terminal' | 'ready'
export type SubmissionAssetsApiErrorKind = 'aborted' | 'transport' | 'protocol' | 'http'

export interface SubmissionAssetsApiRequestOptions {
  readonly session: SubmissionAssetsApiSession | null
  readonly signal?: AbortSignal
}

export interface SubmissionAssetsApiOptions {
  readonly fetch?: SubmissionAssetsFetch
  readonly uploadFetch?: SubmissionAssetsFetch
  readonly baseUrl?: string | URL
  readonly getCsrfToken?: () => string | Promise<string>
  readonly requestIdGenerator?: () => string
}

export interface SubmissionAssetsFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>
}

export interface SubmissionAssetReadinessResult {
  readonly status: SubmissionAssetReadiness
  readonly state: SubmissionAssetReadiness
  readonly phase: SubmissionAssetReadiness
  readonly media: MediaResource
}

export interface SubmissionAssetUploadInput extends SubmissionAssetsApiRequestOptions {
  readonly draftId: string
  readonly file: Blob
  readonly prepareIdempotencyKey?: string
  readonly completeIdempotencyKey?: string
}

export interface SubmissionAssetUploadResult extends SubmissionAssetReadinessResult {
  readonly checksumSha256: string
}

export interface SubmissionCoverReferenceInput extends SubmissionAssetsApiRequestOptions {
  readonly draftId: string
  readonly mediaResourceId: string
  readonly altText: string
  readonly referenceClientRequestId?: string
  readonly existingCoverReferenceIds?: readonly string[]
  readonly replacementOperationId?: (mediaReferenceId: string) => string
}

export interface SubmissionCoverReferenceResult extends SubmissionAssetReadinessResult {
  readonly reference?: MediaReference
}

export interface SubmissionEvidenceInput extends SubmissionAssetsApiRequestOptions {
  readonly parentId: string
  readonly parentVersion: number
  readonly finalTargetKind: EvidenceDraftCreateRequest['final_target_kind']
  readonly targetAssetDraftKey?: string | null
  readonly fieldPath?: string | null
  readonly requestedVisibility: EvidenceDraftCreateRequest['requested_visibility']
  readonly evidenceType: EvidenceDraftCreateRequest['evidence_type']
  readonly sourceChannel: EvidenceDraftCreateRequest['source_channel']
  readonly sourceUrl?: string | null
  readonly textExcerpt?: string | null
  readonly internalRecordRef?: string | null
  readonly createClientRequestId?: string
  readonly bindOperationId?: string
  readonly patchOperationId?: string
  readonly completeOperationId?: string
}

export interface SubmissionEvidenceResult {
  readonly status: SubmissionAssetReadiness
  readonly state: SubmissionAssetReadiness
  readonly phase: SubmissionAssetReadiness
  readonly evidence: EvidenceDraft
}

export interface SubmissionAssetsApiErrorOptions {
  readonly kind: SubmissionAssetsApiErrorKind
  readonly code: string
  readonly message: string
  readonly messageKey?: string | null
  readonly status: number | null
  readonly requestId: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly fieldErrors?: readonly unknown[]
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

export class SubmissionAssetsApiError extends Error {
  readonly name = 'SubmissionAssetsApiError'
  readonly kind: SubmissionAssetsApiErrorKind
  readonly type: SubmissionAssetsApiErrorKind
  readonly status: number | null
  readonly code: string
  readonly messageKey: string | null
  readonly message_key: string | null
  readonly requestId: string | null
  readonly request_id: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly retry_after_ms: number | null
  readonly fieldErrors: readonly unknown[]
  readonly field_errors: readonly unknown[]
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(options: SubmissionAssetsApiErrorOptions) {
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

const minimumFileSize = 1_048_576
const maximumFileSize = 5_242_880
const supportedImageMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return true
  if (isRecord(error) && error.name === 'AbortError') return true
  const cause = isRecord(error) ? error.cause : undefined
  return typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'AbortError'
}

function isUuid(value: string): boolean {
  return uuidPattern.test(value)
}

function generatedId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function requireRequestId(value: string | undefined, label: string): string {
  const id = value ?? generatedId()
  if (!requestIdPattern.test(id)) throw new TypeError(`${label} must be a contract-compatible request id`)
  return id
}

function requireDraftId(value: string): string {
  if (!isUuid(value)) throw new TypeError('draftId must be a UUID')
  return value
}

function requireFile(file: Blob): { readonly mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'; readonly size: number } {
  const blobConstructor = globalThis.Blob
  const hasArrayBuffer = isRecord(file) && typeof file.arrayBuffer === 'function'
  const isBlob = blobConstructor !== undefined && file instanceof blobConstructor
  if (!isRecord(file) || (!isBlob && !hasArrayBuffer) || typeof file.size !== 'number' || typeof file.type !== 'string') {
    throw new TypeError('file must be a Blob or File')
  }
  const mime = file.type.toLowerCase()
  if (!supportedImageMimes.has(mime)) throw new TypeError('file MIME must be JPEG, PNG, WebP or AVIF')
  if (!Number.isSafeInteger(file.size) || file.size < minimumFileSize || file.size > maximumFileSize) {
    throw new TypeError('file size must be between 1 MiB and 5 MiB')
  }
  return { mime: mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif', size: file.size }
}

async function readFileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Response(file).arrayBuffer()
}

function hexDigest(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(file: Blob): Promise<string> {
  try {
    return hexDigest(await globalThis.crypto.subtle.digest('SHA-256', await readFileBytes(file)))
  } catch (cause) {
    throw new SubmissionAssetsApiError({
      kind: 'transport',
      code: 'ASSET_HASH_FAILED',
      message: '无法计算上传文件摘要。',
      status: null,
      requestId: null,
      retryable: true,
      retryAfterMs: null,
      cause,
    })
  }
}

function safeSourceUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value.length > 2_048 || value.trim() !== value || Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 32 || codePoint === 127
  })) throw new TypeError('sourceUrl is invalid')
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new TypeError('sourceUrl must be an absolute URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) {
    throw new TypeError('sourceUrl must be a public http(s) URL')
  }
  parsed.hash = ''
  if (parsed.toString().length > 2_048) throw new TypeError('sourceUrl is too long')
  return parsed.toString()
}

function readiness(media: MediaResource): SubmissionAssetReadinessResult {
  const ready = media.status === 'ready' &&
    media.scan_result === 'clean' &&
    media.exif_removed === true &&
    media.deletion_guard_active === false
  const terminal = media.status === 'rejected' ||
    media.status === 'deleted' ||
    media.scan_result === 'malicious' ||
    media.scan_result === 'unscannable' ||
    (media.status === 'ready' && !ready)
  const status: SubmissionAssetReadiness = ready ? 'ready' : terminal ? 'terminal' : 'pending'
  return { status, state: status, phase: status, media }
}

function evidenceReadiness(evidence: EvidenceDraft): SubmissionEvidenceResult {
  const status: SubmissionAssetReadiness = evidence.status === 'ready'
    ? 'ready'
    : evidence.status === 'withdrawn' || evidence.status === 'promoted' || evidence.status === 'expired'
      ? 'terminal'
      : 'pending'
  return { status, state: status, phase: status, evidence }
}

function errorFromTypedClient(error: unknown, signal?: AbortSignal): SubmissionAssetsApiError | null {
  const cause = isRecord(error) ? error.cause : undefined
  const aborted = isAbortError(error, signal) || isAbortError(cause)
  if (!isRecord(error) ||
      (error.kind !== 'transport' && error.kind !== 'protocol' && error.kind !== 'http') ||
      typeof error.code !== 'string') return null
  const kind: SubmissionAssetsApiErrorKind = aborted ? 'aborted' : error.kind
  const status = kind === 'aborted' ? null : typeof error.status === 'number' ? error.status : null
  const requestId = typeof error.requestId === 'string' ? error.requestId : typeof error.request_id === 'string' ? error.request_id : null
  const retryable = kind === 'aborted' ? false : error.retryable === true
  const retryAfterMs = kind === 'aborted' ? null : typeof error.retryAfterMs === 'number'
    ? error.retryAfterMs
    : typeof error.retry_after_ms === 'number' ? error.retry_after_ms : null
  const fieldErrors = Array.isArray(error.fieldErrors)
    ? error.fieldErrors
    : Array.isArray(error.field_errors) ? error.field_errors : []
  const details = isRecord(error.details) ? error.details : undefined
  const messageKey = typeof error.messageKey === 'string'
    ? error.messageKey
    : typeof error.message_key === 'string' ? error.message_key : null
  const message = typeof error.message === 'string' ? error.message : '请求失败。'
  return new SubmissionAssetsApiError({
    kind,
    code: kind === 'aborted' ? 'REQUEST_ABORTED' : error.code,
    message: kind === 'aborted' ? '请求已取消，当前内容已保留。' : message,
    messageKey: kind === 'aborted' ? 'error.request_aborted' : messageKey,
    status,
    requestId,
    retryable,
    retryAfterMs,
    fieldErrors,
    ...(details === undefined ? {} : { details }),
    cause: error,
  })
}

function mapError(error: unknown, signal?: AbortSignal): SubmissionAssetsApiError {
  if (error instanceof SubmissionAssetsApiError) return error
  return errorFromTypedClient(error, signal) ?? new SubmissionAssetsApiError({
    kind: isAbortError(error, signal) ? 'aborted' : 'transport',
    code: isAbortError(error, signal) ? 'REQUEST_ABORTED' : 'CLIENT_REQUEST_FAILED',
    message: isAbortError(error, signal) ? '请求已取消，当前内容已保留。' : '网络连接不可用，当前内容已保留。',
    status: null,
    requestId: null,
    retryable: !isAbortError(error, signal),
    retryAfterMs: null,
    cause: error,
  })
}

function mapGatewayError(error: unknown, signal?: AbortSignal): SubmissionAssetsApiError | TypeError {
  if (error instanceof TypeError) return error
  return mapError(error, signal)
}

function protocolFailure(message: string, cause?: unknown): SubmissionAssetsApiError {
  return new SubmissionAssetsApiError({
    kind: 'protocol',
    code: 'PROTOCOL_INVALID_RESPONSE',
    message,
    messageKey: null,
    status: null,
    requestId: null,
    retryable: false,
    retryAfterMs: null,
    cause,
  })
}

async function putSignedUpload(
  fetchUpload: SubmissionAssetsFetch,
  input: { readonly uploadUrl: string; readonly uploadHeaders: Readonly<Record<string, string>>; readonly file: Blob; readonly signal?: AbortSignal },
): Promise<string> {
  let url: URL
  try {
    url = new URL(input.uploadUrl)
  } catch (cause) {
    throw new SubmissionAssetsApiError({
      kind: 'protocol', code: 'PROTOCOL_INVALID_RESPONSE', message: '服务端返回了无效的签名上传地址。',
      status: null, requestId: null, retryable: false, retryAfterMs: null, cause,
    })
  }
  if (url.protocol !== 'https:' || Object.keys(input.uploadHeaders).some((key) => key.toLowerCase() === 'cookie')) {
    throw new SubmissionAssetsApiError({
      kind: 'protocol', code: 'PROTOCOL_INVALID_RESPONSE', message: '服务端返回了不安全的签名上传指令。',
      status: null, requestId: null, retryable: false, retryAfterMs: null,
    })
  }
  let response: Response
  try {
    response = await fetchUpload(url.toString(), {
      method: 'PUT',
      credentials: 'omit',
      headers: input.uploadHeaders,
      body: input.file,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch (cause) {
    throw mapError(cause, input.signal)
  }
  if (response.status !== 200) {
    throw new SubmissionAssetsApiError({
      kind: 'http',
      code: 'MEDIA_SIGNED_UPLOAD_FAILED',
      message: '签名上传未完成。',
      status: response.status,
      requestId: null,
      retryable: response.status >= 500,
      retryAfterMs: null,
    })
  }
  const receipt = response.headers.get('etag')?.trim()
  if (!receipt || receipt.length > 4_096) {
    throw new SubmissionAssetsApiError({
      kind: 'protocol', code: 'PROTOCOL_INVALID_RESPONSE', message: '签名上传缺少有效回执。',
      status: response.status, requestId: null, retryable: false, retryAfterMs: null,
    })
  }
  return receipt
}

function makeMediaClient(options: SubmissionAssetsApiOptions, session: SubmissionAssetsApiSession | null) {
  return createMediaClient({
    fetch: options.fetch,
    baseUrl: options.baseUrl,
    getCsrfToken: () => session?.csrf_token ?? options.getCsrfToken?.() ?? '',
    requestIdGenerator: options.requestIdGenerator,
  })
}

function makeEvidenceClient(options: SubmissionAssetsApiOptions, session: SubmissionAssetsApiSession | null) {
  return createEvidenceDraftClient({
    fetch: options.fetch,
    baseUrl: options.baseUrl,
    getCsrfToken: () => session?.csrf_token ?? options.getCsrfToken?.() ?? '',
    requestIdGenerator: options.requestIdGenerator,
  })
}

export interface SubmissionAssetsApi {
  uploadCover(input: SubmissionAssetUploadInput): Promise<SubmissionAssetUploadResult>
  getMediaStatus(input: { readonly mediaResourceId: string } & SubmissionAssetsApiRequestOptions): Promise<SubmissionAssetReadinessResult>
  ensureCoverReference(input: SubmissionCoverReferenceInput): Promise<SubmissionCoverReferenceResult>
  createCoverReference(input: SubmissionCoverReferenceInput): Promise<MediaReference>
  createEvidence(input: SubmissionEvidenceInput): Promise<SubmissionEvidenceResult>
}

export function createSubmissionAssetsApi(options: SubmissionAssetsApiOptions = {}): SubmissionAssetsApi {
  const resolveApiFetch = () => options.fetch ?? globalThis.fetch.bind(globalThis)
  const resolveUploadFetch = () => options.uploadFetch ?? globalThis.fetch.bind(globalThis)

  return {
    async uploadCover(input) {
      try {
        requireDraftId(input.draftId)
        const file = requireFile(input.file)
        const checksumSha256 = await sha256(input.file)
        const prepareIdempotencyKey = requireRequestId(input.prepareIdempotencyKey, 'prepareIdempotencyKey')
        const completeIdempotencyKey = requireRequestId(input.completeIdempotencyKey, 'completeIdempotencyKey')
        const client = makeMediaClient({ ...options, fetch: resolveApiFetch() }, input.session)
        const prepared = await client.prepare({
          purpose: 'project_cover',
          declared_mime: file.mime,
          byte_size: file.size,
          checksum_sha256: checksumSha256,
        }, { idempotencyKey: prepareIdempotencyKey, signal: input.signal })
        if (prepared.media.checksum_sha256 !== checksumSha256 ||
            prepared.media.declared_mime !== file.mime || prepared.media.byte_size !== file.size) {
          throw protocolFailure('服务端返回的媒体资源与本次上传不匹配。')
        }
        const uploadReceipt = await putSignedUpload(resolveUploadFetch(), {
          uploadUrl: prepared.upload_url,
          uploadHeaders: prepared.upload_headers,
          file: input.file,
          signal: input.signal,
        })
        const completed = await client.complete(prepared.media.media_resource_id, {
          checksum_sha256: checksumSha256,
          upload_receipt: uploadReceipt,
        }, { idempotencyKey: completeIdempotencyKey, signal: input.signal })
        if (completed.media.media_resource_id !== prepared.media.media_resource_id ||
            completed.media.checksum_sha256 !== checksumSha256) {
          throw protocolFailure('服务端返回的完成媒体资源与本次上传不匹配。')
        }
        return { ...readiness(completed.media), checksumSha256 }
      } catch (error) {
        throw mapGatewayError(error, input.signal)
      }
    },

    async getMediaStatus(input) {
      try {
        const client = makeMediaClient({ ...options, fetch: resolveApiFetch() }, input.session)
        const media = await client.get(input.mediaResourceId, { signal: input.signal })
        if (media.media_resource_id !== input.mediaResourceId) {
          throw protocolFailure('服务端返回了与请求不同的媒体资源。')
        }
        return readiness(media)
      } catch (error) {
        throw mapGatewayError(error, input.signal)
      }
    },

    async ensureCoverReference(input) {
      try {
        requireDraftId(input.draftId)
        const client = makeMediaClient({ ...options, fetch: resolveApiFetch() }, input.session)
        const media = await client.get(input.mediaResourceId, { signal: input.signal })
        if (media.media_resource_id !== input.mediaResourceId) {
          throw protocolFailure('服务端返回了与请求不同的媒体资源。')
        }
        const status = readiness(media)
        if (status.status !== 'ready') return status
        if ((input.existingCoverReferenceIds?.length ?? 0) > 0) {
          if (input.replacementOperationId === undefined) throw new TypeError('replacementOperationId is required for cover replacement')
          const existing = await client.listReferences({
            target_type: 'submission_draft',
            target_id: input.draftId,
            role: 'cover',
          }, { signal: input.signal })
          const expectedIds = new Set(input.existingCoverReferenceIds)
          for (const reference of existing.items) {
            if (!expectedIds.has(reference.media_reference_id)) continue
            if (reference.media_resource_id === media.media_resource_id) return { ...status, reference }
            await client.deleteReference(reference.media_reference_id, {
              expected_version: reference.version,
              operation_id: requireRequestId(input.replacementOperationId(reference.media_reference_id), 'replacementOperationId'),
            }, { signal: input.signal })
          }
        }
        const reference = await client.createReference({
          media_resource_id: media.media_resource_id,
          target_type: 'submission_draft',
          target_id: input.draftId,
          role: 'cover',
          alt_text: input.altText,
          sort_order: 0,
          crop_focus: null,
          variant: null,
          client_request_id: requireRequestId(input.referenceClientRequestId, 'referenceClientRequestId'),
        }, { signal: input.signal })
        if (reference.media_resource_id !== media.media_resource_id ||
            reference.target_type !== 'submission_draft' || reference.target_id !== input.draftId ||
            reference.role !== 'cover' || reference.sort_order !== 0 ||
            reference.alt_text !== input.altText || reference.crop_focus !== null || reference.variant !== null) {
          throw protocolFailure('服务端返回了与封面引用请求不匹配的引用。')
        }
        return { ...status, reference }
      } catch (error) {
        throw mapGatewayError(error, input.signal)
      }
    },

    async createCoverReference(input) {
      const result = await this.ensureCoverReference(input)
      if (result.status === 'ready' && result.reference !== undefined) return result.reference
      const terminal = result.status === 'terminal'
      throw new SubmissionAssetsApiError({
        kind: 'http',
        code: terminal ? 'MEDIA_RESOURCE_TERMINAL' : 'MEDIA_RESOURCE_NOT_READY',
        message: terminal ? '媒体未通过安全检查，不能创建封面引用。' : '媒体仍在安全处理中，不能创建封面引用。',
        status: terminal ? 422 : 409,
        requestId: null,
        retryable: !terminal,
        retryAfterMs: null,
      })
    },

    async createEvidence(input) {
      try {
        const parentId = requireDraftId(input.parentId)
        if (!Number.isSafeInteger(input.parentVersion) || input.parentVersion < 1) throw new TypeError('parentVersion must be a positive integer')
        const sourceUrl = safeSourceUrl(input.sourceUrl)
        const client = makeEvidenceClient({ ...options, fetch: resolveApiFetch() }, input.session)
        const createClientRequestId = requireRequestId(input.createClientRequestId, 'createClientRequestId')
        const bindOperationId = requireRequestId(input.bindOperationId, 'bindOperationId')
        const patchOperationId = requireRequestId(input.patchOperationId, 'patchOperationId')
        const completeOperationId = requireRequestId(input.completeOperationId, 'completeOperationId')
        const created = await client.create({
          parent_type: 'submission_draft',
          parent_id: parentId,
          final_target_kind: input.finalTargetKind,
          target_asset_draft_key: input.targetAssetDraftKey ?? null,
          field_path: input.fieldPath ?? null,
          requested_visibility: input.requestedVisibility,
          evidence_type: input.evidenceType,
          source_channel: input.sourceChannel,
          client_request_id: createClientRequestId,
        }, { signal: input.signal })
        if (created.evidence_draft_id.length === 0 || created.parent_type !== 'submission_draft' ||
            created.parent_id !== parentId) {
          throw protocolFailure('服务端返回了与证据创建请求不匹配的草稿。')
        }
        const bindingRequest: EvidenceDraftBindRequest = {
          parent_type: 'submission_draft',
          parent_id: parentId,
          expected_parent_version: input.parentVersion,
          operation_id: bindOperationId,
        }
        const bound: EvidenceBinding = await client.bind(created.evidence_draft_id, bindingRequest, { signal: input.signal })
        if (bound.parent_type !== 'submission_draft' || bound.parent_id !== parentId ||
            !bound.evidence_draft_ids.includes(created.evidence_draft_id)) {
          throw protocolFailure('服务端返回了与证据绑定请求不匹配的绑定。')
        }
        const patchRequest: EvidenceDraftPatchRequest = {
          expected_version: bound.evidence_draft_version,
          source_url: sourceUrl,
          internal_record_ref: input.internalRecordRef ?? null,
          text_excerpt: input.textExcerpt ?? null,
          field_path: input.fieldPath ?? null,
          requested_visibility: input.requestedVisibility,
        }
        const patched = await client.patch(created.evidence_draft_id, patchRequest, {
          idempotencyKey: patchOperationId,
          signal: input.signal,
        })
        if (patched.evidence_draft_id !== created.evidence_draft_id || patched.bound !== true) {
          throw protocolFailure('服务端返回了与证据补丁请求不匹配的草稿。')
        }
        const completed = await client.complete(created.evidence_draft_id, {
          expected_version: patched.version,
          operation_id: completeOperationId,
        }, { signal: input.signal })
        if (completed.evidence_draft_id !== created.evidence_draft_id) {
          throw protocolFailure('服务端返回了与证据完成请求不匹配的草稿。')
        }
        return evidenceReadiness(completed)
      } catch (error) {
        throw mapGatewayError(error, input.signal)
      }
    },
  }
}

export const submissionAssetsApi = createSubmissionAssetsApi()
