import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SubmissionAssetsApiError,
  createSubmissionAssetsApi,
  type SubmissionAssetsApiSession,
} from './submissionAssetsApi'

const draftId = '11111111-1111-4111-8111-111111111111'
const mediaId = '22222222-2222-4222-8222-222222222222'
const referenceId = '33333333-3333-4333-8333-333333333333'
const evidenceId = '44444444-4444-4444-8444-444444444444'
const session: SubmissionAssetsApiSession = { csrf_token: 'csrf-token-for-assets-tests' }

const mediaBase = {
  media_resource_id: mediaId,
  declared_mime: 'image/png',
  detected_mime: 'image/png',
  byte_size: 1_048_576,
  width: null,
  height: null,
  duration_ms: null,
  checksum_sha256: '0a69c09f7c1eca87a0a6fb108e3aeb1929a2e4bb732a021612730325fd5875b2',
  source: 'upload' as const,
  scan_result: 'not_scanned' as const,
  rejection_reason_code: null,
  scan_attempt_count: 0,
  next_scan_at: null,
  exif_removed: false,
  deletion_guard_active: false,
  version: 1,
  created_at: '2026-08-26T10:00:00.000Z',
  updated_at: '2026-08-26T10:00:00.000Z',
}

const reference = {
  media_reference_id: referenceId,
  media_resource_id: mediaId,
  target_type: 'submission_draft' as const,
  target_id: draftId,
  role: 'cover',
  alt_text: '提交作品封面',
  sort_order: 0,
  crop_focus: null,
  variant: null,
  source_media_reference_id: null,
  version: 1,
  created_at: '2026-08-26T10:00:00.000Z',
  updated_at: '2026-08-26T10:00:00.000Z',
}

const evidenceDraft = {
  evidence_draft_id: evidenceId,
  collector_actor_type: 'user' as const,
  parent_type: 'submission_draft' as const,
  parent_id: draftId,
  final_target_kind: 'project' as const,
  target_asset_draft_key: null,
  evidence_type: 'trusted_external_source' as const,
  source_channel: 'official_site' as const,
  field_path: '/project_core/current_name',
  requested_visibility: 'reviewer_only' as const,
  source_url: 'https://example.test/source',
  text_excerpt: null,
  attachment_drafts: [],
  status: 'ready' as const,
  bound: true,
  source_hash: 'b'.repeat(64),
  final_field_preview: {
    source_summary: '公开来源',
    captured_at: '2026-08-26T10:00:00.000Z',
    collected_by: 'user' as const,
    confidence: 'medium' as const,
    source_channel: 'official_site' as const,
  },
  completed_at: '2026-08-26T10:00:00.000Z',
  promoted_evidence_id: null,
  version: 3,
  created_at: '2026-08-26T10:00:00.000Z',
  updated_at: '2026-08-26T10:00:00.000Z',
}

const binding = {
  parent_type: 'submission_draft' as const,
  parent_id: draftId,
  evidence_draft_ids: [evidenceId],
  parent_version: 8,
  evidence_draft_version: 2,
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'server-request-01', ...headers },
  })
}

function errorBody(code: string) {
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: 'server-request-error',
      retryable: false,
      retry_after_ms: null,
      details: {
        field_errors: [{ path: '/source_url', code: 'required' }],
        preserved: 'do-not-drop',
        conflict: { current_version: 9 },
      },
    },
  }
}

function pngFile(size = 1_048_576) {
  return new File([new Uint8Array(size)], 'cover.png', { type: 'image/png' })
}

function apiWithResponses(responses: Response[]) {
  const apiFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    void input
    void init
    const response = responses.shift()
    if (response === undefined) throw new Error('unexpected API request')
    return response
  })
  const uploadFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    void input
    void init
    return new Response(null, {
    status: 200,
    headers: { etag: '"upload-receipt-01"' },
    })
  })
  const api = createSubmissionAssetsApi({
    baseUrl: 'https://api.example.test',
    fetch: apiFetch,
    uploadFetch,
    getCsrfToken: () => session.csrf_token,
    requestIdGenerator: () => 'request-id-01',
  })
  return { api, apiFetch, uploadFetch }
}

afterEach(() => vi.restoreAllMocks())

