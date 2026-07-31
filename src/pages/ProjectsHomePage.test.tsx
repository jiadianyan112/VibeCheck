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
    const headings = screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent)
    expect(headings).toEqual(['编辑精选', '最新发布', '最近更新', '开源可复用', '按问题探索', '已结束，但仍可复用'])
    expect(screen.queryByText(/综合热度榜/)).not.toBeInTheDocument()
  })

  it('links search, category, publishing, project detail and comparison', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    const picks = await screen.findByRole('heading', { name: '编辑精选' })
    const section = picks.closest('section')!
    expect(within(section).getAllByRole('link')[0]).toHaveAttribute('href', expect.stringMatching(/^\/project\//))
    expect(screen.getByRole('link', { name: 'PDF 出题' })).toHaveAttribute('href', '/search?q=PDF%20%E5%87%BA%E9%A2%98')
    expect(screen.getAllByRole('link', { name: '发布作品' }).some((link) => link.getAttribute('href') === '/auth?from=%2Fsubmit')).toBe(true)
    expect(screen.getByRole('link', { name: /把 PDF 变成题库/ })).toHaveAttribute('href', '/categories/pdf-to-quiz')
  })
})
