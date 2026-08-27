import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubmissionDraft as ContractSubmissionDraft, SubmissionUrlCheck } from '@vibecheck/contracts'
import {
  editableFieldsToPatch,
  makeSubmissionClientRequestId,
  remoteDraftToLocalDraft,
  SubmissionApiError,
  submissionApi,
  type RemoteSubmissionDraft,
} from './submissionApi'
import { submissionDraftId, userId } from '../types'

const checkId = '11111111-1111-4111-8111-111111111111'
const draftId = '22222222-2222-4222-8222-222222222222'
const chainId = '33333333-3333-4333-8333-333333333333'
const csrf = { csrf_token: 'csrf-token-for-submission-tests' }

const checkProjection: SubmissionUrlCheck = {
  check_id: checkId,
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  input_hash: 'a'.repeat(64),
  canonical_url: 'https://example.test/learning',
  redirect_chain: ['https://example.test/learning'],
  risk_result: 'allowed',
  access_result: 'accessible',
  category_result: 'matched',
  duplicate_result: 'none',
  duplicate_candidates: [],
  risk_reasons: [],
  can_create_draft: true,
  checked_at: '2026-08-25T10:00:00.000Z',
  expires_at: '2026-08-25T10:30:00.000Z',
}

const draftProjection: ContractSubmissionDraft = {
  draft_id: draftId,
  submission_chain_id: chainId,
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  check_id: checkId,
  draft_revision: 1,
  supersedes_draft_id: null,
  base_submission_id: null,
  payload_snapshot: {
    project_core: {
      public_url: 'https://example.test/learning',
      category_id: 'ai_learning_quiz',
      category_schema_version: 'learning.v1',
      category_data: {
        current_name: '服务端名称',
        one_line_definition: '服务端定义',
        core_flow: [{ order: 1, name: '上传材料' }],
        server_only: { keep: true },
      },
      server_only_core: 'keep-me',
    },
    unknown_top_level: { preserve: true },
  },
  media_reference_ids: [],
  evidence_draft_ids: [],
  asset_drafts: [],
  status: 'editing',
  version: 3,
  created_at: '2026-08-25T10:00:00.000Z',
  updated_at: '2026-08-25T10:05:00.000Z',
  saved_at: '2026-08-25T10:05:00.000Z',
  expires_at: '2026-08-25T10:35:00.000Z',
}

const previewProjection = {
  draft_id: draftId,
  draft_version: 8,
  check_id: checkId,
  preview_hash: 'b'.repeat(64),
  payload_snapshot: {
    project_core: {
      current_name: '服务端名称',
      public_url: 'https://example.test/learning',
      repository_url: null,
      original_platform: null,
      cover_media_reference_ids: ['55555555-5555-4555-8555-555555555555'],
      one_line_definition: '服务端定义',
      ai_coding_tools: { knowledge_state: 'unknown', values: [], source_type: 'system_inference', observed_at: '2026-08-25T10:00:00.000Z' },
      tech_stack: [],
      deployment_platform: null,
      access_status: 'normal',
      maintenance_signal: 'unknown',
      status_note: null,
    },
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    category_data: {
      target_users: ['university_students'],
      core_problem: '服务端问题',
      use_scenarios: ['question_generation'],
      main_inputs: ['pdf'],
      main_outputs: ['questions'],
      core_flow: [{ order: 1, name: '上传材料' }],
      content_processing: [],
      practice_formats: [],
      feedback_methods: [],
      learning_records: [],
      differentiation: null,
      core_features: [],
      secondary_features: [],
      login_requirement: 'unknown',
      sharing_capability: 'unknown',
    },
  },
  media_reference_ids: ['55555555-5555-4555-8555-555555555555'],
  evidence_draft_ids: ['66666666-6666-4666-8666-666666666666'],
  validation: { valid: true, issue_count: 0 },
  generated_at: '2026-08-25T10:00:00.000Z',
} as const

const submissionProjection = {
  submission_id: '77777777-7777-4777-8777-777777777777',
  submission_chain_id: chainId,
  draft_id: draftId,
  snapshot_version: 8,
  review_status: 'pending_review',
  review_work_item_id: '88888888-8888-4888-8888-888888888888',
  media_reference_ids: previewProjection.media_reference_ids,
  evidence_draft_ids: previewProjection.evidence_draft_ids,
  preview_hash: previewProjection.preview_hash,
  version: 1,
  created_at: '2026-08-25T10:00:00.000Z',
  updated_at: '2026-08-25T10:00:00.000Z',
} as const

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'server-request-01' },
  })
}

