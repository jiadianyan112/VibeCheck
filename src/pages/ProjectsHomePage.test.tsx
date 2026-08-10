import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { configureServiceRuntime } from '../services'

describe('ProjectsHomePage', () => {
  beforeAll(() => configureServiceRuntime({ defaultDelayMs: 0 }))
  beforeEach(() => localStorage.clear())

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
