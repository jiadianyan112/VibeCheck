import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import * as authContext from '../features/auth/AuthSessionContext'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import * as authService from '../services/authService'
import type { AuthSessionDto } from '../services/authService'
import { appReducer, createInitialAppState, persistAppState } from '../state'

vi.mock('../features/auth/AuthSessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/auth/AuthSessionContext')>()
  return {
    ...actual,
    useAuthSession: vi.fn(),
  }
})

vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>()
  return {
    ...actual,
    getPasswordStatus: vi.fn(),
    setPassword: vi.fn(),
  }
})

function renderMe() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/me'] })
  return render(<AppProviders><RouterProvider router={router} /></AppProviders>)
}

function loginAs(index: number) {
  const state = appReducer(createInitialAppState(), createLoginAction(prototypeUsers[index]!))
  persistAppState(state)
  return state
}

const testAuthSession: AuthSessionDto = {
  authenticated: true,
  user_id: 'user-mia',
  display_name: '米娅',
  account_status: 'active',
  roles: ['user'],
  primary_role: 'user',
  permissions: [],
  session_version: 1,
  csrf_token: 'csrf-token',
  recent_auth_at: '2026-09-25T10:00:00.000Z',
  expires_at: '2026-09-26T10:00:00.000Z',
}

describe('PersonalCenterPage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(authContext.useAuthSession).mockReturnValue({
      status: 'authenticated',
      session: testAuthSession,
      acceptSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    })
    vi.mocked(authService.getPasswordStatus).mockResolvedValue({ has_password: true, can_set_password: true })
    vi.mocked(authService.setPassword).mockResolvedValue(undefined)
  })

  it('returns a guest to email OTP login and keeps the original route', async () => {
    renderMe()
    expect(await screen.findByRole('heading', { name: '登录／注册' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '邮箱密码登录' })).toBeInTheDocument()
  })

  it('shows password security status and submits a password without trimming spaces', async () => {
    const user = userEvent.setup()
    loginAs(0)
    renderMe()
    expect(await screen.findByRole('heading', { name: '账号安全' })).toBeInTheDocument()
    expect(screen.getByText('密码已设置')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^新密码/), 'secret 123')
    await user.click(screen.getByRole('button', { name: '更新密码' }))
    expect(authService.setPassword).toHaveBeenCalledWith(expect.anything(), 'secret 123')
    expect(within(screen.getByRole('region', { name: '账号安全' })).getByRole('status')).toHaveTextContent('密码已更新')
  })

  it('links users without recent OTP authentication to the forced OTP security flow', async () => {
    vi.mocked(authService.getPasswordStatus).mockImplementation(async () => ({ has_password: true, can_set_password: false }))
    loginAs(0)
    renderMe()
    expect(await screen.findByText(/需要先验证邮箱/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '使用验证码验证后设置密码' })).toHaveAttribute('href', '/auth?mode=otp&return_to=%2Fme%23security')
    expect(screen.queryByRole('textbox', { name: '新密码' })).not.toBeInTheDocument()
  })

  it('switches to the forced OTP flow when the recent email verification expires', async () => {
    const user = userEvent.setup()
    vi.mocked(authService.setPassword).mockRejectedValueOnce(new authService.AuthApiError('OTP_REAUTH_REQUIRED', 403, null, false, null))
    loginAs(0)
    renderMe()
    expect(await screen.findByRole('button', { name: '更新密码' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^新密码/), 'secret 123')
    await user.click(screen.getByRole('button', { name: '更新密码' }))
    expect(await screen.findByRole('link', { name: '使用验证码验证后设置密码' })).toHaveAttribute('href', '/auth?mode=otp&return_to=%2Fme%23security')
  })

  it('returns all registered-user history to shared source records', async () => {
    const user = userEvent.setup()
    loginAs(0)
    renderMe()
    expect(await screen.findByRole('heading', { name: '米娅的个人中心' })).toBeInTheDocument()
    const favorites = screen.getByRole('region', { name: '收藏' })
    const quizLink = within(favorites).getByRole('link', { name: '题练工坊' })
    expect(quizLink).toHaveAttribute('href', '/project/project-quizforge')
    expect(within(favorites).getAllByRole('button', { name: '关注更新' })).toHaveLength(2)
    expect(within(favorites).getAllByRole('button', { name: '取消关注更新' })).toHaveLength(2)
    const quizItem = quizLink.closest('li') as HTMLElement
    await user.click(within(quizItem).getByRole('button', { name: '关注更新' }))
    expect(within(quizItem).getByRole('button', { name: '取消关注更新' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: '关注的作品更新' })).not.toBeInTheDocument()
    const comparisonLinks = screen.getAllByRole('link', { name: '继续比较' }).map((link) => link.getAttribute('href'))
    expect(comparisonLinks).toEqual(expect.arrayContaining([
      '/compare/comparison-anonymous-pdf#structured-comparison-heading',
      '/compare/comparison-mia-speaking#structured-comparison-heading',
    ]))
    expect(screen.getByRole('link', { name: '继续编辑' })).toHaveAttribute('href', expect.stringContaining('/submit/new?draft=draft-mia-study-review'))
    expect(screen.getByText('待人工审核')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回比较' })).toHaveAttribute('href', '/compare/comparison-mia-speaking#comparison-decision')
    expect(screen.queryByRole('heading', { name: '平台管理入口' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '我的作品' })).not.toBeInTheDocument()
  })

  it('shows review status and field messages from the same submission draft', async () => {
    const state = loginAs(0)
    const draft = state.submissionDrafts[0]!
    persistAppState({ ...state, submissionDrafts: [{ ...draft, status: 'changes_requested', reviewMessages: { oneLineDefinition: '请把目标用户和核心价值写得更具体。' } }] })
    renderMe()
    expect(await screen.findByText('需修改')).toBeInTheDocument()
    expect(screen.getByText(/请把目标用户和核心价值写得更具体。/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看审核' })).toHaveAttribute('href', `/submit/new?draft=${draft.id}`)
  })

  it('shows author work management without staff-only tools', async () => {
    loginAs(1)
    renderMe()
    expect(await screen.findByRole('heading', { name: '我的作品' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看我的作者主页' })).toHaveAttribute('href', '/creator/creator-zhou')
    expect(screen.getAllByRole('link', { name: '更新作品' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '作品更新待办' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '平台管理入口' })).not.toBeInTheDocument()
  })

  it('shows staff tools only to editor or administrator roles', async () => {
    loginAs(2)
    renderMe()
    expect(await screen.findByRole('heading', { name: '平台管理入口' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /发布审核/ })).toHaveAttribute('href', '/admin/reviews')
    expect(screen.getByRole('link', { name: /状态监测/ })).toHaveAttribute('href', '/admin/status-monitor')
    expect(screen.queryByRole('heading', { name: '作品更新待办' })).not.toBeInTheDocument()
  })
})
