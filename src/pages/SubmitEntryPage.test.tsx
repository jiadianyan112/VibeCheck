import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { projects, prototypeUsers } from '../mocks'
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
  return { router, ...render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  ) }
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
    expect(screen.getByText(/登录后可以保存比较/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '使用米娅账号' }))
    expect(await screen.findByRole('heading', { name: '先检查作品地址' })).toBeInTheDocument()
  })

  it('keeps the complete publication scenario through the login return', () => {
    renderRoute('/submit?scenario=duplicate_project&resumeUrl=https%3A%2F%2Fexample.test%2Ftool')
    expect(screen.getByRole('link', { name: '登录后发布' })).toHaveAttribute(
      'href',
      '/auth?from=%2Fsubmit%3Fscenario%3Dduplicate_project%26resumeUrl%3Dhttps%253A%252F%252Fexample.test%252Ftool',
    )
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
    await user.click(screen.getByRole('button', { name: '继续补充作品信息' }))
    expect(await screen.findByRole('heading', { name: '发布新作品' })).toBeInTheDocument()
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

  it('preserves the URL across a network failure and cross-page remount with a retryable code', async () => {
    loginInStorage()
    const user = userEvent.setup()
    const first = renderRoute('/submit?scenario=network_error')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/network-draft')
    await user.click(screen.getByRole('button', { name: '检查地址' }))
    expect(await screen.findByText('网络连接不可用，已保留当前内容。')).toBeInTheDocument()
    expect(screen.queryByText('VC_NETWORK_UNAVAILABLE')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    first.unmount()

    renderRoute('/submit')
    expect(screen.getByRole('textbox', { name: /^作品地址/ })).toHaveValue('https://example.test/network-draft')
  })

  it('preserves the selected category with the URL across a remount', async () => {
    loginInStorage()
    const user = userEvent.setup()
    const first = renderRoute('/submit')
    await user.selectOptions(screen.getByRole('combobox', { name: /作品品类/ }), 'personal_site_portfolio')
    await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), 'example.test/my-portfolio')
    await user.tab()
    first.unmount()

    renderRoute('/submit')
    expect(screen.getByRole('combobox', { name: /作品品类/ })).toHaveValue('personal_site_portfolio')
    expect(screen.getByRole('textbox', { name: /^作品地址/ })).toHaveValue('https://example.test/my-portfolio')
  })

  it('lets an explicit category link override the persisted entry category', async () => {
    loginInStorage()
    const persisted = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({ ...persisted, submissionEntryCategoryId: 'personal_site_portfolio' }))

    renderRoute('/submit?category=ai_learning_quiz')
    expect(screen.getByRole('combobox', { name: /作品品类/ })).toHaveValue('ai_learning_quiz')
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
    ['/submit', 'example.test/out-of-category/store', '暂不属于社区当前的收录范围。'],
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

  it.each([
    ['/submit?prototypeScenario=publication_duplicate&resumeUrl=https%3A%2F%2Fexample.test%2Fscenario-duplicate&autoCheck=1', '发现已有作品档案。'],
    ['/submit?prototypeScenario=external_link_risk&resumeUrl=https%3A%2F%2Funsafe.example%2Fscenario&autoCheck=1', '检测到外链风险，已阻止继续。'],
  ])('opens the unified %s result without a second tester action', async (path, message) => {
    loginInStorage()
    renderRoute(path)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(persistedDrafts()).toHaveLength(0)
  })

  it('branches a duplicate to details while keeping verification secondary and preserving context', async () => {
    loginInStorage()
    const initialProjectCount = projects.length
    const user = userEvent.setup()
    const { router } = renderRoute('/submit?scenario=duplicate_project')
    const input = screen.getByRole('textbox', { name: /^作品地址/ })
    await user.type(input, 'example.test/my-pdf-tool')
    await user.click(screen.getByRole('button', { name: '检查地址' }))

    const primaryAction = await screen.findByRole('link', { name: '查看已有作品详情' })
    expect(primaryAction).toHaveClass('button--primary')
    expect(screen.getByRole('heading', { name: 'PDF 题库实验室', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('尚未关联作者')).toBeInTheDocument()
    expect(screen.getByText('平台编辑收录')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '继续验证作者身份' })).not.toBeInTheDocument()
    expect(screen.getByText('这不是同一个作品')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /我是该作品作者/ }))
    const verification = screen.getByRole('link', { name: '继续验证作者身份' })
    expect(verification).toHaveClass('weak-link')
    expect(primaryAction.compareDocumentPosition(verification) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(primaryAction)
    expect(await screen.findByRole('heading', { name: 'PDF 题库实验室' })).toBeInTheDocument()
    expect(screen.getByLabelText('发布查重上下文')).toHaveTextContent('https://example.test/my-pdf-tool')
    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByRole('heading', { name: '先检查作品地址' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^作品地址/ })).toHaveValue('https://example.test/my-pdf-tool')
    expect(projects).toHaveLength(initialProjectCount)
    expect(persistedDrafts()).toHaveLength(0)
  })
})
