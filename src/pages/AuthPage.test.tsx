import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../components'
import { AuthSessionProvider, createLoginAction } from '../features'
import { prototypeUsers } from '../mocks'
import * as authService from '../services/authService'
import { AppStateProvider, appReducer, createInitialAppState, persistAppState, useAppState } from '../state'
import { AuthPage, safeReturnPath } from './AuthPage'

vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>()
  return {
    ...actual,
    createAuthRequestId: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
    startEmailChallenge: vi.fn(),
    verifyEmailChallenge: vi.fn(),
    passwordLogin: vi.fn(),
  }
})

const session: authService.AuthSessionDto = {
  authenticated: true,
  user_id: '22222222-2222-4222-8222-222222222222',
  display_name: 'us***@example.com',
  account_status: 'active',
  roles: ['user'],
  primary_role: 'user',
  permissions: ['profile:read', 'interaction:write'],
  session_version: 1,
  csrf_token: 'csrf-token-with-at-least-thirty-two-characters',
  recent_auth_at: '2026-08-11T00:00:00.000Z',
  expires_at: '2026-09-10T00:00:00.000Z',
}

function ReturnProbe() {
  const { state } = useAppState()
  return <main><h1>发布入口</h1><p>身份：{state.session.user?.displayName}</p></main>
}

function renderAuth(initialEntry = '/auth?return_to=%2Fsubmit') {
  return render(
    <AppStateProvider>
      <ToastProvider>
        <AuthSessionProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/submit" element={<ReturnProbe />} />
              <Route path="/projects" element={<h1>作品广场</h1>} />
            </Routes>
          </MemoryRouter>
        </AuthSessionProvider>
      </ToastProvider>
    </AppStateProvider>,
  )
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(authService.startEmailChallenge).mockResolvedValue({
      auth_flow_id: '33333333-3333-4333-8333-333333333333',
      challenge_id: '44444444-4444-4444-8444-444444444444',
      expires_at: '2026-08-11T00:10:00.000Z',
      resend_after: '2026-08-11T00:01:00.000Z',
      masked_email: 'us***@example.com',
    })
    vi.mocked(authService.verifyEmailChallenge).mockResolvedValue({
      purpose: 'login',
      session,
      return_to: '/submit',
    })
    vi.mocked(authService.passwordLogin).mockResolvedValue({
      session,
      return_to: '/submit',
    })
  })

  it('uses password login by default and returns to return_to', async () => {
    const user = userEvent.setup()
    renderAuth()
    expect(screen.getByRole('heading', { name: '邮箱密码登录' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.type(screen.getByLabelText('密码'), 'correct password')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('heading', { name: '发布入口' })).toBeInTheDocument()
    expect(screen.getByText('身份：us***@example.com')).toBeInTheDocument()
    expect(authService.passwordLogin).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'correct password',
      returnTo: '/submit',
    })
  })

  it('completes email OTP login and returns to return_to after selecting OTP mode', async () => {
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('tab', { name: '验证码登录' }))
    expect(screen.getByText('新邮箱验证后自动注册')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByText('验证码已发送至 us***@example.com')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '6 位验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('heading', { name: '发布入口' })).toBeInTheDocument()
    expect(screen.getByText('身份：us***@example.com')).toBeInTheDocument()
    expect(authService.startEmailChallenge).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.com',
      returnTo: '/submit',
    }))
  })

  it('offers an explicit guest path', async () => {
    const user = userEvent.setup()
    renderAuth('/auth?return_to=%2Fnotifications')
    await user.click(screen.getByRole('link', { name: '先逛逛' }))
    expect(screen.getByRole('heading', { name: '作品广场' })).toBeInTheDocument()
  })

  it('describes the signed-in account in natural language', async () => {
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[0]!)))
    renderAuth('/auth')

    expect(await screen.findByRole('heading', { name: '当前账号' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '继续' })).toHaveAttribute('href', '/me')
    expect(screen.queryByText(/Session/)).not.toBeInTheDocument()
    expect(screen.queryByText(/角色版本|受保护操作/)).not.toBeInTheDocument()
  })

  it('rejects unsafe external return paths', () => {
    expect(safeReturnPath('//malicious.test')).toBe('/me')
    expect(safeReturnPath('https://malicious.test')).toBe('/me')
    expect(safeReturnPath('/search?q=quiz')).toBe('/search?q=quiz')
  })

  it('validates the email locally and keeps it editable on failure', async () => {
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('tab', { name: '验证码登录' }))
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'invalid')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入有效的邮箱地址。')
    expect(screen.getByRole('textbox', { name: /^邮箱地址/ })).toHaveFocus()
    expect(authService.startEmailChallenge).not.toHaveBeenCalled()
  })

  it('locks the challenged email and clears the old code when switching email', async () => {
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('tab', { name: '验证码登录' }))
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(screen.getByRole('textbox', { name: /^邮箱地址/ })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: '6 位验证码' })).toHaveFocus()
    await user.type(screen.getByRole('textbox', { name: '6 位验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '更换邮箱' }))
    expect(screen.getByRole('textbox', { name: /^邮箱地址/ })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: /^邮箱地址/ })).not.toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: '6 位验证码' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
  })

  it('keeps the email after a network error and lets the user retry', async () => {
    vi.mocked(authService.startEmailChallenge).mockRejectedValueOnce(
      new authService.AuthApiError('NETWORK_UNAVAILABLE', 0, null, true, null),
    )
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('tab', { name: '验证码登录' }))
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接不可用')
    expect(screen.getByRole('textbox', { name: /^邮箱地址/ })).toHaveValue('user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByText('验证码已发送至 us***@example.com')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '6 位验证码' })).toHaveFocus()
  })

  it('blocks resending during the server cooldown while allowing verification', async () => {
    vi.mocked(authService.startEmailChallenge).mockResolvedValueOnce({
      auth_flow_id: '33333333-3333-4333-8333-333333333333',
      challenge_id: '44444444-4444-4444-8444-444444444444',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      resend_after: new Date(Date.now() + 60_000).toISOString(),
      masked_email: 'us***@example.com',
    })
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('tab', { name: '验证码登录' }))
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(screen.getByRole('button', { name: /秒后重新发送/ })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '6 位验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('heading', { name: '发布入口' })).toBeInTheDocument()
  })

  it('allows a signed-in user to replace the current session through forced OTP mode', async () => {
    const user = userEvent.setup()
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[0]!)))
    renderAuth('/auth?mode=otp&return_to=%2Fsubmit')
    expect(screen.getByRole('heading', { name: '邮箱验证码登录' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'new@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await user.type(screen.getByRole('textbox', { name: '6 位验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('heading', { name: '发布入口' })).toBeInTheDocument()
    expect(screen.getByText('身份：us***@example.com')).toBeInTheDocument()
  })

  it('sends forgot-password users to the forced OTP flow for password security settings', async () => {
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('link', { name: '忘记密码？使用验证码登录' }))
    expect(screen.getByRole('heading', { name: '邮箱验证码登录' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(authService.startEmailChallenge).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.com',
      returnTo: '/me#security',
    }))
  })
})
