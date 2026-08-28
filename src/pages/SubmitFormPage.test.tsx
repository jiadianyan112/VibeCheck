import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmissionDraft as ContractSubmissionDraft } from '@vibecheck/contracts'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import { submissionDraftId, type SubmissionDraft } from '../types'

const draftUuid = crypto.randomUUID()
const checkUuid = '11111111-1111-4111-8111-111111111111'
const chainUuid = '33333333-3333-4333-8333-333333333333'
const now = '2026-08-25T08:00:00Z'
const expiresAt = '2026-09-01T08:00:00Z'

type WireFields = Record<string, unknown>

const initialWireFields: WireFields = {
  current_name: '服务端作品名称',
  one_line_definition: '服务端定义',
  access_status: 'normal',
  target_users: ['university_students'],
  core_problem: '服务端问题',
  use_scenarios: ['question_generation'],
  main_inputs: ['pdf'],
  main_outputs: ['questions'],
  core_flow: [{ order: 1, name: '上传材料' }],
}

const portfolioWireFields: WireFields = {
  current_name: '作品集服务端名称',
  one_line_definition: '展示个人作品与经历',
  creator_roles: ['developer'],
  primary_goals: ['showcase_projects'],
  core_modules: ['hero', 'projects'],
}

function payloadSnapshot(fields: WireFields = initialWireFields, coverMediaReferenceIds: readonly string[] = [], categoryId = 'ai_learning_quiz', categorySchemaVersion = 'learning.v1'): Readonly<Record<string, unknown>> {
  return {
    project_core: {
      public_url: 'https://example.test/real-draft',
      category_id: categoryId,
      category_schema_version: categorySchemaVersion,
      cover_media_reference_ids: coverMediaReferenceIds,
      category_data: fields,
    },
    original_extraction: {
      category_data: fields,
    },
    unknown_server_field: { keep: true },
  }
}

function draftDto(
  overrides: Partial<ContractSubmissionDraft> = {},
  fields: WireFields = initialWireFields,
  assets: { readonly mediaReferenceIds?: readonly string[]; readonly evidenceDraftIds?: readonly string[] } = {},
  categoryId: 'ai_learning_quiz' | 'personal_site_portfolio' = 'ai_learning_quiz',
  categorySchemaVersion: 'learning.v1' | 'portfolio.v1' = 'learning.v1',
): ContractSubmissionDraft {
  const mediaReferenceIds = assets.mediaReferenceIds ?? []
  const evidenceDraftIds = assets.evidenceDraftIds ?? []
  return {
    draft_id: draftUuid,
    submission_chain_id: chainUuid,
    category_id: categoryId,
    category_schema_version: categorySchemaVersion,
    check_id: checkUuid,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    payload_snapshot: payloadSnapshot(fields, mediaReferenceIds, categoryId, categorySchemaVersion),
    media_reference_ids: mediaReferenceIds,
    evidence_draft_ids: evidenceDraftIds,
    asset_drafts: [],
    status: 'editing',
    version: 3,
    created_at: now,
    updated_at: now,
    saved_at: now,
    expires_at: expiresAt,
    ...overrides,
  }
}

function portfolioDraftDto(overrides: Partial<ContractSubmissionDraft> = {}): ContractSubmissionDraft {
  return draftDto(overrides, portfolioWireFields, {}, 'personal_site_portfolio', 'portfolio.v1')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    error: {
      code: status === 409 ? 'DRAFT_VERSION_CONFLICT' : status === 410 ? 'DRAFT_EXPIRED' : status === 422 ? 'DRAFT_VALIDATION_FAILED' : status === 401 || status === 403 ? 'AUTH_REQUIRED' : 'REQUEST_FAILED',
      message_key: 'submission.request_failed',
      request_id: `request-${status}`,
      retryable: false,
      retry_after_ms: null,
      ...overrides,
    },
  }, status)
}

type RequestRecord = { url: string; init?: RequestInit; body?: Record<string, unknown> }
type TransportOptions = {
  get?: (init?: RequestInit) => Response | Promise<Response>
  patch?: (body: Record<string, unknown>, init?: RequestInit) => Response | Promise<Response>
}

