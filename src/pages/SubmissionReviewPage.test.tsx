import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, vi } from 'vitest'
import type { Submission as ContractSubmission, SubmissionDraft as ContractSubmissionDraft, SubmissionPreview as ContractSubmissionPreview } from '@vibecheck/contracts'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { configureServiceRuntime, submissionService } from '../services'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import { submissionDraftId, type SubmissionDraft } from '../types'

const draftId = submissionDraftId('draft-t39-review')
const remoteDraftUuid = crypto.randomUUID()
const remoteCheckUuid = crypto.randomUUID()
const remoteChainUuid = crypto.randomUUID()
const remoteMediaReferenceUuid = crypto.randomUUID()
const remoteEvidenceDraftUuid = crypto.randomUUID()
const remotePreviewHash = 'a'.repeat(64)
const remoteFreshPreviewHash = 'b'.repeat(64)
const remoteSubmissionUuid = crypto.randomUUID()
const remoteReviewWorkItemUuid = crypto.randomUUID()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function remotePayload(currentName = '服务端远端审核演示') {
  return {
    project_core: {
      current_name: currentName,
      public_url: 'https://example.test/remote-review',
      server_owned_marker: 'preview-server-value',
    },
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    category_data: { server_owned_marker: 'preview-server-value' },
  }
}

type RemoteProjectionOptions = {
  version?: number
  status?: ContractSubmissionDraft['status']
  currentName?: string
  mediaReferenceIds?: readonly string[]
  evidenceDraftIds?: readonly string[]
}

function remoteDraftProjection(options: RemoteProjectionOptions = {}): ContractSubmissionDraft {
  return {
    draft_id: remoteDraftUuid,
    submission_chain_id: remoteChainUuid,
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    check_id: remoteCheckUuid,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    payload_snapshot: remotePayload(options.currentName),
    media_reference_ids: options.mediaReferenceIds ?? [remoteMediaReferenceUuid],
    evidence_draft_ids: options.evidenceDraftIds ?? [remoteEvidenceDraftUuid],
    asset_drafts: [],
    status: options.status ?? 'editing',
    version: options.version ?? 8,
    created_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
    saved_at: '2026-08-28T00:00:00Z',
    expires_at: '2026-09-28T00:00:00Z',
  }
}

function remotePreviewProjection(options: RemoteProjectionOptions = {}): ContractSubmissionPreview {
  const draft = remoteDraftProjection(options)
  return {
    draft_id: remoteDraftUuid,
    draft_version: draft.version,
    check_id: remoteCheckUuid,
    preview_hash: remotePreviewHash,
    payload_snapshot: remotePayload(options.currentName),
    media_reference_ids: draft.media_reference_ids,
    evidence_draft_ids: draft.evidence_draft_ids,
    validation: { valid: true, issue_count: 0 },
    generated_at: '2026-08-28T00:00:01Z',
  }
}

function remoteSubmissionProjection(options: RemoteProjectionOptions = {}): ContractSubmission {
  const preview = remotePreviewProjection(options)
  return {
    submission_id: remoteSubmissionUuid,
    submission_chain_id: remoteChainUuid,
    draft_id: remoteDraftUuid,
    snapshot_version: preview.draft_version,
    review_status: 'pending_review',
    review_work_item_id: remoteReviewWorkItemUuid,
    media_reference_ids: preview.media_reference_ids,
    evidence_draft_ids: preview.evidence_draft_ids,
    preview_hash: preview.preview_hash,
    version: 1,
    created_at: '2026-08-28T00:00:02Z',
    updated_at: '2026-08-28T00:00:02Z',
  }
}

function seedDraft(categoryId: 'ai_learning_quiz' | 'personal_site_portfolio' = 'ai_learning_quiz') {
  let state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  const draft: SubmissionDraft = {
    id: draftId,
    userId: prototypeUsers[0]!.id,
    status: 'draft',
    step: 'preview',
    fields: {
      categoryId, currentName: '审核状态演示', publicUrl: 'https://example.test/review', screenshotUrl: null, accessStatus: 'normal', repositoryUrl: null,
      oneLineDefinition: '演示从提交到首次发布的完整状态。', targetUsers: ['university_students'], coreProblem: '审核状态不透明', useScenarios: ['daily_practice'], mainInputs: ['plain_text'], mainOutputs: ['practice_set'], coreFlow: [{ id: 'one', order: 1, label: '提交材料', description: '' }], practiceFormats: [], feedbackMethods: [], differentiation: '', aiCodingTools: ['codex'],
      creatorRoles: categoryId === 'personal_site_portfolio' ? ['developer'] : undefined,
      primaryGoals: categoryId === 'personal_site_portfolio' ? ['showcase_projects'] : undefined,
      coreModules: categoryId === 'personal_site_portfolio' ? ['hero', 'projects'] : undefined,
    },
    originalExtraction: {}, assetIds: [], duplicateProjectId: null, validationErrors: {}, reviewMessages: {}, submittedFields: null, submittedAssetIds: [], supplementalMaterial: '', publishedProjectId: null, publishedEventId: null,
    createdAt: '2026-07-31T10:00:00+08:00', updatedAt: '2026-07-31T10:20:00+08:00', submittedAt: null, withdrawnAt: null,
  }
  state = appReducer(state, { type: 'DRAFT_UPSERT', draft })
  persistAppState(state)
}

