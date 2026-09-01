import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { configureServiceRuntime } from '../services'
import { useAppState } from '../state'

function StateProbe() {
  const { state } = useAppState()
  return <output data-testid="state-probe">{JSON.stringify({ events: state.eventLog.map((event) => event.name), comparisons: state.comparisonProjectIds })}</output>
}

describe('ProjectsHomePage', () => {
  beforeAll(() => configureServiceRuntime({ defaultDelayMs: 0 }))
  beforeEach(() => localStorage.clear())

  it('renders the high-fidelity editorial landmarks', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /><StateProbe /></AppProviders>)

    await screen.findByRole('heading', { name: '编辑精选' })
    expect(screen.getByRole('heading', { level: 1, name: /先看看别人怎么做/ })).toBeInTheDocument()
    expect(screen.getByLabelText('本周作品舞台')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '最新发布作品' })).toHaveAttribute('tabindex', '0')
    expect(document.querySelector('.project-card--featured')).not.toBeNull()
    expect(document.querySelector('.highfi-scope')).not.toBeNull()

    const hero = document.querySelector('.editorial-hero') as HTMLElement
    expect(within(hero).getAllByRole('search')).toHaveLength(1)
    expect(hero.querySelectorAll('[aria-label="快捷问题"]')).toHaveLength(1)
    expect(within(hero).getByRole('link', { name: '发布作品' })).toHaveAttribute('href', '/auth?return_to=%2Fsubmit')
    expect(screen.getByLabelText('本周作品舞台').querySelectorAll('.project-media-stage')).toHaveLength(3)

    const editorPicks = document.querySelector('#editor-picks')!
    expect(editorPicks.querySelector('.project-card')?.classList).toContain('project-card--featured')
    expect(JSON.parse(screen.getByTestId('state-probe').textContent ?? '{}').events).toContain('home_viewed')

    const contentSections = Array.from(document.querySelectorAll('.home-section'))
    expect(contentSections).toHaveLength(7)
    contentSections.forEach((section) => {
      const headingId = section.getAttribute('aria-labelledby')
      expect(headingId).toBeTruthy()
      expect(document.getElementById(headingId ?? '')?.tagName).toBe('H2')
      const header = section.querySelector('header')!
      expect(header.querySelectorAll('.project-card, .marquee-strip')).toHaveLength(0)
      expect(header.querySelector('.home-section__body')).toBeNull()
      expect(section.querySelector(':scope > .home-section__body')).not.toBeNull()
    })
  })

  it('keeps homepage interactions outside reveal wrappers', async () => {
    const user = userEvent.setup()
    localStorage.setItem('vibecheck-prototype-state-v1', JSON.stringify({
      schemaVersion: 1,
      session: {
        user: { id: 'user-home-test', displayName: '首页测试用户', role: 'user', creatorId: null },
        role: 'user',
      },
    }))
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /><StateProbe /></AppProviders>)

    const loading = screen.getByRole('status', { name: '作品广场加载中' })
    expect(loading.closest('.reveal')).toBeNull()
    const picks = await screen.findByRole('heading', { name: '编辑精选' })
    const section = picks.closest('section')!
    expect(within(section).getAllByRole('button', { name: '收藏' })).toHaveLength(3)
    await user.click(within(section).getAllByRole('button', { name: '收藏' })[0]!)
    expect(JSON.parse(screen.getByTestId('state-probe').textContent ?? '{}').events).toContain('project_favorited')
    await user.click(within(section).getAllByRole('button', { name: '加入比较' })[1]!)
    expect(screen.getByRole('complementary', { name: '当前比较栏' })).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('state-probe').textContent ?? '{}').events).toContain('comparison_added')
    expect(section.closest('.reveal')).toBeNull()
  })

  it('keeps the service error state outside reveal wrappers', async () => {
    localStorage.setItem('vibecheck-prototype-state-v1', JSON.stringify({ schemaVersion: 1, serviceScenario: 'network_error' }))
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    const error = await screen.findByRole('alert')
    expect(error.closest('.reveal')).toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('renders a focused recovery state for empty results without empty content sections', async () => {
    localStorage.setItem('vibecheck-prototype-state-v1', JSON.stringify({ schemaVersion: 1, serviceScenario: 'empty_results' }))
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)

    const home = await screen.findByRole('main')
    expect(within(home).getByRole('heading', { name: '暂时没有可展示的作品' })).toBeInTheDocument()
    expect(within(home).queryByRole('heading', { name: '编辑精选' })).not.toBeInTheDocument()
    expect(within(home).getAllByRole('search')).toHaveLength(1)
    expect(within(home).getByLabelText('快捷问题')).toBeInTheDocument()
    expect(within(home).getByRole('link', { name: '浏览全部分类' })).toHaveAttribute('href', '/categories')
    expect(within(home).getByRole('link', { name: '查看个人主页与作品集' })).toHaveAttribute('href', '/categories/personal-sites-portfolios')
    expect(within(home).getByRole('link', { name: '探索作品' })).toBeInTheDocument()
    expect(within(home).getByRole('link', { name: '发布作品' })).toHaveAttribute('href', '/auth?return_to=%2Fsubmit')
  })

  it('renders homepage modules in the required order', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    await screen.findByRole('heading', { name: '编辑精选' })
    expect(screen.getByText('Vibe Coding 作品社区')).toBeInTheDocument()
    expect(screen.getByText(/发现 Vibe Coding 作品、创作者和构建工具/)).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent)
    expect(headings).toEqual(['个人主页与作品集', '编辑精选', '最新发布', '最近更新', '开源可复用', '按问题与品类探索', '已结束，但仍可复用'])
    expect(screen.queryByText(/综合热度榜/)).not.toBeInTheDocument()
  })

  it('links search, category, publishing, project detail and comparison', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    const picks = await screen.findByRole('heading', { name: '编辑精选' })
    const section = picks.closest('section')!
    expect(within(section).getAllByRole('link')[0]).toHaveAttribute('href', expect.stringMatching(/^\/project\//))
    expect(screen.getByRole('link', { name: 'PDF 出题' })).toHaveAttribute('href', '/search?q=PDF%20%E5%87%BA%E9%A2%98')
    expect(screen.getAllByRole('link', { name: '发布作品' }).some((link) => link.getAttribute('href') === '/auth?return_to=%2Fsubmit')).toBe(true)
    expect(screen.getByRole('link', { name: /把 PDF 变成题库/ })).toHaveAttribute('href', '/categories/pdf-to-quiz')
  })

  it('shows the newest verified public portfolios on the homepage', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    const heading = await screen.findByRole('heading', { name: '个人主页与作品集' })
    const section = heading.closest('section')!
    expect(within(section).getByRole('link', { name: 'Haoqi Wen' })).toHaveAttribute('href', '/project/project-haoqi-design')
    expect(within(section).getByRole('link', { name: '罗丹 Rodin' })).toHaveAttribute('href', '/project/project-rodin-portfolio')
  })

  it('shows creators and Vibe Coding tools instead of archive metadata on homepage cards', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    const picks = await screen.findByRole('heading', { name: '编辑精选' })
    const section = picks.closest('section')!

    expect(within(section).getByRole('link', { name: '林序，已验证' })).toHaveAttribute('href', '/creator/creator-lin')
    expect(within(section).getAllByText('Cursor').length).toBeGreaterThan(0)
    expect(within(section).getByText('Claude Code')).toBeInTheDocument()
    expect(within(section).queryByText('资料完整')).not.toBeInTheDocument()
    expect(within(section).queryByText(/核验于/)).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /查看来源/ })).not.toBeInTheDocument()
  })
})
