import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmissionDraft as ContractSubmissionDraft, SubmissionUrlCheck } from '@vibecheck/contracts'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'

const checkId = '11111111-1111-4111-8111-111111111111'
const draftId = '22222222-2222-4222-8222-222222222222'
const chainId = '33333333-3333-4333-8333-333333333333'
const duplicateProjectId = '44444444-4444-4444-8444-444444444444'
const requestHash = 'a'.repeat(64)
const now = '2026-08-25T08:00:00Z'
const expiresAt = '2026-09-01T08:00:00Z'

function loginInStorage() {
  const state = appReducer(createInitialAppState(), {
    type: 'LOGIN_COMPLETED',
    user: prototypeUsers[0]!,
  })
  persistAppState(state)
}

function checkDto(rawUrl: string, overrides: Partial<SubmissionUrlCheck> = {}): SubmissionUrlCheck {
  return {
    check_id: checkId,
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    input_hash: requestHash,
    canonical_url: rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`,
    redirect_chain: [],
    risk_result: 'allowed',
    access_result: 'accessible',
    category_result: 'matched',
    duplicate_result: 'none',
    duplicate_candidates: [],
    risk_reasons: [],
    can_create_draft: true,
    checked_at: now,
    expires_at: expiresAt,
    ...overrides,
  }
}

function draftDto(overrides: Partial<ContractSubmissionDraft> = {}): ContractSubmissionDraft {
  return {
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
        public_url: 'https://example.test/real-draft',
        category_data: {
          current_name: '服务端作品名称',
          one_line_definition: '服务端定义',
          access_status: 'normal',
        },
      },
      unknown_server_field: { keep: true },
    },
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
      code: status === 401 || status === 403 ? 'AUTH_REQUIRED' : 'REQUEST_FAILED',
      message_key: 'submission.request_failed',
      request_id: `request-${status}`,
      retryable: status >= 500,
      retry_after_ms: status >= 500 ? 250 : null,
      ...overrides,
    },
  }, status)
}

type RequestRecord = { url: string; init?: RequestInit; body?: Record<string, unknown> }
type TransportOptions = {
  check?: (body: Record<string, unknown>, init?: RequestInit) => Response | Promise<Response>
  create?: (body: Record<string, unknown>, init?: RequestInit) => Response | Promise<Response>
  get?: (init?: RequestInit) => Response | Promise<Response>
}

function installTransport(options: TransportOptions = {}) {
  const requests: RequestRecord[] = []
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ url, init, body })
    if (url.includes('/submission-url-checks')) {
      return options.check ? options.check(body ?? {}, init) : jsonResponse(checkDto(String(body?.raw_url ?? '')), 201)
    }
    if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i) && init?.method === 'GET') {
      return options.get ? options.get(init) : jsonResponse(draftDto())
    }
    if (url.endsWith('/submission-drafts') && init?.method === 'POST') {
      return options.create ? options.create(body ?? {}, init) : jsonResponse(draftDto(), 201)
    }
    if (url.match(/\/submission-drafts\/[0-9a-f-]+$/i) && init?.method === 'PATCH') {
      return jsonResponse(draftDto({ version: 4, updated_at: '2026-08-25T08:05:00Z' }))
    }
    return errorResponse(404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests }
}

function renderRoute(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedDrafts() {
  const raw = localStorage.getItem(APP_STORAGE_KEY)
  return raw ? JSON.parse(raw).submissionDrafts as Array<Record<string, unknown>> : []
}

describe('submission entry and real URL-check/draft-create gateway', () => {
  beforeEach(() => {
    localStorage.clear()
    installTransport()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the address entry in the shared six-stage task workspace', () => {
    loginInStorage()
    renderRoute('/submit')

    const scope = document.querySelector('.highfi-scope')
    expect(scope).not.toBeNull()
    expect(scope?.querySelector('.task-shell')).not.toBeNull()
    expect(scope?.querySelector('.task-shell__aside')).not.toBeNull()
    expect(scope?.querySelector('.status-beacon')).not.toBeNull()
    expect(scope?.querySelector('.wire-panel')).toBeNull()

    const steps = [...(scope?.querySelectorAll('[data-step-id]') ?? [])]
    expect(steps).toHaveLength(6)
    expect(steps.map((step) => step.textContent?.trim())).toEqual([
      '检查地址',
      '基础信息',
      '定位与用途',
      '核心内容',
      '开发与资产',
      '预览与提交',
    ])
    expect(scope?.querySelector('[data-step-id="address"]')).toHaveAttribute('aria-current', 'step')
    expect(scope?.querySelector('[data-step-id="details"]')).toHaveAttribute('data-step-state', 'upcoming')
  })

  it('routes a guest publish request to login while preserving its return target', () => {
    renderRoute('/submit?resumeUrl=https%3A%2F%2Fexample.test%2Ftool')
    expect(screen.getByRole('heading', { name: '先登录，再检查作品地址' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录后发布' })).toHaveAttribute(
      'href',
      '/auth?return_to=%2Fsubmit%3FresumeUrl%3Dhttps%253A%252F%252Fexample.test%252Ftool',
    )
  })

  it('checks the real DTO and navigates only after a 201 draft create', async () => {
    loginInStorage()
    const transport = installTransport()
    const user = userEvent.setup()
    const { router } = renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/real-draft')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('地址检查通过')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '继续补充作品信息' }))

    await waitFor(() => expect(transport.requests.some((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts'))).toBe(true))
    await waitFor(() => expect(router.state.location.pathname).toBe('/submit/new'))
    const checkRequest = transport.requests.find((request) => request.url.includes('/submission-url-checks'))
    const createRequest = transport.requests.find((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts'))
    expect(checkRequest?.body).toMatchObject({ category_hint: 'ai_learning_quiz' })
    expect(createRequest?.body).toMatchObject({ check_id: checkId, category_id: 'ai_learning_quiz' })
    expect(typeof createRequest?.body?.client_request_id).toBe('string')
    await waitFor(() => expect(persistedDrafts()).toHaveLength(1))
    expect(persistedDrafts()[0]).toMatchObject({ draftId, checkId, version: 3, schemaVersion: 'learning.v1' })
  })

  it('does not call the API or create a draft for an invalid URL', async () => {
    loginInStorage()
    const transport = installTransport()
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'not-a-public-host')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入可识别的 HTTP 或 HTTPS')
    expect(screen.getByRole('button', { name: '检查地址' })).toBeDisabled()
    expect(transport.fetchMock).not.toHaveBeenCalled()
    expect(persistedDrafts()).toHaveLength(0)
  })

  it('reuses the check client_request_id across a network retry and preserves the URL', async () => {
    loginInStorage()
    const transport = installTransport({ check: async () => { throw new Error('offline') } })
    const user = userEvent.setup()
    renderRoute('/submit')
    const input = screen.getByRole('textbox', { name: /^作品地址/ })
    await user.type(input, 'https://example.test/network-draft')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('网络连接不可用，当前内容已保留。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(transport.fetchMock).toHaveBeenCalledTimes(2))
    const bodies = transport.requests.filter((request) => request.url.includes('/submission-url-checks')).map((request) => request.body)
    expect(bodies[0]?.client_request_id).toBe(bodies[1]?.client_request_id)
    expect(input).toHaveValue('https://example.test/network-draft')
    expect(persistedDrafts()).toHaveLength(0)
  })

  it('preserves the selected category and URL across an unmount/remount', async () => {
    loginInStorage()
    const user = userEvent.setup()
    const first = renderRoute('/submit')
    await user.selectOptions(screen.getByRole('combobox', { name: /作品品类/ }), 'personal_site_portfolio')
    const input = screen.getByRole('textbox', { name: /^作品地址/ })
    await user.type(input, 'example.test/my-portfolio')
    await user.tab()
    first.unmount()

    renderRoute('/submit')
    expect(screen.getByRole('combobox', { name: /作品品类/ })).toHaveValue('personal_site_portfolio')
    expect(screen.getByRole('textbox', { name: /^作品地址/ })).toHaveValue('https://example.test/my-portfolio')
  })

  it('lets an explicit category query override the persisted entry category', () => {
    loginInStorage()
    const persisted = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({ ...persisted, submissionEntryCategoryId: 'personal_site_portfolio' }))
    renderRoute('/submit?category=ai_learning_quiz')
    expect(screen.getByRole('combobox', { name: /作品品类/ })).toHaveValue('ai_learning_quiz')
  })

  it('allows a warning result to be saved but not continued', async () => {
    loginInStorage()
    const transport = installTransport({ check: (body) => jsonResponse(checkDto(String(body.raw_url), { access_result: 'uncertain' }), 201) })
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/uncertain')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('检查未完全通过，可先保存草稿')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续发布' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '保存地址草稿' }))
    await waitFor(() => expect(transport.requests.filter((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts'))).toHaveLength(1))
  })

  it('never creates a draft when the server says a blocked URL is ineligible', async () => {
    loginInStorage()
    const transport = installTransport({ check: (body) => jsonResponse(checkDto(String(body.raw_url), { risk_result: 'blocked', risk_reasons: ['blocked by policy'], can_create_draft: false }), 201) })
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'https://unsafe.example/tool')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('当前地址不能创建发布草稿')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存地址草稿' })).not.toBeInTheDocument()
    expect(transport.requests.some((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts'))).toBe(false)
  })

  it('uses the API duplicate candidate identity without consulting prototype projects', async () => {
    loginInStorage()
    const transport = installTransport({
      check: (body) => jsonResponse(checkDto(String(body.raw_url), {
        duplicate_result: 'candidate',
        can_create_draft: false,
        duplicate_candidates: [{ project_id: duplicateProjectId, current_name: '服务端重复候选', category_id: 'ai_learning_quiz', reason: 'canonical_url_exact' }],
      }), 201),
    })
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/duplicate')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByRole('heading', { name: '服务端重复候选', level: 3 })).toBeInTheDocument()
    expect(screen.queryByText(duplicateProjectId)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看已有作品详情' })).toHaveAttribute(
      'href',
      `/project/${duplicateProjectId}?from=submit&submissionUrl=https%3A%2F%2Fexample.test%2Fduplicate`,
    )
    await user.click(screen.getByRole('checkbox', { name: /我是该作品作者/ }))
    expect(screen.getByRole('link', { name: '继续验证作者身份' })).toHaveAttribute(
      'href',
      `/project/${duplicateProjectId}/verify-author?from=submit&submissionUrl=https%3A%2F%2Fexample.test%2Fduplicate`,
    )
    expect(screen.getByRole('link', { name: '了解如何提交纠错' })).toHaveAttribute('href', '/about#corrections')
    expect(screen.queryByText('PDF 题库实验室')).not.toBeInTheDocument()
    expect(transport.requests.filter((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts'))).toHaveLength(0)
  })

  it('maps cancellation to a non-retryable result without creating a draft', async () => {
    loginInStorage()
    const transport = installTransport({
      check: (_body, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }),
    })
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/cancelled')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    await user.click(screen.getByRole('button', { name: '取消检查' }))
    expect(await screen.findByText('检查已取消')).toBeInTheDocument()
    expect(transport.fetchMock).toHaveBeenCalledTimes(1)
    expect(persistedDrafts()).toHaveLength(0)
  })

  it.each([401, 403])('preserves URL and category after a %s response', async (status) => {
    loginInStorage()
    const transport = installTransport({ check: () => errorResponse(status) })
    const user = userEvent.setup()
    renderRoute('/submit?category=personal_site_portfolio')
    const input = screen.getByRole('textbox', { name: /^作品地址/ })
    await user.type(input, 'https://example.test/auth-failure')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('登录状态已失效，当前输入已保留，请重新登录后继续。')).toBeInTheDocument()
    expect(input).toHaveValue('https://example.test/auth-failure')
    expect(screen.getByRole('combobox', { name: /作品品类/ })).toHaveValue('personal_site_portfolio')
    expect(transport.requests).toHaveLength(1)
  })

  it('reuses the create client_request_id when the same save action is retried', async () => {
    loginInStorage()
    let createAttempts = 0
    const transport = installTransport({
      create: () => {
        createAttempts += 1
        return createAttempts === 1 ? errorResponse(503) : jsonResponse(draftDto(), 201)
      },
    })
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/create-retry')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    await screen.findByText('地址检查通过')
    await user.click(screen.getByRole('button', { name: '保存地址草稿' }))
    await waitFor(() => expect(createAttempts).toBe(1))
    await user.click(screen.getByRole('button', { name: '保存地址草稿' }))
    await waitFor(() => expect(createAttempts).toBe(2))
    const createBodies = transport.requests.filter((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts')).map((request) => request.body)
    expect(createBodies[0]?.client_request_id).toBe(createBodies[1]?.client_request_id)
  })

  it('does not re-create a server draft when save and continue follow the same 201', async () => {
    loginInStorage()
    const transport = installTransport()
    const user = userEvent.setup()
    const { router } = renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/one-draft')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    await screen.findByText('地址检查通过')
    await user.click(screen.getByRole('button', { name: '保存地址草稿' }))
    await screen.findByRole('button', { name: '草稿已保存' })
    await user.click(screen.getByRole('button', { name: '继续补充作品信息' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/submit/new'))
    expect(transport.requests.filter((request) => request.init?.method === 'POST' && request.url.endsWith('/submission-drafts'))).toHaveLength(1)
    expect(persistedDrafts()).toHaveLength(1)
  })

  it('runs an auto-check once and does not create a draft implicitly', async () => {
    loginInStorage()
    const transport = installTransport()
    renderRoute('/submit?autoCheck=1&resumeUrl=https%3A%2F%2Fexample.test%2Fauto-check')
    expect(await screen.findByText('地址检查通过')).toBeInTheDocument()
    await waitFor(() => expect(transport.requests.filter((request) => request.url.includes('/submission-url-checks'))).toHaveLength(1))
    expect(transport.requests.some((request) => request.url.endsWith('/submission-drafts'))).toBe(false)
  })
})
