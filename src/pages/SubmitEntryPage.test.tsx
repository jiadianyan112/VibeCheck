import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { configureServiceRuntime, submissionService } from '../services'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'

function loginInStorage() {
  const state = appReducer(createInitialAppState(), {
    type: 'LOGIN_COMPLETED',
    user: prototypeUsers[0]!,
  })
  persistAppState(state)
}

function renderRoute(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

function persistedDrafts() {
  const raw = localStorage.getItem(APP_STORAGE_KEY)
  return raw ? JSON.parse(raw).submissionDrafts : []
}

describe('submission entry and URL checks', () => {
  beforeEach(() => {
    localStorage.clear()
    configureServiceRuntime({ defaultDelayMs: 0 })
  })

  it('logs in with a fixed identity and returns to the protected publish entry', async () => {
    const user = userEvent.setup()
    renderRoute('/auth?from=%2Fsubmit')
    expect(screen.getByText('/submit')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /米娅/ }))
    expect(await screen.findByRole('heading', { name: '先检查作品地址' })).toBeInTheDocument()
  })

  it('completes a missing protocol and updates one stable draft on repeated saves', async () => {
    loginInStorage()
    const user = userEvent.setup()
    renderRoute('/submit')
    const input = screen.getByRole('textbox', { name: /^作品地址/ })
    await user.type(input, 'example.test/new-learning-tool')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('地址检查通过')).toBeInTheDocument()
    expect(input).toHaveValue('https://example.test/new-learning-tool')
    await user.click(screen.getByRole('button', { name: '保存地址草稿' }))
    await user.click(screen.getByRole('button', { name: '草稿已保存' }))
    await waitFor(() => expect(persistedDrafts()).toHaveLength(1))
  })

  it('does not create a draft for an invalid URL', async () => {
    loginInStorage()
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'not-a-public-host')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入可识别的 HTTP 或 HTTPS')
    expect(screen.getByRole('button', { name: '检查地址' })).toBeDisabled()
    expect(persistedDrafts()).toHaveLength(0)
  })

  it('allows a first timeout to be saved but blocks direct continuation', async () => {
    loginInStorage()
    const user = userEvent.setup()
    renderRoute('/submit?scenario=timeout')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/slow-tool')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('暂时无法验证访问状态。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续发布' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '保存地址草稿' }))
    await waitFor(() => expect(persistedDrafts()[0].validationErrors.publicUrl).toContain('超时'))
  })

  it('cancels an in-flight check without creating a draft or duplicate request', async () => {
    loginInStorage()
    configureServiceRuntime({ defaultDelayMs: 200 })
    const checkSpy = vi.spyOn(submissionService, 'checkUrl')
    const user = userEvent.setup()
    renderRoute('/submit')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/cancelled')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    await user.click(screen.getByRole('button', { name: '取消检查' }))
    expect(await screen.findByText('检查已取消')).toBeInTheDocument()
    expect(checkSpy).toHaveBeenCalledTimes(1)
    expect(persistedDrafts()).toHaveLength(0)
    checkSpy.mockRestore()
  })

  it.each([
    ['/submit?scenario=external_link_risk', 'unsafe.example/tool', '检测到外链风险，已阻止继续。'],
    ['/submit', 'example.test/out-of-category/store', '不属于首期学习与题库品类。'],
    ['/submit?scenario=duplicate_project', 'example.test/copied-tool', '发现已有作品档案。'],
  ])('keeps the %s check scenario reproducible', async (path, value, message) => {
    loginInStorage()
    const user = userEvent.setup()
    renderRoute(path)
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), value)
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存地址草稿' })).not.toBeInTheDocument()
  })
})