function installTransport(options: TransportOptions = {}) {
  const requests: RequestRecord[] = []
  let serverVersion = 3
  let serverFields = { ...initialWireFields }
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    let body: Record<string, unknown> | undefined
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body) as Record<string, unknown> } catch { body = undefined }
    }
    requests.push({ url, init, body })
    if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i) && init?.method === 'GET') {
      return options.get ? options.get(init) : jsonResponse(draftDto({ version: serverVersion }, serverFields))
    }
    if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i) && init?.method === 'PATCH') {
      if (options.patch) return options.patch(body ?? {}, init)
      const patch = (body?.patch ?? {}) as WireFields
      serverFields = { ...serverFields, ...patch }
      serverVersion += 1
      return jsonResponse(draftDto({ version: serverVersion, updated_at: '2026-08-25T08:05:00Z' }, serverFields))
    }
    return errorResponse(404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests }
}

type MaterialsTransportOptions = {
  mediaStatus?: 'processing' | 'ready' | 'rejected'
  mediaScanResult?: 'not_scanned' | 'clean' | 'malicious'
  mediaExifRemoved?: boolean
  mediaDeletionGuardActive?: boolean
  evidenceStatus?: 'editing' | 'ready' | 'withdrawn'
  patchConflictOnce?: boolean
  failSubmitOnce?: boolean
  failOnceAt?: 'evidence-complete'
  failAt?: 'patch' | 'upload' | 'media' | 'reference' | 'cover-get' | 'evidence' | 'final-get'
}

