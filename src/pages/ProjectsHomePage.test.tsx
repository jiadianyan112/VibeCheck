import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { configureServiceRuntime } from '../services'
import { projects } from '../mocks'

function renderHome(path = '/projects') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  return router
}

describe('ProjectsHomePage discovery feed', () => {
  beforeAll(() => configureServiceRuntime({ defaultDelayMs: 0 }))
  beforeEach(() => localStorage.clear())

  it('shows each project once with a direct detail destination', async () => {
    renderHome()
    const feed = await screen.findByRole('region', { name: '作品列表' })
    expect(within(feed).getAllByRole('article')).toHaveLength(projects.length)
    const names = within(feed).getAllByRole('heading', { level: 2 })
    expect(new Set(names.map((name) => name.textContent)).size).toBe(projects.length)
    expect(within(feed).getByRole('link', { name: '题练工坊' })).toHaveAttribute('href', '/project/project-quizforge')
  })

  it('filters by category and preserves it when sorting through the URL', async () => {
    const user = userEvent.setup()
    const router = renderHome()
    await screen.findByRole('region', { name: '作品列表' })
    await user.click(screen.getByRole('button', { name: '个人主页' }))
    expect(router.state.location.search).toContain('channel=portfolio')
    const feed = screen.getByRole('region', { name: '作品列表' })
    expect(within(feed).getAllByRole('article')).toHaveLength(projects.filter((p) => p.categoryId === 'personal_site_portfolio').length)
    expect(within(feed).queryByRole('link', { name: '题练工坊' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('作品排序'), 'latest')
    expect(router.state.location.search).toContain('channel=portfolio')
    expect(router.state.location.search).toContain('sort=latest')
  })

  it('restores reusable and ended filters from a shared URL', async () => {
    renderHome('/projects?channel=ended')
    const feed = await screen.findByRole('region', { name: '作品列表' })
    expect(screen.getByRole('button', { name: '已结束' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(feed).getAllByRole('article')).toHaveLength(projects.filter((p) => p.accessStatus.state === 'known' && p.accessStatus.value === 'ended').length)
  })

  it('keeps guest favorites gated and comparison controls functional', async () => {
    const user = userEvent.setup()
    renderHome()
    const feed = await screen.findByRole('region', { name: '作品列表' })
    const card = within(feed).getByRole('link', { name: 'Paper to Practice' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: '收藏' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '暂不登录' }))
    await user.click(within(card).getByRole('button', { name: '加入比较' }))
    expect(within(card).getByRole('button', { name: '移出比较' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps errors actionable', async () => {
    localStorage.setItem('vibecheck-prototype-state-v1', JSON.stringify({ schemaVersion: 1, serviceScenario: 'network_error' }))
    const user = userEvent.setup()
    renderHome()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('region', { name: '作品列表' })).toBeInTheDocument()
  })

  it('offers category and publishing routes when the collection is empty', async () => {
    localStorage.setItem('vibecheck-prototype-state-v1', JSON.stringify({ schemaVersion: 1, serviceScenario: 'empty_results' }))
    renderHome()
    expect(await screen.findByRole('heading', { name: '暂时没有可展示的作品' })).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: '浏览全部分类' })).toHaveAttribute('href', '/categories')
    expect(within(main).getByRole('link', { name: '发布作品' })).toHaveAttribute('href', '/auth?return_to=%2Fsubmit')
  })
})
