import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../components'
import { AuthSessionProvider } from '../features'
import * as authService from '../services/authService'
import { AppStateProvider, useAppState } from '../state'
import { AuthPage, safeReturnPath } from './AuthPage'

vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>()
  return {
    ...actual,
    createAuthRequestId: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
    startEmailChallenge: vi.fn(),
    verifyEmailChallenge: vi.fn(),
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
  })

  it('completes email OTP login and returns to return_to', async () => {
    const user = userEvent.setup()
    renderAuth()
    expect(screen.getByText(/无需密码/)).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^邮箱地址/ }), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByText('验证码已发送至 us***@example.com')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '6 位验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '验证并登录' }))
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
    await user.click(screen.getByRole('button', { name: '先以游客身份浏览' }))
    expect(screen.getByRole('heading', { name: '作品广场' })).toBeInTheDocument()
  })

  it('rejects unsafe external return paths', () => {
    expect(safeReturnPath('//malicious.test')).toBe('/me')
    expect(safeReturnPath('https://malicious.test')).toBe('/me')
    expect(safeReturnPath('/search?q=quiz')).toBe('/search?q=quiz')
  })
})