function mediaProjection(mediaResourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    media_resource_id: mediaResourceId,
    declared_mime: 'image/png',
    detected_mime: 'image/png',
    byte_size: 1_048_576,
    width: null,
    height: null,
    duration_ms: null,
    checksum_sha256: '0a69c09f7c1eca87a0a6fb108e3aeb1929a2e4bb732a021612730325fd5875b2',
    source: 'upload' as const,
    status: 'ready' as const,
    scan_result: 'clean' as const,
    rejection_reason_code: null,
    scan_attempt_count: 1,
    next_scan_at: null,
    exif_removed: true,
    deletion_guard_active: false,
    version: 2,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function referenceProjection(mediaResourceId: string, mediaReferenceId: string): Record<string, unknown> {
  return {
    media_reference_id: mediaReferenceId,
    media_resource_id: mediaResourceId,
    target_type: 'submission_draft',
    target_id: draftUuid,
    role: 'cover',
    alt_text: '提交作品封面',
    sort_order: 0,
    crop_focus: null,
    variant: null,
    source_media_reference_id: null,
    version: 1,
    created_at: now,
    updated_at: now,
  }
}

function evidenceProjection(evidenceDraftId: string, status: 'editing' | 'ready' | 'withdrawn', bound: boolean, version: number, sourceUrl: string | null): Record<string, unknown> {
  return {
    evidence_draft_id: evidenceDraftId,
    collector_actor_type: 'user',
    parent_type: 'submission_draft',
    parent_id: draftUuid,
    final_target_kind: 'project',
    target_asset_draft_key: null,
    evidence_type: 'trusted_external_source',
    source_channel: 'official_site',
    field_path: '/project_core/public_url',
    requested_visibility: 'public',
    source_url: sourceUrl,
    text_excerpt: null,
    attachment_drafts: [],
    status,
    bound,
    source_hash: 'b'.repeat(64),
    final_field_preview: {
      source_summary: '公开来源',
      captured_at: now,
      collected_by: 'user',
      confidence: 'high',
      source_channel: 'official_site',
    },
    completed_at: status === 'ready' ? now : null,
    promoted_evidence_id: null,
    version,
    created_at: now,
    updated_at: now,
  }
}

function installMaterialsTransport(options: MaterialsTransportOptions = {}) {
  const ids = {
    mediaResourceId: crypto.randomUUID(),
    mediaReferenceId: crypto.randomUUID(),
    evidenceDraftId: crypto.randomUUID(),
  }
  const requests: RequestRecord[] = []
  let serverVersion = 3
  let draftGetCount = 0
  let patchAttemptCount = 0
  let failOnceConsumed = false
  let submitFailureConsumed = false
  let referenceCreated = false
  let evidenceReady = false
  const mediaStatus = options.mediaStatus ?? 'ready'
  const mediaScanResult = options.mediaScanResult ?? 'clean'
  const mediaExifRemoved = options.mediaExifRemoved ?? true
  const mediaDeletionGuardActive = options.mediaDeletionGuardActive ?? false
  const evidenceStatus = options.evidenceStatus ?? 'ready'
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    let body: Record<string, unknown> | undefined
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body) as Record<string, unknown> } catch { body = undefined }
    }
    requests.push({ url, init, body })

    if (url.startsWith('https://uploads.example.test/')) {
      if (options.failAt === 'upload') throw new Error('upload unavailable')
      return new Response(null, { status: 200, headers: { etag: '"upload-receipt-runtime"' } })
    }
    if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i) && init?.method === 'GET') {
      draftGetCount += 1
      if ((options.failAt === 'final-get' && draftGetCount >= 3) || (options.failAt === 'cover-get' && draftGetCount === 2)) throw new Error('draft unavailable')
      const finalGet = draftGetCount >= 3
      const version = finalGet ? 6 : draftGetCount === 2 ? 5 : 3
      serverVersion = Math.max(serverVersion, version)
      return jsonResponse(draftDto({ version }, initialWireFields, {
        mediaReferenceIds: referenceCreated ? [ids.mediaReferenceId] : [],
        evidenceDraftIds: evidenceReady ? [ids.evidenceDraftId] : [],
      }))
    }
    if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i) && init?.method === 'PATCH') {
      patchAttemptCount += 1
      if (options.patchConflictOnce && patchAttemptCount === 1) return errorResponse(409, { details: { current_version: 5 } })
      if (options.failAt === 'patch') return errorResponse(409)
      serverVersion += 1
      return jsonResponse(draftDto({ version: serverVersion }, initialWireFields))
    }
    if (url.endsWith('/media-resources') && init?.method === 'POST') {
      if (options.failAt === 'media') throw new Error('media unavailable')
      return jsonResponse({
        media: mediaProjection(ids.mediaResourceId, {
          status: 'uploading',
          scan_result: 'not_scanned',
          exif_removed: false,
          deletion_guard_active: false,
          version: 1,
        }),
        upload_url: `https://uploads.example.test/${ids.mediaResourceId}`,
        upload_headers: { 'content-type': 'image/png' },
        upload_expires_at: '2026-08-26T10:30:00.000Z',
      }, 201)
    }
    if (url.includes(`/media-resources/${ids.mediaResourceId}/complete`) && init?.method === 'POST') {
      return jsonResponse({
        media: mediaProjection(ids.mediaResourceId, {
          status: mediaStatus === 'rejected' ? 'rejected' : 'processing',
          scan_result: 'not_scanned',
          exif_removed: false,
          deletion_guard_active: false,
          version: 2,
        }),
        scan_queued: true,
      }, 202)
    }
    if (url.endsWith(`/media-resources/${ids.mediaResourceId}`) && init?.method === 'GET') {
      return jsonResponse(mediaProjection(ids.mediaResourceId, {
        status: mediaStatus,
        scan_result: mediaScanResult,
        exif_removed: mediaExifRemoved,
        deletion_guard_active: mediaDeletionGuardActive,
      }))
    }
    if (url.endsWith('/media-references') && init?.method === 'POST') {
      if (options.failAt === 'reference') return errorResponse(422)
      referenceCreated = true
      return jsonResponse(referenceProjection(ids.mediaResourceId, ids.mediaReferenceId), 201)
    }
    if (url.includes(`/submission-drafts/${draftUuid}/preview`) && init?.method === 'POST') {
      return jsonResponse({
        draft_id: draftUuid,
        draft_version: serverVersion,
        check_id: checkUuid,
        preview_hash: 'c'.repeat(64),
        payload_snapshot: payloadSnapshot(initialWireFields, [ids.mediaReferenceId]),
        media_reference_ids: [ids.mediaReferenceId],
        evidence_draft_ids: [ids.evidenceDraftId],
        validation: { valid: true, issue_count: 0 },
        generated_at: now,
      }, 200)
    }
    if (url.endsWith('/submissions') && init?.method === 'POST') {
      if (options.failSubmitOnce && !submitFailureConsumed) {
        submitFailureConsumed = true
        throw new Error('submission unavailable')
      }
      return jsonResponse({
        submission_id: crypto.randomUUID(),
        submission_chain_id: chainUuid,
        draft_id: draftUuid,
        snapshot_version: body?.draft_version ?? serverVersion,
        review_status: 'pending_review',
        review_work_item_id: crypto.randomUUID(),
        media_reference_ids: [ids.mediaReferenceId],
        evidence_draft_ids: [ids.evidenceDraftId],
        preview_hash: body?.preview_hash ?? 'c'.repeat(64),
        version: 1,
        created_at: now,
        updated_at: now,
      }, 202)
    }
    if (url.endsWith('/evidence-drafts') && init?.method === 'POST') {
      if (options.failAt === 'evidence') throw new Error('evidence unavailable')
      return jsonResponse(evidenceProjection(ids.evidenceDraftId, 'editing', false, 1, null), 201)
    }
    if (url.includes(`/evidence-drafts/${ids.evidenceDraftId}/binding`) && init?.method === 'POST') {
      return jsonResponse({
        parent_type: 'submission_draft',
        parent_id: draftUuid,
        evidence_draft_ids: [ids.evidenceDraftId],
        parent_version: body?.expected_parent_version,
        evidence_draft_version: 2,
      })
    }
    if (url.endsWith(`/evidence-drafts/${ids.evidenceDraftId}`) && init?.method === 'PATCH') {
      return jsonResponse(evidenceProjection(ids.evidenceDraftId, 'editing', true, 3, 'https://example.test/real-draft'))
    }
    if (url.includes(`/evidence-drafts/${ids.evidenceDraftId}/complete`) && init?.method === 'POST') {
      if (options.failOnceAt === 'evidence-complete' && !failOnceConsumed) {
        failOnceConsumed = true
        return errorResponse(503)
      }
      evidenceReady = evidenceStatus === 'ready'
      return jsonResponse(evidenceProjection(ids.evidenceDraftId, evidenceStatus, true, 4, 'https://example.test/real-draft'))
    }
    return errorResponse(404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests, ids }
}