describe('submissionAssetsApi production gateway', () => {
  it('rejects unsupported MIME and size before hashing or fetching', async () => {
    const { api, apiFetch, uploadFetch } = apiWithResponses([])

    await expect(api.uploadCover({
      draftId,
      file: new File([new Uint8Array(1_048_576)], 'cover.gif', { type: 'image/gif' }),
      session,
    })).rejects.toThrow(TypeError)
    await expect(api.uploadCover({ draftId, file: pngFile(1_048_575), session })).rejects.toThrow(TypeError)
    await expect(api.uploadCover({ draftId, file: pngFile(5_242_881), session })).rejects.toThrow(TypeError)
    expect(apiFetch).not.toHaveBeenCalled()
    expect(uploadFetch).not.toHaveBeenCalled()
  })

  it('hashes, prepares, uploads with credentials omitted, then completes as pending', async () => {
    const prepared = {
      media: { ...mediaBase, status: 'uploading' as const },
      upload_url: 'https://uploads.example.test/object',
      upload_headers: { 'content-type': 'image/png', 'x-amz-checksum-sha256': 'signed-value' },
      upload_expires_at: '2026-08-26T10:30:00.000Z',
    }
    const completed = { media: { ...mediaBase, status: 'processing' as const }, scan_queued: true as const }
    const { api, apiFetch, uploadFetch } = apiWithResponses([
      jsonResponse(prepared, 201),
      jsonResponse(completed, 202),
    ])

    const result = await api.uploadCover({
      draftId,
      file: pngFile(),
      session,
      prepareIdempotencyKey: 'prepare-action-01',
      completeIdempotencyKey: 'complete-action-01',
    })

    expect(result.status).toBe('pending')
    expect(result.media.status).toBe('processing')
    expect(apiFetch).toHaveBeenCalledTimes(2)
    const prepareInit = apiFetch.mock.calls[0]?.[1] as RequestInit
    expect(prepareInit).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(prepareInit.headers).toMatchObject({
      'X-CSRF-Token': session.csrf_token,
      'Idempotency-Key': 'prepare-action-01',
    })
    expect(JSON.parse(String(prepareInit.body))).toMatchObject({
      purpose: 'project_cover',
      declared_mime: 'image/png',
      byte_size: 1_048_576,
      checksum_sha256: '0a69c09f7c1eca87a0a6fb108e3aeb1929a2e4bb732a021612730325fd5875b2',
    })
    const uploadInit = uploadFetch.mock.calls[0]?.[1] as RequestInit
    expect(uploadInit).toMatchObject({ method: 'PUT', credentials: 'omit' })
    expect(uploadInit.headers).toEqual(prepared.upload_headers)
    expect(uploadInit.headers).not.toHaveProperty('X-CSRF-Token')
    expect(uploadInit.headers).not.toHaveProperty('Cookie')
    expect(uploadInit.headers).not.toHaveProperty('Idempotency-Key')
    const completeInit = apiFetch.mock.calls[1]?.[1] as RequestInit
    expect(completeInit.headers).toMatchObject({
      'X-CSRF-Token': session.csrf_token,
      'Idempotency-Key': 'complete-action-01',
    })
    expect(JSON.parse(String(completeInit.body))).toMatchObject({
      checksum_sha256: '0a69c09f7c1eca87a0a6fb108e3aeb1929a2e4bb732a021612730325fd5875b2',
      upload_receipt: '"upload-receipt-01"',
    })
  })

  it('does not create a cover reference while media is processing', async () => {
    const { api, apiFetch } = apiWithResponses([
      jsonResponse({ ...mediaBase, status: 'processing' as const }, 200),
    ])

    await expect(api.createCoverReference({
      draftId,
      mediaResourceId: mediaId,
      altText: '提交作品封面',
      session,
    })).rejects.toMatchObject({ code: 'MEDIA_RESOURCE_NOT_READY', status: 409 })
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('creates the fixed cover reference only for ready clean sanitized media', async () => {
    const readyMedia = {
      ...mediaBase,
      status: 'ready' as const,
      scan_result: 'clean' as const,
      exif_removed: true,
      version: 4,
    }
    const { api, apiFetch } = apiWithResponses([
      jsonResponse(readyMedia, 200),
      jsonResponse(reference, 201),
    ])

    const result = await api.createCoverReference({
      draftId,
      mediaResourceId: mediaId,
      altText: '提交作品封面',
      session,
      referenceClientRequestId: 'cover-reference-action-01',
    })

    expect(result).toEqual(reference)
    expect(JSON.parse(String((apiFetch.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      media_resource_id: mediaId,
      target_type: 'submission_draft',
      target_id: draftId,
      role: 'cover',
      alt_text: '提交作品封面',
      sort_order: 0,
      crop_focus: null,
      variant: null,
      client_request_id: 'cover-reference-action-01',
    })
  })

  it('executes evidence create, bind, patch, complete with server-returned versions', async () => {
    const { api, apiFetch } = apiWithResponses([
      jsonResponse({ ...evidenceDraft, status: 'editing' as const, bound: false, version: 1, source_url: null }, 201),
      jsonResponse(binding, 200),
      jsonResponse({ ...evidenceDraft, status: 'editing' as const, bound: true, version: 3, source_url: 'https://example.test/source' }, 200),
      jsonResponse(evidenceDraft, 200),
    ])

    const result = await api.createEvidence({
      parentId: draftId,
      parentVersion: 7,
      finalTargetKind: 'project',
      fieldPath: '/project_core/current_name',
      requestedVisibility: 'reviewer_only',
      evidenceType: 'trusted_external_source',
      sourceChannel: 'official_site',
      sourceUrl: 'https://example.test/source',
      session,
      createClientRequestId: 'evidence-create-action-01',
      bindOperationId: 'evidence-bind-action-01',
      patchOperationId: 'evidence-patch-action-01',
      completeOperationId: 'evidence-complete-action-01',
    })

    expect(result.status).toBe('ready')
    expect(result.evidence).toEqual(evidenceDraft)
    expect(apiFetch).toHaveBeenCalledTimes(4)
    const bindBody = JSON.parse(String((apiFetch.mock.calls[1]?.[1] as RequestInit).body))
    const patchBody = JSON.parse(String((apiFetch.mock.calls[2]?.[1] as RequestInit).body))
    const completeBody = JSON.parse(String((apiFetch.mock.calls[3]?.[1] as RequestInit).body))
    expect(bindBody.expected_parent_version).toBe(7)
    expect(bindBody.operation_id).toBe('evidence-bind-action-01')
    expect(patchBody.expected_version).toBe(binding.evidence_draft_version)
    expect(patchBody.source_url).toBe('https://example.test/source')
    expect(patchBody.text_excerpt).toBeNull()
    expect(patchBody.operation_id).toBeUndefined()
    expect(completeBody.expected_version).toBe(3)
    expect(completeBody.operation_id).toBe('evidence-complete-action-01')
  })

  it('preserves a server 422 when evidence has no source', async () => {
    const { api, apiFetch } = apiWithResponses([
      jsonResponse({ ...evidenceDraft, status: 'editing' as const, bound: false, version: 1, source_url: null }, 201),
      jsonResponse(binding, 200),
      jsonResponse({ ...evidenceDraft, status: 'editing' as const, bound: true, version: 3, source_url: null, text_excerpt: null }, 200),
      jsonResponse(errorBody('EVIDENCE_SOURCE_REQUIRED'), 422),
    ])

    const thrown = await api.createEvidence({
      parentId: draftId,
      parentVersion: 7,
      finalTargetKind: 'project',
      fieldPath: '/project_core/current_name',
      requestedVisibility: 'reviewer_only',
      evidenceType: 'trusted_external_source',
      sourceChannel: 'official_site',
      session,
      createClientRequestId: 'evidence-create-no-source-01',
      bindOperationId: 'evidence-bind-no-source-01',
      patchOperationId: 'evidence-patch-no-source-01',
      completeOperationId: 'evidence-complete-no-source-01',
    }).catch((error: unknown) => {
      if (!(error instanceof SubmissionAssetsApiError)) throw error
      return error
    }) as SubmissionAssetsApiError

    expect(thrown).toBeInstanceOf(SubmissionAssetsApiError)
    expect(thrown).toMatchObject({ kind: 'http', status: 422, code: 'EVIDENCE_SOURCE_REQUIRED' })
    expect(thrown.details).toMatchObject({ preserved: 'do-not-drop' })
    expect(apiFetch).toHaveBeenCalledTimes(4)
  })
})