function seedRemoteDraft() {
  let state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  const draft: SubmissionDraft = {
    id: submissionDraftId(remoteDraftUuid),
    userId: prototypeUsers[0]!.id,
    status: 'draft',
    step: 'preview',
    fields: {
      categoryId: 'ai_learning_quiz',
      categorySchemaVersion: 'learning.v1',
      currentName: '远端审核演示',
      publicUrl: 'https://example.test/remote-review',
      screenshotUrl: null,
      accessStatus: 'normal',
      repositoryUrl: null,
      oneLineDefinition: '由服务端生成的预览。',
      targetUsers: ['university_students'],
      coreProblem: '证明服务端所有权',
      useScenarios: ['daily_practice'],
      mainInputs: ['plain_text'],
      mainOutputs: ['practice_set'],
      coreFlow: [{ id: 'one', order: 1, label: '提交材料', description: '' }],
      practiceFormats: [],
      feedbackMethods: [],
      differentiation: '',
      aiCodingTools: ['codex'],
    },
    originalExtraction: {},
    assetIds: [],
    duplicateProjectId: null,
    validationErrors: {},
    reviewMessages: {},
    submittedFields: null,
    submittedAssetIds: [],
    supplementalMaterial: '',
    publishedProjectId: null,
    publishedEventId: null,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    submittedAt: null,
    withdrawnAt: null,
    draftId: submissionDraftId(remoteDraftUuid),
    checkId: remoteCheckUuid,
    version: 8,
    schemaVersion: 'learning.v1',
    savedAt: '2026-08-28T00:00:00Z',
    expiresAt: '2026-09-28T00:00:00Z',
    remoteStatus: 'editing',
    payloadSnapshot: remotePayload(),
    mediaReferenceIds: [remoteMediaReferenceUuid],
    evidenceDraftIds: [remoteEvidenceDraftUuid],
  }
  state = appReducer(state, { type: 'DRAFT_UPSERT', draft })
  persistAppState(state)
}

function renderReview(scenario = 'default') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/submit/new?draft=${draftId}&step=preview&scenario=${scenario}`] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedDraft(): SubmissionDraft {
  const state = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
  return state.submissionDrafts.find((draft: SubmissionDraft) => draft.id === draftId)
}

function persistedRemoteDraft(): SubmissionDraft {
  const state = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
  return state.submissionDrafts.find((draft: SubmissionDraft) => draft.id === remoteDraftUuid)
}

function renderRemoteReview() {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/submit/new?draft=${remoteDraftUuid}&step=preview`] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function installRemoteTransport(options: { failSubmitOnce?: boolean; preview422?: boolean; preview422Code?: string; previewErrorStatus?: number; submit409Once?: boolean; stalePendingGet?: boolean; freshEditingGet?: boolean } = {}) {
  const requests: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
  let failedSubmit = false
  let submitConflictConsumed = false
  let serverVersion = options.freshEditingGet ? 9 : 8
  let serverPreviewHash = remotePreviewHash
  let serverCurrentName = options.freshEditingGet ? '服务端新编辑版本' : '服务端远端审核演示'
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    requests.push({ url, init, body })
    if (url.endsWith(`/submission-drafts/${remoteDraftUuid}/preview`) && init?.method === 'POST') {
      if (options.preview422 || options.preview422Code) return jsonResponse({ error: { code: options.preview422Code ?? 'SUBMISSION_COVER_MEDIA_REQUIRED', message_key: 'submission.not_ready', request_id: 'preview-error', retryable: false, retry_after_ms: null } }, options.previewErrorStatus ?? 422)
      const preview = remotePreviewProjection({ version: serverVersion, currentName: serverCurrentName })
      return jsonResponse({ ...preview, preview_hash: serverPreviewHash })
    }
    if (url.endsWith('/submissions') && init?.method === 'POST') {
      if (options.submit409Once && !submitConflictConsumed) {
        submitConflictConsumed = true
        serverVersion = 9
        serverPreviewHash = remoteFreshPreviewHash
        serverCurrentName = '服务端第九版名称'
        return jsonResponse({ error: { code: 'DRAFT_VERSION_CONFLICT', message_key: 'submission.version_conflict', request_id: 'submit-409', retryable: false, retry_after_ms: null } }, 409)
      }
      if (options.failSubmitOnce && !failedSubmit) {
        failedSubmit = true
        throw new Error('network down')
      }
      return jsonResponse(remoteSubmissionProjection({ version: serverVersion }), 202)
    }
    if (url.endsWith(`/submission-drafts/${remoteDraftUuid}`) && init?.method === 'GET') {
      const stale = options.stalePendingGet
      return jsonResponse(remoteDraftProjection({ version: stale ? 8 : serverVersion, status: 'editing', currentName: serverCurrentName }))
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message_key: 'not_found', request_id: 'remote-test', retryable: false, retry_after_ms: null } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests }
}