function errorBody(code: string, fieldErrors: readonly unknown[] = [{ path: '/patch/current_name', code: 'invalid' }]) {
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: 'server-request-01',
      retryable: code === 'UPSTREAM_UNAVAILABLE',
      retry_after_ms: code === 'UPSTREAM_UNAVAILABLE' ? 1500 : null,
      field_errors: fieldErrors,
      details: { conflict: { current_version: 4 }, preserved: 'do-not-drop' },
    },
  }
}

function installFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    void input
    void init
    return typeof response === 'function' ? response() : response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('submissionApi typed production gateway', () => {
  it('generates a contract-compatible client request id', () => {
    expect(makeSubmissionClientRequestId()).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
  })

  it('maps a successful URL check with credentials, CSRF and the caller request id', async () => {
    const fetchMock = installFetch(jsonResponse(checkProjection, 201))
    const result = await submissionApi.check({ rawUrl: 'example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: 'same-check-request-01' })
    expect(result).toMatchObject({ normalizedUrl: checkProjection.canonical_url, checkId, canCreateDraft: true, categorySchemaVersion: 'learning.v1' })
    expect(result.checks).toEqual([
      { key: 'format', status: 'passed', message: 'URL 格式有效。' },
      { key: 'safety', status: 'passed', message: '未发现明显安全风险。' },
      { key: 'access', status: 'passed', message: '公开页面可以访问。' },
      { key: 'duplicate', status: 'passed', message: '未发现重复档案。' },
      { key: 'category', status: 'passed', message: '品类匹配。' },
    ])
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('include')
    expect(init.signal).toBeUndefined()
    expect(init.headers).toMatchObject({ 'X-CSRF-Token': csrf.csrf_token })
    expect(JSON.parse(String(init.body))).toMatchObject({ raw_url: 'example.test/learning', client_request_id: 'same-check-request-01' })
  })

  it.each([
    ['blocked risk', { risk_result: 'blocked' as const }, 'safety', 'failed'],
    ['uncertain risk', { risk_result: 'uncertain' as const }, 'safety', 'warning'],
    ['unavailable access', { access_result: 'unavailable' as const }, 'access', 'failed'],
    ['not checked access', { access_result: 'not_checked' as const }, 'access', 'warning'],
    ['mismatched category', { category_result: 'mismatched' as const }, 'category', 'failed'],
    ['unconfirmed category', { category_result: 'unconfirmed' as const }, 'category', 'warning'],
    ['exact duplicate', { duplicate_result: 'exact' as const }, 'duplicate', 'warning'],
    ['candidate duplicate', { duplicate_result: 'candidate' as const }, 'duplicate', 'warning'],
  ])('maps the complete URL-check status matrix for %s', async (_label, change, key, expected) => {
    const changeRecord = change as Partial<SubmissionUrlCheck>
    const candidate = changeRecord.duplicate_result === 'exact' || changeRecord.duplicate_result === 'candidate'
      ? [{ project_id: '44444444-4444-4444-8444-444444444444', current_name: 'API 候选', category_id: 'ai_learning_quiz' as const, reason: 'canonical_url_exact' as const }]
      : []
    installFetch(jsonResponse({ ...checkProjection, ...changeRecord, duplicate_candidates: candidate, can_create_draft: true }, 201))
    const result = await submissionApi.check({ rawUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: `matrix-${String(key)}-01` })
    expect(result.checks.find((item) => item.key === key)?.status).toBe(expected)
    if (candidate.length) expect(result.duplicateCandidate).toMatchObject({ projectId: candidate[0]!.project_id, currentName: 'API 候选' })
  })

  it('does not infer create eligibility from warning or duplicate data', async () => {
    installFetch(jsonResponse({ ...checkProjection, duplicate_result: 'candidate', duplicate_candidates: [{ project_id: '44444444-4444-4444-8444-444444444444', current_name: 'API 候选', category_id: 'ai_learning_quiz', reason: 'canonical_url_exact' }], can_create_draft: false }, 201))
    const result = await submissionApi.check({ rawUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: 'eligibility-request-01' })
    expect(result.canCreateDraft).toBe(false)
    expect(result.duplicateCandidate?.currentName).toBe('API 候选')
  })

  it('reuses the same body client_request_id across a manual network retry', async () => {
    let calls = 0
    const fetchMock = installFetch(() => {
      calls += 1
      return calls === 1 ? jsonResponse(errorBody('UPSTREAM_UNAVAILABLE'), 503) : jsonResponse(checkProjection, 201)
    })
    await expect(submissionApi.check({ rawUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: 'retry-same-request-01' })).rejects.toBeInstanceOf(SubmissionApiError)
    await submissionApi.check({ rawUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: 'retry-same-request-01' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).client_request_id).toBe(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).client_request_id)
  })

  it('preserves status, code, request id, retry metadata, field errors and details', async () => {
    installFetch(jsonResponse(errorBody('UPSTREAM_UNAVAILABLE', [{ path: '/raw_url', code: 'invalid' }]), 503))
    const thrown = await submissionApi.check({ rawUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: 'error-fields-request-01' }).catch((error: unknown) => error as SubmissionApiError) as SubmissionApiError
    expect(thrown).toBeInstanceOf(SubmissionApiError)
    expect(thrown).toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE', requestId: 'server-request-01', request_id: 'server-request-01', retryable: true, retryAfterMs: 1500, retry_after_ms: 1500, fieldErrors: [{ path: '/raw_url', code: 'invalid' }] })
    expect(thrown.details).toMatchObject({ preserved: 'do-not-drop' })
  })

  it('maps AbortSignal cancellation to a non-retryable cancellation without a second fetch', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void input
      void init
      throw new DOMException('aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    controller.abort()
    const thrown = await submissionApi.check({ rawUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', session: csrf, signal: controller.signal, clientRequestId: 'abort-request-01' }).catch((error: unknown) => error as SubmissionApiError)
    expect(thrown).toMatchObject({ kind: 'aborted', code: 'REQUEST_ABORTED', retryable: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates a draft only with the typed check/category/request DTO and keeps the full response projection', async () => {
    const fetchMock = installFetch(jsonResponse(draftProjection, 201))
    const remote = await submissionApi.create({ checkId, categoryId: 'ai_learning_quiz', session: csrf, clientRequestId: 'create-request-01' })
    expect(remote).toMatchObject({ draft_id: draftId, check_id: checkId, version: 3, saved_at: draftProjection.saved_at, expires_at: draftProjection.expires_at })
    expect(remote.payload_snapshot.project_core).toMatchObject({ server_only_core: 'keep-me' })
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ check_id: checkId, category_id: 'ai_learning_quiz', client_request_id: 'create-request-01' })
  })

  it('GET restores a remote draft without adding CSRF or running a local extractor', async () => {
    const fetchMock = installFetch(jsonResponse(draftProjection, 200))
    const remote = await submissionApi.get({ draftId, session: csrf })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(remote.draft_id).toBe(draftId)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(init.headers).not.toHaveProperty('X-CSRF-Token')
    expect(init.body).toBeUndefined()
  })

  it('maps server payload identity, snake_case fields and preserves unknown fields', async () => {
    const apiRemote: RemoteSubmissionDraft = { ...draftProjection, fields: { currentName: '服务端名称', publicUrl: 'https://example.test/learning' }, originalExtraction: {} }
    const local = remoteDraftToLocalDraft(apiRemote, userId('user-mia'))
    expect(local).toMatchObject({ id: submissionDraftId(draftId), draftId: submissionDraftId(draftId), checkId, version: 3, schemaVersion: 'learning.v1', savedAt: draftProjection.saved_at, expiresAt: draftProjection.expires_at, remoteStatus: 'editing' })
    expect(local.fields).toMatchObject({ publicUrl: 'https://example.test/learning', categoryId: 'ai_learning_quiz', currentName: '服务端名称', oneLineDefinition: '服务端定义', coreFlow: [{ order: 1, label: '上传材料' }] })
    expect(local.payloadSnapshot).toEqual(draftProjection.payload_snapshot)
    expect((local.payloadSnapshot as Record<string, unknown>).unknown_top_level).toEqual({ preserve: true })
  })

  it('maps editable fields to snake_case, maps core_flow to order/name and excludes immutable identity', () => {
    const patch = editableFieldsToPatch({
      publicUrl: 'https://should-not-change.test',
      categoryId: 'personal_site_portfolio',
      categorySchemaVersion: 'portfolio.v1',
      currentName: '人工名称',
      oneLineDefinition: '人工定义',
      coreFlow: [{ id: 'one', order: 1, label: '输入', description: 'ignored description' }],
      targetUsers: ['university_students'],
    })
    expect(patch).toEqual({
      project_core: { current_name: '人工名称', one_line_definition: '人工定义' },
      category_data: { core_flow: [{ order: 1, name: '输入' }], target_users: ['university_students'] },
    })
    expect(patch).not.toHaveProperty('public_url')
    expect(patch).not.toHaveProperty('category_id')
    expect(patch).not.toHaveProperty('category_schema_version')
  })

  it('PATCH sends the current expected version and operation id with CSRF', async () => {
    const fetchMock = installFetch(jsonResponse(draftProjection, 200))
    await submissionApi.patch({ draftId, expectedVersion: 3, fields: { currentName: '新名称' }, session: csrf, operationId: 'patch-operation-01' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ expected_version: 3, patch: { project_core: { current_name: '新名称' } }, operation_id: 'patch-operation-01' })
    expect(init.headers).toMatchObject({ 'X-CSRF-Token': csrf.csrf_token })
  })

  it.each([
    [401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'], [409, 'DRAFT_VERSION_CONFLICT'], [410, 'DRAFT_EXPIRED'], [422, 'DRAFT_INVALID'],
  ] as const)('keeps the typed error status and details for PATCH %s', async (status, code) => {
    installFetch(jsonResponse(errorBody(code), status))
    const thrown = await submissionApi.patch({ draftId, expectedVersion: 3, fields: { currentName: '保留输入' }, session: csrf, operationId: `patch-${status}-01` }).catch((error: unknown) => error as SubmissionApiError) as SubmissionApiError
    expect(thrown).toMatchObject({ status, code, fieldErrors: [{ path: '/patch/current_name', code: 'invalid' }] })
    expect(thrown.details).toMatchObject({ conflict: { current_version: 4 } })
  })

  it('performs exactly one fetch and never implicitly retries a transport error', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void input
      void init
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(submissionApi.patch({ draftId, expectedVersion: 3, fields: { currentName: '保留输入' }, session: csrf, operationId: 'no-retry-operation-01' })).rejects.toMatchObject({ kind: 'transport', retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('previews the requested current draft version and exposes the frozen snapshot and reference summary', async () => {
    const fetchMock = installFetch(jsonResponse(previewProjection, 200))
    const preview = await submissionApi.preview({
      draftId,
      expectedVersion: previewProjection.draft_version,
      checkId,
      session: csrf,
      clientRequestId: 'preview-request-01',
    })

    expect(preview).toMatchObject({
      draft_id: draftId,
      draft_version: 8,
      check_id: checkId,
      preview_hash: previewProjection.preview_hash,
      previewHash: previewProjection.preview_hash,
      frozenSnapshot: previewProjection.payload_snapshot,
      referenceSummary: {
        mediaReferenceIds: previewProjection.media_reference_ids,
        evidenceDraftIds: previewProjection.evidence_draft_ids,
      },
    })
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ expected_version: 8, check_id: checkId })
  })

  it('submits the exact preview identity with a stable submission key and accepts only pending_review', async () => {
    const fetchMock = installFetch(jsonResponse(submissionProjection, 202))
    const result = await submissionApi.submit({
      draftId,
      draftVersion: previewProjection.draft_version,
      checkId,
      previewHash: previewProjection.preview_hash,
      submissionKey: 'stable-submission-key-01',
      session: csrf,
      clientRequestId: 'submit-request-01',
    })

    expect(result).toMatchObject({
      submission_id: submissionProjection.submission_id,
      submissionId: submissionProjection.submission_id,
      review_status: 'pending_review',
      reviewWorkItemId: submissionProjection.review_work_item_id,
    })
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      draft_id: draftId,
      draft_version: 8,
      check_id: checkId,
      preview_hash: previewProjection.preview_hash,
      submission_key: 'stable-submission-key-01',
    })
  })
})