function requestKind(request: RequestRecord): string {
  const method = request.init?.method ?? 'GET'
  const { url } = request
  if (method === 'PUT' && url.startsWith('https://uploads.example.test/')) return 'upload-put'
  if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i)) return method === 'PATCH' ? 'draft-patch' : 'draft-get'
  if (url.endsWith('/media-resources') && method === 'POST') return 'media-prepare'
  if (url.includes('/media-resources/') && url.endsWith('/complete') && method === 'POST') return 'media-complete'
  if (url.includes('/media-resources/') && method === 'GET') return 'media-inspect'
  if (url.endsWith('/media-references') && method === 'POST') return 'media-reference'
  if (url.endsWith('/evidence-drafts') && method === 'POST') return 'evidence-create'
  if (url.includes('/evidence-drafts/') && url.endsWith('/binding') && method === 'POST') return 'evidence-bind'
  if (url.includes('/evidence-drafts/') && url.endsWith('/complete') && method === 'POST') return 'evidence-complete'
  if (url.includes('/submission-drafts/') && url.endsWith('/preview') && method === 'POST') return 'draft-preview'
  if (url.includes('/evidence-drafts/') && method === 'PATCH') return 'evidence-patch'
  return `${method.toLowerCase()}-other`
}

function seedDraft(categoryId: 'ai_learning_quiz' | 'personal_site_portfolio' = 'ai_learning_quiz') {
  const id = submissionDraftId(draftUuid)
  const portfolio = categoryId === 'personal_site_portfolio'
  let state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  const draft: SubmissionDraft = {
    id,
    userId: prototypeUsers[0]!.id,
    status: 'draft',
    step: 'prefill',
    fields: portfolio ? {
      publicUrl: 'https://example.test/real-draft',
      categoryId,
      categorySchemaVersion: 'portfolio.v1',
      currentName: '作品集服务端名称',
      oneLineDefinition: '展示个人作品与经历',
      creatorRoles: ['developer'],
      primaryGoals: ['showcase_projects'],
      coreModules: ['hero', 'projects'],
    } : {
      publicUrl: 'https://example.test/real-draft',
      categoryId,
      categorySchemaVersion: 'learning.v1',
    },
    originalExtraction: portfolio ? {
      publicUrl: 'https://example.test/real-draft',
      categoryId,
      categorySchemaVersion: 'portfolio.v1',
      currentName: '作品集服务端名称',
      oneLineDefinition: '展示个人作品与经历',
      creatorRoles: ['developer'],
      primaryGoals: ['showcase_projects'],
      coreModules: ['hero', 'projects'],
    } : {
      publicUrl: 'https://example.test/real-draft',
      categoryId,
      categorySchemaVersion: 'learning.v1',
    },
    assetIds: [],
    duplicateProjectId: null,
    validationErrors: {},
    reviewMessages: {},
    submittedFields: null,
    submittedAssetIds: [],
    supplementalMaterial: '',
    publishedProjectId: null,
    publishedEventId: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    withdrawnAt: null,
    draftId: id,
    checkId: checkUuid,
    version: 3,
    schemaVersion: portfolio ? 'portfolio.v1' : 'learning.v1',
    savedAt: now,
    expiresAt,
    remoteStatus: 'editing',
    payloadSnapshot: portfolio ? payloadSnapshot(portfolioWireFields, [], categoryId, 'portfolio.v1') : payloadSnapshot(),
  }
  state = appReducer(state, { type: 'DRAFT_UPSERT', draft })
  persistAppState(state)
}