describe('submission preview and review status', () => {
  beforeEach(() => { localStorage.clear(); configureServiceRuntime({ defaultDelayMs: 0 }); seedDraft() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('confirms once, shows pending without a fabricated ETA, saves material and withdraws', async () => {
    const user = userEvent.setup()
    renderReview()
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    expect(screen.getByLabelText('社区卡片预览')).toHaveTextContent('审核状态演示')
    expect(screen.getByText('暂无作品截图')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    expect(screen.getByText(/不展示倒计时或承诺日期/)).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '补充说明或公开材料地址' }), 'https://example.test/material')
    await user.click(screen.getByRole('button', { name: '保存补充材料' }))
    await waitFor(() => expect(persistedDraft().supplementalMaterial).toBe('https://example.test/material'))
    await user.click(screen.getByRole('button', { name: '撤回审核' }))
    await user.click(screen.getByRole('button', { name: '确认撤回' }))
    expect(await screen.findByRole('heading', { name: '审核状态：已撤回' })).toBeInTheDocument()
    expect(persistedDraft().submittedFields?.currentName).toBe('审核状态演示')
  })

  it('creates a stable project and public first-published event after approval', async () => {
    const user = userEvent.setup()
    const { router } = renderReview('review_approved')
    await user.click(await screen.findByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：已通过' })).toBeInTheDocument()
    const approved = persistedDraft()
    expect(approved.publishedProjectId).toMatch(/^project-submission-/)
    expect(approved.publishedEventId).toMatch(/^event-submission-/)
    await user.click(screen.getByRole('link', { name: '进入作品详情' }))
    expect(await screen.findByRole('heading', { name: '审核状态演示', level: 1 })).toBeInTheDocument()
    await act(async () => { await router.navigate('/activity') })
    expect(await screen.findByText('审核状态演示通过审核并首次发布。')).toBeInTheDocument()
  })

  it('keeps portfolio facts category-aware in the preview and submitted snapshot', async () => {
    localStorage.clear()
    seedDraft('personal_site_portfolio')
    const user = userEvent.setup()
    renderReview()
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    expect(screen.getByLabelText('社区卡片预览')).toHaveTextContent('个人主页与作品集')
    expect(screen.getByText('创作者身份').closest('div')).toHaveTextContent('开发者')
    expect(screen.getByText('建站目的').closest('div')).toHaveTextContent('展示项目')
    expect(screen.getByText('核心内容').closest('div')).toHaveTextContent('首屏、项目')
    expect(screen.queryByText('目标用户')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    expect(screen.getByText('查看提交版本').closest('details')).toHaveTextContent('创作者身份开发者')
    expect(screen.getByText('查看提交版本').closest('details')).not.toHaveTextContent('目标用户')
  })

  it('keeps the same submitted version when the review service fails and retries', async () => {
    const user = userEvent.setup()
    const { router } = renderReview()
    await user.click(await screen.findByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    await screen.findByRole('heading', { name: '审核状态：待审核' })
    const submittedAt = persistedDraft().submittedAt
    const submittedName = persistedDraft().submittedFields?.currentName
    await act(async () => { await router.navigate(`/submit/new?draft=${draftId}&step=preview&scenario=service_error`) })
    await user.click(screen.getByRole('button', { name: '刷新审核状态' }))
    expect(await screen.findByText('服务暂时不可用，请稍后重试。')).toBeInTheDocument()
    expect(screen.queryByText('VC_SERVICE_UNAVAILABLE')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(persistedDraft()).toMatchObject({ status: 'pending_review', submittedAt, submittedFields: { currentName: submittedName } })
  })

  it('uses the server preview and stable submit key for a remote Learning draft without local publication side effects', async () => {
    localStorage.clear()
    seedRemoteDraft()
    const before = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
    const transport = installRemoteTransport({ failSubmitOnce: true })
    const localSubmit = vi.spyOn(submissionService, 'submit')
    const user = userEvent.setup()
    renderRemoteReview()

    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    await waitFor(() => expect(persistedRemoteDraft().preview?.previewHash).toBe(remotePreviewHash))
    expect(screen.queryByText(remotePreviewHash)).not.toBeInTheDocument()
    expect(screen.queryByText(remoteCheckUuid)).not.toBeInTheDocument()
    expect(screen.queryByText(remoteMediaReferenceUuid)).not.toBeInTheDocument()
    expect(screen.queryByText(remoteEvidenceDraftUuid)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('服务端冻结快照')).not.toBeInTheDocument()
    expect(screen.queryByText('preview-server-value')).not.toBeInTheDocument()

    const previewRequest = transport.requests.find((request) => request.url.endsWith(`/submission-drafts/${remoteDraftUuid}/preview`))
    expect(previewRequest?.body).toEqual({ expected_version: 8, check_id: remoteCheckUuid })

    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByText('网络连接不可用，当前内容已保留。')).toBeInTheDocument()
    const firstSubmit = transport.requests.find((request) => request.url.endsWith('/submissions'))
    expect(firstSubmit?.body).toMatchObject({
      draft_id: remoteDraftUuid,
      draft_version: 8,
      check_id: remoteCheckUuid,
      preview_hash: remotePreviewHash,
      submission_key: expect.any(String),
    })

    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    const submitRequests = transport.requests.filter((request) => request.url.endsWith('/submissions'))
    expect(submitRequests).toHaveLength(2)
    expect(submitRequests[1]?.body?.submission_key).toBe(firstSubmit?.body?.submission_key)
    expect(screen.getByText(remoteSubmissionUuid)).toBeInTheDocument()
    expect(screen.getByText(remoteReviewWorkItemUuid)).toBeInTheDocument()
    expect(screen.getByText('提交编号')).toBeInTheDocument()
    expect(screen.getByText('审核编号')).toBeInTheDocument()
    expect(screen.queryByText(remotePreviewHash)).not.toBeInTheDocument()
    expect(persistedRemoteDraft()).toMatchObject({
      status: 'pending_review',
      remoteStatus: 'submitted',
      submissionId: remoteSubmissionUuid,
      reviewWorkItemId: remoteReviewWorkItemUuid,
      reviewStatus: 'pending_review',
    })
    expect(persistedRemoteDraft().publishedProjectId).toBeNull()
    expect(persistedRemoteDraft().publishedEventId).toBeNull()
    const after = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
    expect(after.projectOverrides).toEqual(before.projectOverrides)
    expect(after.lifecycleEventAdditions).toEqual(before.lifecycleEventAdditions)
    expect(after.eventLog).toEqual(before.eventLog)
    expect(localSubmit).not.toHaveBeenCalled()
  })

  it('clears a stale remote preview and key after submit 409, then refreshes the draft before allowing a new submit', async () => {
    localStorage.clear()
    seedRemoteDraft()
    const transport = installRemoteTransport({ submit409Once: true })
    const user = userEvent.setup()
    renderRemoteReview()

    await waitFor(() => expect(persistedRemoteDraft().preview?.previewHash).toBe(remotePreviewHash))
    expect(screen.queryByText(remotePreviewHash)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))

    await waitFor(() => expect(transport.requests.filter((request) => request.url.endsWith(`/submission-drafts/${remoteDraftUuid}`) && request.init?.method === 'GET')).toHaveLength(2))
    await waitFor(() => expect(persistedRemoteDraft().preview?.previewHash).toBe(remoteFreshPreviewHash))
    expect(screen.queryByText(remoteFreshPreviewHash)).not.toBeInTheDocument()
    expect(screen.getByLabelText('社区卡片预览')).toHaveTextContent('服务端第九版名称')
    expect(screen.queryByText('服务端版本发生变化，提交尚未创建。请返回最终步骤加载最新版本后重试。')).not.toBeInTheDocument()
    expect(persistedRemoteDraft().preview?.previewHash).toBe(remoteFreshPreviewHash)
    expect(persistedRemoteDraft().fields.currentName).toBe('服务端第九版名称')
    expect(persistedRemoteDraft().submissionKey).toBeUndefined()

    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    const submitRequests = transport.requests.filter((request) => request.url.endsWith('/submissions'))
    expect(submitRequests).toHaveLength(2)
    expect(submitRequests[0]?.body).toMatchObject({ draft_version: 8, preview_hash: remotePreviewHash })
    expect(submitRequests[1]?.body).toMatchObject({ draft_version: 9, preview_hash: remoteFreshPreviewHash })
    expect(submitRequests[1]?.body?.submission_key).not.toBe(submitRequests[0]?.body?.submission_key)
    expect(persistedRemoteDraft().submittedFields?.currentName).toBe('服务端第九版名称')
  })

  it('keeps a pending remote receipt when a lagging editing GET arrives after submit', async () => {
    localStorage.clear()
    seedRemoteDraft()
    const firstTransport = installRemoteTransport()
    const user = userEvent.setup()
    const first = renderRemoteReview()

    await waitFor(() => expect(persistedRemoteDraft().preview?.previewHash).toBe(remotePreviewHash))
    expect(screen.queryByText(remotePreviewHash)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    const receipt = persistedRemoteDraft()
    expect(receipt.status).toBe('pending_review')
    expect(firstTransport.requests.filter((request) => request.init?.method === 'POST' && request.url.endsWith('/submissions'))).toHaveLength(1)
    first.unmount()

    const laggingTransport = installRemoteTransport({ stalePendingGet: true })
    renderRemoteReview()
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认并提交审核' })).not.toBeInTheDocument()
    expect(persistedRemoteDraft()).toMatchObject({
      status: 'pending_review',
      remoteStatus: 'submitted',
      submissionId: remoteSubmissionUuid,
      reviewWorkItemId: remoteReviewWorkItemUuid,
      reviewStatus: 'pending_review',
    })
    expect(laggingTransport.requests.filter((request) => request.init?.method === 'POST' && request.url.endsWith('/submissions'))).toHaveLength(0)
  })

  it('does not preserve an old pending receipt over a newer editable server version', async () => {
    localStorage.clear()
    seedRemoteDraft()
    const user = userEvent.setup()
    installRemoteTransport()
    const first = renderRemoteReview()

    await waitFor(() => expect(persistedRemoteDraft().preview?.previewHash).toBe(remotePreviewHash))
    expect(screen.queryByText(remotePreviewHash)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    first.unmount()

    installRemoteTransport({ freshEditingGet: true })
    renderRemoteReview()
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    await waitFor(() => expect(persistedRemoteDraft().version).toBe(9))
    expect(persistedRemoteDraft()).toMatchObject({ status: 'draft', remoteStatus: 'editing' })
    expect(persistedRemoteDraft().fields.currentName).toBe('服务端新编辑版本')
    expect(persistedRemoteDraft().submissionId).toBeUndefined()
    expect(persistedRemoteDraft().submittedFields).toBeNull()
    expect(persistedRemoteDraft().submittedAt).toBeNull()
    expect(screen.getByLabelText('社区卡片预览')).toHaveTextContent('服务端新编辑版本')
    expect(screen.getByRole('button', { name: '确认并提交审核' })).toBeInTheDocument()
  })

  it('blocks remote submission on a readiness error and returns to the final materials step', async () => {
    localStorage.clear()
    seedRemoteDraft()
    const transport = installRemoteTransport({ preview422Code: 'SUBMISSION_COVER_MEDIA_MISMATCH', previewErrorStatus: 409 })
    renderRemoteReview()

    expect(await screen.findByText('尚未确认封面或公开地址证据已准备就绪，请返回“开发与资产”完成材料后重试。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回开发与资产' })).toHaveAttribute('href', expect.stringContaining('step=development'))
    expect(screen.queryByRole('button', { name: '确认并提交审核' })).not.toBeInTheDocument()
    expect(transport.requests.some((request) => request.url.endsWith('/submissions'))).toBe(false)
  })

  it('distinguishes a schema 422 from missing submission materials', async () => {
    localStorage.clear()
    seedRemoteDraft()
    const transport = installRemoteTransport({ preview422Code: 'DRAFT_VALIDATION_FAILED' })
    renderRemoteReview()

    expect(await screen.findByText('当前作品信息未通过校验，请返回表单修正内容后重新准备提交材料。')).toBeInTheDocument()
    expect(screen.queryByText(/尚未确认封面或公开地址证据/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回修正作品信息' })).toHaveAttribute('href', expect.stringContaining('step=prefill'))
    expect(transport.requests.some((request) => request.url.endsWith('/submissions'))).toBe(false)
  })
})
