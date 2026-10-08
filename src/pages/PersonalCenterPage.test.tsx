import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import * as authContext from '../features/auth/AuthSessionContext'
import { createLoginAction } from '../features/auth/session'
import { adminReviewDrafts, prototypeUsers } from '../mocks'
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
    startPasswordResetChallenge: vi.fn(),
    verifyEmailChallenge: vi.fn(),
    resetPassword: vi.fn(),
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
    vi.mocked(authService.getPasswordStatus).mockResolvedValue({ has_password: true, can_set_password: true, can_set_without_current_password: false })
    vi.mocked(authService.setPassword).mockResolvedValue(undefined)
    vi.mocked(authService.startPasswordResetChallenge).mockResolvedValue({
      auth_flow_id: '55555555-5555-4555-8555-555555555555',
      challenge_id: '66666666-6666-4666-8666-666666666666',
      expires_at: '2026-09-25T10:10:00.000Z',
      resend_after: '2026-09-25T10:01:00.000Z',
      masked_email: 'mi***@example.com',
    })
    vi.mocked(authService.verifyEmailChallenge).mockResolvedValue({
      purpose: 'password_reset',
      reset_grant: 'reset-grant-token',
      expires_at: '2026-09-25T10:10:00.000Z',
    })
    vi.mocked(authService.resetPassword).mockResolvedValue(undefined)
  })

  it('returns a guest to email OTP login and keeps the original route', async () => {
    renderMe()
    expect(await screen.findByRole('heading', { name: '登录／注册' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '邮箱密码登录' })).toBeInTheDocument()
  })

  it('keeps password flows hidden until the matching action is chosen', async () => {
    const user = userEvent.setup()
    loginAs(0)
    renderMe()
    const security = await screen.findByRole('region', { name: '账号安全' })

    expect(within(security).queryByLabelText('当前密码')).not.toBeInTheDocument()
    expect(within(security).queryByRole('button', { name: '发送邮箱验证码' })).not.toBeInTheDocument()

    await user.click(within(security).getAllByRole('button', { name: '修改密码' })[0]!)
    expect(within(security).getByLabelText('当前密码')).toBeInTheDocument()
    expect(within(security).queryByRole('button', { name: '发送邮箱验证码' })).not.toBeInTheDocument()

    await user.click(within(security).getByRole('button', { name: '忘记当前密码' }))
    expect(within(security).queryByLabelText('当前密码')).not.toBeInTheDocument()
    expect(within(security).getByRole('button', { name: '发送邮箱验证码' })).toBeInTheDocument()

    await user.click(within(security).getByRole('button', { name: '取消' }))
    expect(within(security).queryByLabelText('当前密码')).not.toBeInTheDocument()
    expect(within(security).queryByRole('button', { name: '发送邮箱验证码' })).not.toBeInTheDocument()

    await user.click(within(security).getAllByRole('button', { name: '修改密码' })[0]!)
    expect(within(security).getByLabelText('当前密码')).toBeInTheDocument()
    expect(within(security).queryByRole('button', { name: '发送邮箱验证码' })).not.toBeInTheDocument()

    await user.click(within(security).getByRole('button', { name: '取消' }))
    expect(within(security).queryByLabelText('当前密码')).not.toBeInTheDocument()
  })

  it('shows password security status and changes a password with the current password', async () => {
    const user = userEvent.setup()
    loginAs(0)
    renderMe()
    const security = await screen.findByRole('region', { name: '账号安全' })
    expect(screen.getByText('密码已设置')).toBeInTheDocument()
    await user.click(within(security).getAllByRole('button', { name: '修改密码' })[0]!)
    await user.type(within(security).getByLabelText('当前密码'), 'old secret')
    await user.type(within(security).getByLabelText(/^新密码/), 'secret 123')
    await user.type(within(security).getByLabelText('确认新密码'), 'secret 123')
    await user.click(within(security).getAllByRole('button', { name: '修改密码' })[1]!)
    expect(authService.setPassword).toHaveBeenCalledWith(expect.anything(), 'secret 123', 'old secret')
    expect(within(security).getByRole('status')).toHaveTextContent('密码已更新')
  })

  it('offers current-password change and inline email reset actions', async () => {
    const user = userEvent.setup()
    vi.mocked(authService.getPasswordStatus).mockResolvedValue({ has_password: true, can_set_password: false, can_set_without_current_password: false })
    loginAs(0)
    renderMe()
    const security = await screen.findByRole('region', { name: '账号安全' })
    expect(within(security).queryByLabelText('当前密码')).not.toBeInTheDocument()
    expect(within(security).queryByRole('button', { name: '发送邮箱验证码' })).not.toBeInTheDocument()
    expect(within(security).getAllByRole('button', { name: '修改密码' })).toHaveLength(1)
    expect(within(security).getByRole('button', { name: '忘记当前密码' })).toBeInTheDocument()
    await user.click(within(security).getByRole('button', { name: '忘记当前密码' }))
    expect(within(security).getByRole('button', { name: '发送邮箱验证码' })).toBeInTheDocument()
    await user.click(within(security).getByRole('button', { name: '发送邮箱验证码' }))
    expect(authService.startPasswordResetChallenge).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestId: expect.any(String),
    }))
    await user.type(within(security).getByRole('textbox', { name: '邮箱验证码' }), '123456')
    await user.click(within(security).getByRole('button', { name: '验证邮箱' }))
    expect(await screen.findByText('邮箱已验证，请设置新密码。')).toBeInTheDocument()
    await user.type(within(security).getByLabelText('新密码'), 'reset secret')
    await user.type(within(security).getByLabelText('确认新密码'), 'reset secret')
    await user.click(within(security).getByRole('button', { name: '保存新密码' }))
    expect(authService.resetPassword).toHaveBeenCalledWith('reset-grant-token', 'reset secret', testAuthSession)
    expect(await within(security).findByRole('status')).toHaveTextContent('密码已保存')
    expect(within(security).queryByLabelText('当前密码')).not.toBeInTheDocument()
    expect(within(security).queryByRole('button', { name: '发送邮箱验证码' })).not.toBeInTheDocument()
  })

  it('requires the current password before submitting an existing password change', async () => {
    const user = userEvent.setup()
    loginAs(0)
    renderMe()
    const security = await screen.findByRole('region', { name: '账号安全' })
    await user.click(within(security).getAllByRole('button', { name: '修改密码' })[0]!)
    await user.type(within(security).getByLabelText(/^新密码/), 'secret 123')
    await user.type(within(security).getByLabelText('确认新密码'), 'secret 123')
    await user.click(within(security).getAllByRole('button', { name: '修改密码' })[1]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入当前密码。')
    expect(authService.setPassword).not.toHaveBeenCalled()
  })

  it('returns all registered-user history to shared source records', async () => {
    const user = userEvent.setup()
    const state = loginAs(0)
    const reviewDraft = adminReviewDrafts[0]!
    persistAppState({ ...state, submissionDrafts: [...state.submissionDrafts, reviewDraft] })
    renderMe()
    expect(await screen.findByRole('heading', { name: '米娅的个人中心' })).toBeInTheDocument()
    const personalNav = screen.getByRole('navigation', { name: '个人资产导航' })
    expect(within(personalNav).getAllByRole('link')[0]).toHaveAttribute('href', '#my-projects')
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('我的作品')
    const myProjects = screen.getByRole('region', { name: '我的作品' })
    expect(within(myProjects).getByText('待审核')).toBeInTheDocument()
    expect(within(myProjects).getByRole('link', { name: '查看审核' })).toHaveAttribute('href', `/submit/new?draft=${reviewDraft.id}`)
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
    expect(within(myProjects).getByRole('link', { name: '继续编辑' })).toHaveAttribute('href', expect.stringContaining('/submit/new?draft=draft-mia-study-review'))
    expect(screen.getByRole('link', { name: '返回比较' })).toHaveAttribute('href', '/compare/comparison-mia-speaking#comparison-decision')
    expect(screen.queryByRole('heading', { name: '平台管理入口' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '我的作品' })).toBeInTheDocument()
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
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('我的作品')
    expect(screen.getByRole('link', { name: '查看我的开发者主页' })).toHaveAttribute('href', '/creator/creator-zhou')
    expect(screen.getAllByRole('link', { name: '更新作品' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '作品更新待办' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '平台管理入口' })).not.toBeInTheDocument()
  })

  it('shows staff tools only to editor or administrator roles', async () => {
    loginAs(2)
    renderMe()
    expect(await screen.findByRole('heading', { name: '我的作品' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('我的作品')
    expect(screen.getByRole('region', { name: '我的作品' })).toHaveTextContent('还没有我的作品')
    expect(await screen.findByRole('heading', { name: '平台管理入口' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /发布审核/ })).toHaveAttribute('href', '/admin/reviews')
    expect(screen.getByRole('link', { name: /状态监测/ })).toHaveAttribute('href', '/admin/status-monitor')
    expect(screen.queryByRole('heading', { name: '作品更新待办' })).not.toBeInTheDocument()
  })
})
