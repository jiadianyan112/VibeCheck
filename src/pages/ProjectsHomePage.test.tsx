import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { configureServiceRuntime } from '../services'
import { projects, prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY } from '../state'

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
    expect(screen.getByRole('button', { name: '作品墓地' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '作品墓地' })).toBeInTheDocument()
    expect(screen.getByText('记录 Vibe Coding 过程中因各种原因结束的作品，保留它们的尝试、经验与可复用成果。')).toBeInTheDocument()
    expect(within(feed).getAllByRole('article')).toHaveLength(projects.filter((p) => p.accessStatus.state === 'known' && p.accessStatus.value === 'ended').length)
  })

  it('keeps guest likes gated and comparison controls functional', async () => {
    const user = userEvent.setup()
    renderHome()
    const feed = await screen.findByRole('region', { name: '作品列表' })
    const card = within(feed).getByRole('link', { name: 'Paper to Practice' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: '点赞' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '暂不登录' }))
    await user.click(within(card).getByRole('button', { name: '加入比较' }))
    expect(within(card).getByRole('button', { name: '移出比较' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the like count when moving from the plaza to detail and back', async () => {
    const user = userEvent.setup()
    const project = projects.find((item) => item.id === 'project-quizforge')!
    const baseLikeCount = project.interactionSummary.likeCount
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      session: { user: prototypeUsers[0], role: 'user' },
      likedProjectIds: [],
    }))

    const router = renderHome()
    const feed = await screen.findByRole('region', { name: '作品列表' })
    const card = within(feed).getByRole('link', { name: '题练工坊' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: '点赞' }))
    expect(within(card).getByRole('button', { name: '取消点赞' })).toHaveTextContent(String(baseLikeCount + 1))

    await user.click(within(card).getByRole('link', { name: '题练工坊' }))
    expect(await screen.findByRole('heading', { name: '题练工坊' })).toBeInTheDocument()
    const detailInteractions = screen.getByRole('region', { name: '社区互动' })
    expect(within(detailInteractions).getByText(String(baseLikeCount + 1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已点赞' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: '作品广场' })[0]!)
    const returnedFeed = await screen.findByRole('region', { name: '作品列表' })
    const returnedCard = within(returnedFeed).getByRole('link', { name: '题练工坊' }).closest('article')!
    const cancelLike = within(returnedCard).getByRole('button', { name: '取消点赞' })
    expect(cancelLike).toHaveTextContent(String(baseLikeCount + 1))
    await user.click(cancelLike)
    expect(within(returnedCard).getByRole('button', { name: '点赞' })).toHaveTextContent(String(baseLikeCount))
    expect(router.state.location.pathname).toBe('/projects')
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
