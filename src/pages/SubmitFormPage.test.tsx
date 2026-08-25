import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmissionDraft as ContractSubmissionDraft } from '@vibecheck/contracts'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import { submissionDraftId, type SubmissionDraft } from '../types'

const draftUuid = '22222222-2222-4222-8222-222222222222'
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

function payloadSnapshot(fields: WireFields = initialWireFields): Readonly<Record<string, unknown>> {
  return {
    project_core: {
      public_url: 'https://example.test/real-draft',
      category_id: 'ai_learning_quiz',
      category_schema_version: 'learning.v1',
      category_data: fields,
    },
    original_extraction: {
      category_data: fields,
    },
    unknown_server_field: { keep: true },
  }
}

function draftDto(overrides: Partial<ContractSubmissionDraft> = {}, fields: WireFields = initialWireFields): ContractSubmissionDraft {
  return {
    draft_id: draftUuid,
    submission_chain_id: chainUuid,
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    check_id: checkUuid,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    payload_snapshot: payloadSnapshot(fields),
    media_reference_ids: [],
    evidence_draft_ids: [],
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
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
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

function seedDraft() {
  const id = submissionDraftId(draftUuid)
  let state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  const draft: SubmissionDraft = {
    id,
    userId: prototypeUsers[0]!.id,
    status: 'draft',
    step: 'prefill',
    fields: {
      publicUrl: 'https://example.test/real-draft',
      categoryId: 'ai_learning_quiz',
      categorySchemaVersion: 'learning.v1',
    },
    originalExtraction: {
      publicUrl: 'https://example.test/real-draft',
      categoryId: 'ai_learning_quiz',
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
    schemaVersion: 'learning.v1',
    savedAt: now,
    expiresAt,
    remoteStatus: 'editing',
    payloadSnapshot: payloadSnapshot(),
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
    expect(patchRequest?.body?.patch).toMatchObject({ current_name: '本地修改后的名称' })
    expect(patchRequest?.body?.patch).not.toHaveProperty('public_url')
    expect(patchRequest?.body?.patch).not.toHaveProperty('category_id')
    expect(patchRequest?.body?.patch).not.toHaveProperty('category_schema_version')
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

  it('saves the final step by PATCH and remains on 草稿已保存 without preview or submit', async () => {
    const transport = installTransport()
    const user = userEvent.setup()
    const { router } = renderForm('development')
    await screen.findByRole('heading', { name: '开发与资产' })
    expect(screen.getByText('本轮只保存草稿的可编辑字段，不读取或展示本地示例资产。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('当前版本已同步到服务端。')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/submit/new')
    expect(screen.getByRole('button', { name: '草稿已保存' })).toBeDisabled()
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