function renderForm(step = 'prefill') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/submit/new?draft=${draftUuid}&step=${step}`] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedDraft(): SubmissionDraft {
  const state = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
  return state.submissionDrafts.find((item: SubmissionDraft) => item.id === draftUuid) as SubmissionDraft
}

describe('remote P11 draft GET/PATCH form', () => {
  beforeEach(() => {
    localStorage.clear()
    seedDraft()
    installTransport()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores server fields by GET and never runs local Mock extraction or assets', async () => {
    const transport = installTransport()
    renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    expect(name).toHaveValue('服务端作品名称')
    expect(screen.getByText(/页面中识别到的名称：/).closest('p')).toHaveTextContent('服务端作品名称')
    expect(screen.queryByText('Atlas')).not.toBeInTheDocument()
    expect(screen.queryByText('PDF 题库页面模板')).not.toBeInTheDocument()
    expect(transport.requests.filter((request) => request.init?.method === 'GET')).toHaveLength(1)
  })

  it('caches edits locally and PATCHes editable snake_case fields with the current version', async () => {
    const transport = installTransport()
    const user = userEvent.setup()
    const { router } = renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, '本地修改后的名称')
    await waitFor(() => expect(persistedDraft().fields.currentName).toBe('本地修改后的名称'))
    await user.click(screen.getByRole('button', { name: '保存并继续' }))

    await waitFor(() => expect(router.state.location.search).toContain('step=definition'))
    const patchRequest = transport.requests.find((request) => request.init?.method === 'PATCH')
    expect(patchRequest?.body).toMatchObject({ expected_version: 3 })
    expect((patchRequest?.body?.patch as WireFields).project_core).toMatchObject({ current_name: '本地修改后的名称' })
    expect((patchRequest?.body?.patch as WireFields).project_core).toHaveProperty('public_url', 'https://example.test/real-draft')
    expect(patchRequest?.body?.patch).toHaveProperty('category_id', 'ai_learning_quiz')
    expect(patchRequest?.body?.patch).toHaveProperty('category_schema_version', 'learning.v1')
    await waitFor(() => expect(persistedDraft()).toMatchObject({ version: 4, step: 'definition', draftId: draftUuid }))
  })

  it('preserves a cached edit after an unmount and remote GET recovery', async () => {
    const user = userEvent.setup()
    const first = renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, '离开页面仍保留')
    await waitFor(() => expect(persistedDraft().fields.currentName).toBe('离开页面仍保留'))
    first.unmount()

    renderForm()
    expect(await screen.findByRole('textbox', { name: '作品名称' })).toHaveValue('离开页面仍保留')
  })

  it('validates required fields before PATCH and keeps the edited value', async () => {
    const transport = installTransport()
    const user = userEvent.setup()
    renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(await screen.findByText('请确认作品名称。')).toBeInTheDocument()
    expect(name).toHaveValue('')
    expect(transport.requests.some((request) => request.init?.method === 'PATCH')).toBe(false)
  })

  it('handles 409 without bumping the version or overwriting local input', async () => {
    let getCount = 0
    const transport = installTransport({
      get: () => {
        getCount += 1
        return jsonResponse(draftDto({ version: getCount === 1 ? 3 : 4 }))
      },
      patch: () => errorResponse(409, { details: { current_version: 4 } }),
    })
    const user = userEvent.setup()
    renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, '冲突时保留')
    await user.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(await screen.findByText('服务端已有更新，未覆盖你的输入。请先加载服务端版本，再合并后保存。')).toBeInTheDocument()
    expect(name).toHaveValue('冲突时保留')
    expect(persistedDraft().version).toBe(3)
    expect(transport.requests.find((request) => request.init?.method === 'PATCH')?.body).toMatchObject({ expected_version: 3 })
    await user.click(screen.getByRole('button', { name: '加载服务端版本' }))
    await waitFor(() => expect(persistedDraft().version).toBe(4))
    expect(screen.getByRole('textbox', { name: '作品名称' })).toHaveValue('冲突时保留')
  })

  it('stops editing on a 410 and sends the user back to URL check', async () => {
    installTransport({ patch: () => errorResponse(410) })
    const user = userEvent.setup()
    renderForm()
    await screen.findByRole('textbox', { name: '作品名称' })
    await user.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(await screen.findByRole('heading', { name: '草稿已过期' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新检查地址' })).toHaveAttribute('href', expect.stringContaining('/submit?resumeUrl='))
  })

  it('maps 422 snake_case field errors onto the focused form field', async () => {
    const transport = installTransport({
      patch: () => errorResponse(422, { field_errors: [{ path: '/patch/current_name', code: 'too_short' }] }),
    })
    const user = userEvent.setup()
    renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, 'x')
    await user.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(await screen.findByText('服务端校验未通过（too_short）。')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(transport.requests.some((request) => request.init?.method === 'PATCH')).toBe(true)
  })

  it.each([401, 403])('keeps local input after a %s PATCH response', async (status) => {
    const transport = installTransport({ patch: () => errorResponse(status) })
    const user = userEvent.setup()
    renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, '登录失效仍保留')
    await user.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(await screen.findByText('登录状态已失效，当前输入已保留，请重新登录后继续。')).toBeInTheDocument()
    expect(name).toHaveValue('登录失效仍保留')
    expect(transport.requests.find((request) => request.init?.method === 'PATCH')?.body).toMatchObject({ expected_version: 3 })
  })

  it('blocks the deferred Portfolio save without building or sending a Learning snapshot', async () => {
    localStorage.clear()
    seedDraft('personal_site_portfolio')
    const transport = installTransport({ get: () => jsonResponse(portfolioDraftDto()) })
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('个人主页与作品集的远端保存将在后续流程开放')
    expect(router.state.location.search).toContain('step=development')
    expect(transport.requests.some((request) => request.init?.method === 'PATCH')).toBe(false)
  })

  it('prepares one cover and one public URL evidence before navigating to preview', async () => {
    const transport = installMaterialsTransport()
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))

    await waitFor(() => expect(router.state.location.search).toContain('step=preview'))
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    expect(transport.requests.map(requestKind)).toEqual([
      'draft-get', 'draft-patch', 'media-prepare', 'upload-put', 'media-complete', 'media-inspect', 'media-reference',
      'draft-get', 'evidence-create', 'evidence-bind', 'evidence-patch', 'evidence-complete', 'draft-get',
      'draft-preview',
    ])
    const patchRequest = transport.requests.find((request) => request.init?.method === 'PATCH' && request.url.includes('/submission-drafts/'))
    expect(patchRequest?.body).toMatchObject({ expected_version: 3 })
    expect((patchRequest?.body?.patch as WireFields).project_core).toMatchObject({ cover_media_reference_ids: [] })
    const referenceRequest = transport.requests.find((request) => request.url.endsWith('/media-references') && request.init?.method === 'POST')
    expect(referenceRequest?.body).toMatchObject({ media_resource_id: transport.ids.mediaResourceId, target_id: draftUuid, role: 'cover' })
    const evidenceCreate = transport.requests.find((request) => request.url.endsWith('/evidence-drafts') && request.init?.method === 'POST')
    expect(evidenceCreate?.body).toMatchObject({
      parent_type: 'submission_draft', parent_id: draftUuid, field_path: '/project_core/public_url',
      requested_visibility: 'public', source_channel: 'official_site',
    })
    expect(evidenceCreate?.body?.client_request_id).toEqual(expect.any(String))
    const evidenceRequests = transport.requests.filter((request) => request.url.includes(`/evidence-drafts/${transport.ids.evidenceDraftId}`))
    expect(evidenceRequests.map((request) => request.init?.method)).toEqual(['POST', 'PATCH', 'POST'])
    expect(transport.requests.filter((request) => request.init?.method === 'GET' && request.url.includes('/submission-drafts/'))).toHaveLength(3)
    expect(persistedDraft()).toMatchObject({
      version: 6,
      step: 'preview',
      draftId: draftUuid,
      mediaReferenceIds: [transport.ids.mediaReferenceId],
      evidenceDraftIds: [transport.ids.evidenceDraftId],
    })
    expect(transport.requests.some((request) => request.url.includes('/preview') || request.url.includes('/submissions'))).toBe(true)
  })

  it('invalidates the remote preview and references after a field or cover change', async () => {
    const transport = installMaterialsTransport({ failSubmitOnce: true })
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    await waitFor(() => expect(router.state.location.search).toContain('step=preview'))
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    expect(await screen.findByText('c'.repeat(64))).toBeInTheDocument()
    expect(persistedDraft().preview).toBeDefined()
    expect(persistedDraft().mediaReferenceIds).toEqual([transport.ids.mediaReferenceId])
    expect(persistedDraft().evidenceDraftIds).toEqual([transport.ids.evidenceDraftId])

    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByText('网络连接不可用，当前内容已保留。')).toBeInTheDocument()
    const firstSubmit = transport.requests.find((request) => request.url.endsWith('/submissions'))
    const firstSubmissionKey = firstSubmit?.body?.submission_key
    expect(firstSubmissionKey).toEqual(expect.any(String))
    expect(persistedDraft().submissionKey).toBe(firstSubmissionKey)

    await act(async () => { await router.navigate(`/submit/new?draft=${draftUuid}&step=prefill`) })
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, '字段变化后必须重新预览')
    await waitFor(() => {
      expect(persistedDraft().preview).toBeUndefined()
      expect(persistedDraft().submissionKey).toBeUndefined()
      expect(persistedDraft().mediaReferenceIds).toEqual([])
      expect(persistedDraft().evidenceDraftIds).toEqual([])
    })

    await act(async () => { await router.navigate(`/submit/new?draft=${draftUuid}&step=preview`) })
    expect(await screen.findByText('c'.repeat(64))).toBeInTheDocument()
    await act(async () => { await router.navigate(`/submit/new?draft=${draftUuid}&step=development`) })
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover-2.png', { type: 'image/png' }))
    await waitFor(() => {
      expect(persistedDraft().preview).toBeUndefined()
      expect(persistedDraft().submissionKey).toBeUndefined()
      expect(persistedDraft().mediaReferenceIds).toEqual([])
      expect(persistedDraft().evidenceDraftIds).toEqual([])
    })

    await act(async () => { await router.navigate(`/submit/new?draft=${draftUuid}&step=preview`) })
    expect(await screen.findByText('c'.repeat(64))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    const submitRequests = transport.requests.filter((request) => request.url.endsWith('/submissions'))
    expect(submitRequests).toHaveLength(2)
    expect(submitRequests[1]?.body?.submission_key).toEqual(expect.any(String))
    expect(submitRequests[1]?.body?.submission_key).not.toBe(firstSubmissionKey)
    expect(persistedDraft().submissionKey).toBe(submitRequests[1]?.body?.submission_key)
  })

  it('reloads the latest draft version before retrying a materials PATCH conflict and preserves the cover', async () => {
    const transport = installMaterialsTransport({ patchConflictOnce: true })
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))

    expect(await screen.findByText('材料准备未完成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加载服务端版本' })).toBeInTheDocument()
    expect(screen.getByText('已选择封面：cover.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '加载服务端版本' }))
    await waitFor(() => expect(persistedDraft().version).toBe(5))
    expect(screen.getByText('已选择封面：cover.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试准备提交材料' }))

    await waitFor(() => expect(router.state.location.search).toContain('step=preview'))
    const patchRequests = transport.requests.filter((request) => request.init?.method === 'PATCH' && request.url.includes('/submission-drafts/'))
    expect(patchRequests.map((request) => request.body?.expected_version)).toEqual([3, 5])
  })

  it('reuses material operation keys and runtime evidence ID after an intermediate retry', async () => {
    const transport = installMaterialsTransport({ failOnceAt: 'evidence-complete' })
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByText('材料准备未完成')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试准备提交材料' }))

    await waitFor(() => expect(router.state.location.search).toContain('step=preview'))
    const evidenceCreates = transport.requests.filter((request) => requestKind(request) === 'evidence-create')
    const evidenceBinds = transport.requests.filter((request) => requestKind(request) === 'evidence-bind')
    const evidencePatches = transport.requests.filter((request) => requestKind(request) === 'evidence-patch')
    const evidenceCompletes = transport.requests.filter((request) => requestKind(request) === 'evidence-complete')
    expect(evidenceCreates).toHaveLength(2)
    expect(evidenceBinds).toHaveLength(2)
    expect(evidencePatches).toHaveLength(2)
    expect(evidenceCompletes).toHaveLength(2)
    expect(evidenceCreates.every((request) => request.url.endsWith('/evidence-drafts'))).toBe(true)
    expect(evidenceCreates.map((request) => request.body?.client_request_id)[0]).toBe(evidenceCreates[1]?.body?.client_request_id)
    expect(evidenceBinds.map((request) => request.body?.operation_id)[0]).toBe(evidenceBinds[1]?.body?.operation_id)
    expect((evidencePatches[0]?.init?.headers as Record<string, string>)['Idempotency-Key']).toBe((evidencePatches[1]?.init?.headers as Record<string, string>)['Idempotency-Key'])
    expect(evidenceCompletes.map((request) => request.body?.operation_id)[0]).toBe(evidenceCompletes[1]?.body?.operation_id)
    expect(transport.requests.filter((request) => requestKind(request) === 'media-prepare')).toHaveLength(1)
    expect(transport.requests.filter((request) => requestKind(request) === 'upload-put')).toHaveLength(1)
    expect(transport.requests.filter((request) => requestKind(request) === 'media-complete')).toHaveLength(1)
    expect(transport.requests.filter((request) => requestKind(request) === 'media-reference')).toHaveLength(1)
    expect(evidenceBinds.every((request) => request.url.includes(transport.ids.evidenceDraftId))).toBe(true)
    expect(evidencePatches.every((request) => request.url.includes(transport.ids.evidenceDraftId))).toBe(true)
    expect(evidenceCompletes.every((request) => request.url.includes(transport.ids.evidenceDraftId))).toBe(true)
  })

  it('requires a selected cover and keeps the final step without a field-only PATCH', async () => {
    const transport = installMaterialsTransport()
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择一张封面图片')
    expect(router.state.location.search).toContain('step=development')
    expect(transport.requests.some((request) => request.init?.method === 'PATCH')).toBe(false)
  })

  it('stops after a pending media check and exposes an explicit retry', async () => {
    const transport = installMaterialsTransport({ mediaStatus: 'processing' })
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('媒体仍在安全处理中')
    expect(screen.getByRole('button', { name: '重试准备提交材料' })).toBeInTheDocument()
    expect(router.state.location.search).toContain('step=development')
    expect(transport.requests.some((request) => request.url.endsWith('/media-references'))).toBe(false)
    expect(transport.requests.some((request) => request.url.endsWith('/evidence-drafts'))).toBe(false)
  })

  it('stops after non-ready evidence and keeps the final step', async () => {
    const transport = installMaterialsTransport({ evidenceStatus: 'editing' })
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    await user.upload(screen.getByLabelText(/作品封面/), new File([new Uint8Array(1_048_576)], 'cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('证据仍未准备就绪')
    expect(screen.getByRole('button', { name: '重试准备提交材料' })).toBeInTheDocument()
    expect(router.state.location.search).toContain('step=development')
    expect(transport.requests.filter((request) => request.init?.method === 'GET' && request.url.includes('/submission-drafts/'))).toHaveLength(2)
    expect(transport.requests.some((request) => request.url.includes('/preview') || request.url.includes('/submissions'))).toBe(false)
  })

  it('shows a GET 410 as expired instead of falling back to a local draft', async () => {
    installTransport({ get: () => errorResponse(410) })
    renderForm()
    expect(await screen.findByRole('heading', { name: '草稿已过期' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '作品名称' })).not.toBeInTheDocument()
  })

  it('does not display reusable Mock assets on the development step', async () => {
    renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    expect(screen.queryByRole('checkbox', { name: /Atlas|PDF 题库页面模板/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/资产归属会单独确认/)).not.toBeInTheDocument()
  })
})
