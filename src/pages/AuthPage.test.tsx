import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AppStateProvider, useAppState } from '../state'
import { AuthPage, safeReturnPath } from './AuthPage'

function ReturnProbe() {
  const { state } = useAppState()
  return <main><h1>发布入口</h1><p>身份：{state.session.user?.displayName}</p><p>收藏：{state.favoriteProjectIds.length}</p></main>
}

function renderAuth(initialEntry = '/auth?from=%2Fsubmit') {
  return render(
    <AppStateProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/submit" element={<ReturnProbe />} />
            <Route path="/projects" element={<h1>作品广场</h1>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </AppStateProvider>,
  )
}

describe('AuthPage', () => {
  beforeEach(() => localStorage.clear())

  it('loads the selected account assets and returns to the from route', async () => {
    const user = userEvent.setup()
    renderAuth()
    expect(screen.getByText('低保真原型不收集密码，也不会创建真实账户；选择身份后会回到 from 指定的页面。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '使用米娅测试身份' }))
    expect(screen.getByRole('heading', { name: '发布入口' })).toBeInTheDocument()
    expect(screen.getByText('身份：米娅')).toBeInTheDocument()
    expect(screen.getByText('收藏：3')).toBeInTheDocument()
  })

  it('offers an explicit guest path', async () => {
    const user = userEvent.setup()
    renderAuth('/auth?from=%2Fnotifications')
    await user.click(screen.getByRole('button', { name: '以游客身份继续' }))
    expect(screen.getByRole('heading', { name: '作品广场' })).toBeInTheDocument()
  })

  it('rejects unsafe external return paths', () => {
    expect(safeReturnPath('//malicious.test')).toBe('/projects')
    expect(safeReturnPath('https://malicious.test')).toBe('/projects')
  })
})
