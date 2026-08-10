import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createComparisonSession } from '../features'
import { createInitialAppState, persistAppState } from '../state'
import { comparisonSessionId, projectId } from '../types'

function renderPage(path = '/compare/comparison-anonymous-pdf') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const view = render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  return { router, ...view }
}

describe('CompareSessionPage management', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  function seedSession(value: string, ids: ReturnType<typeof projectId>[]) {
    const id = comparisonSessionId(value)
    const fallback = createInitialAppState()
    const session = createComparisonSession({ id, projectIds: ids, sourcePath: '/projects', now: '2026-07-31T10:00:00+08:00' })
    persistAppState({ ...fallback, activeComparisonSessionId: id, comparisonProjectIds: ids, comparisonSessions: [...fallback.comparisonSessions, session] })
    return id
  }

  it('restores a routed session and exposes its stable share path', async () => {
    renderPage('/compare/comparison-mia-speaking')
    expect(await screen.findByRole('heading', { name: '比较会话' })).toBeInTheDocument()
    expect(screen.getByText('当前链接可继续访问')).toBeInTheDocument()
    expect(screen.getByText('3/5 个作品')).toBeInTheDocument()
    expect(screen.getByText('作品已选好，可以开始比较。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '结构化比较' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '关键差异摘要' })).toBeInTheDocument()
    expect(screen.getByText('摘要只基于当前选择的作品，不要求提交额外判断。')).toBeInTheDocument()
    expect(screen.getByText('完整字段矩阵')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '查看完整字段' }))
    expect(screen.getByText('完整字段矩阵').closest('details')).toHaveAttribute('open')
    expect(screen.getByRole('navigation', { name: '比较维度' })).toHaveTextContent('定位输入输出流程功能实现当前状态可复用资产')
    expect(screen.getByRole('group', { name: '比较显示范围' })).toBeInTheDocument()
  })

  it('reorders, replaces, removes, adds and carries the guest selection into email login', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()
    await user.click(screen.getByText('管理比较作品', { selector: 'summary strong' }))
    const list = await screen.findByRole('list', { name: '已选比较作品' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('题练工坊')
    await user.click(screen.getByRole('button', { name: '下移题练工坊' }))
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('题练工坊')

    await user.click(within(list).getAllByRole('button', { name: '替换' })[0]!)
    await user.selectOptions(screen.getByLabelText(/替换/), 'project-papertopractice')
    expect(within(list).getByText('Paper to Practice')).toBeInTheDocument()

    await user.click(within(list).getAllByRole('button', { name: '移除' })[0]!)
    expect(screen.getByText('1/5 个作品')).toBeInTheDocument()
    expect(screen.getByText('至少选择两个可用作品后才能开始比较。')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('添加一个作品'), 'project-speakmirror')
    expect(screen.getByText('2/5 个作品')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '登录并保存比较' }))
    expect(await screen.findByRole('heading', { name: '邮箱验证码登录' })).toBeInTheDocument()
    expect(screen.getByText(/当前 2 个临时比较作品会在本设备保留/)).toBeInTheDocument()
    expect(router.state.location.search).toContain('return_to=')
  })

  it('offers a recovery path for an unknown session', async () => {
    renderPage('/compare/comparison-missing')
    expect(await screen.findByText('比较会话不存在')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回选择作品' })).toHaveAttribute('href', '/projects')
  })

  it('switches from differences to collapsible equal rows and links assets', async () => {
    const user = userEvent.setup()
    renderPage('/compare/comparison-mia-speaking')
    await screen.findByRole('heading', { name: '结构化比较' })
    expect(screen.getByRole('button', { name: '仅看差异' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '查看全部' }))
    expect(screen.getAllByText(/各作品相同，点击展开/).length).toBeGreaterThan(0)
    expect(document.getElementById('comparison-assets-heading')).toHaveTextContent('可复用资产')
    expect(screen.getAllByRole('link', { name: /项资产/ }).length).toBeGreaterThan(0)
  })

  it('shows unknown, expired and abnormal states without hiding other dimensions', async () => {
    const ids = [projectId('project-dailydrill'), projectId('project-learntrack')]
    const id = seedSession('comparison-trust-edges', ids)
    renderPage(`/compare/${id}`)
    await screen.findByRole('heading', { name: '结构化比较' })
    expect(screen.getAllByText('资料已过期').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/未知：/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('链接不可用').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '实现' })).toHaveAttribute('href', '#dimension-implementation')
    expect(screen.getByRole('link', { name: '可复用资产' })).toHaveAttribute('href', '#dimension-assets')
  })

  it('compares only the selected projects without requiring an action record', async () => {
    renderPage('/compare/comparison-mia-speaking')
    expect(await screen.findByRole('heading', { name: '结构化比较' })).toBeInTheDocument()
    expect(screen.getByText('摘要只基于当前选择的作品，不要求提交额外判断。')).toBeInTheDocument()
    expect(screen.getByText('当前仅比较你选择的 3 个作品。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '记录比较后的行动' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '完成并私密保存' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '记录行动' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('判断理由')).not.toBeInTheDocument()
  })

  it('handles zero and one valid project without rendering a formal matrix', async () => {
    const zeroId = seedSession('comparison-zero', [])
    const { unmount } = renderPage(`/compare/${zeroId}`)
    expect(await screen.findByText('还没有选择比较作品')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '结构化比较' })).not.toBeInTheDocument()
    unmount()
    localStorage.clear()
    const oneId = seedSession('comparison-one', [projectId('project-quizforge')])
    renderPage(`/compare/${oneId}`)
    expect(await screen.findByText('还不能开始比较')).toBeInTheDocument()
    expect(screen.getByText('当前只有一个作品，请再添加一个。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '结构化比较' })).not.toBeInTheDocument()
  })

  it('keeps a deleted project placeholder and offers replacement or removal', async () => {
    const id = seedSession('comparison-deleted-project', [projectId('project-quizforge'), projectId('project-deleted')])
    renderPage(`/compare/${id}`)
    expect(await screen.findByText('已删除作品')).toBeInTheDocument()
    expect(screen.getByText(/原作品档案已删除或不可用/)).toBeInTheDocument()
    expect(screen.getByText('有 1 个作品档案不可用')).toBeInTheDocument()
    expect(screen.getByText('还不能开始比较')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '替换' })).toHaveLength(2)
  })

  it('renders vertical dimensions with a horizontal work switch on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, media: '(max-width: 48rem)', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })))
    const user = userEvent.setup()
    renderPage('/compare/comparison-mia-speaking')
    const switcher = await screen.findByRole('tablist', { name: '移动端作品切换' })
    expect(within(switcher).getAllByRole('tab')).toHaveLength(3)
    expect(screen.queryByLabelText('3 个作品的横向比较表')).not.toBeInTheDocument()
    await user.click(within(switcher).getByRole('tab', { name: 'EchoScore' }))
    expect(within(switcher).getByRole('tab', { name: 'EchoScore' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'EchoScore的比较字段' })).toHaveTextContent('已结束')
    expect(screen.getByRole('tabpanel', { name: 'EchoScore的比较字段' })).toHaveTextContent('定位')
  })
})
