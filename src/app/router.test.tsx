import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AppStateProvider } from '../state'
import { appRoutes } from './router'

function renderRoute(path: string) {
  const memoryRouter = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AppStateProvider>
      <ToastProvider>
        <RouterProvider router={memoryRouter} />
      </ToastProvider>
    </AppStateProvider>,
  )
}

describe('application route skeleton', () => {
  it.each([
    ['/projects', 'P01 作品广场'],
    ['/discover', 'P06 查同类意图确认'],
    ['/project/project-001', 'P08 作品详情'],
    ['/compare/session-001', 'P09 作品比较'],
    ['/admin/project/project-001', 'A03 作品编辑'],
  ])('renders %s', (path, heading) => {
    renderRoute(path)
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('shows dynamic route parameters', () => {
    renderRoute('/project/project-001')
    expect(screen.getByText('project-001')).toBeInTheDocument()
  })

  it('renders a useful not found page', () => {
    renderRoute('/not-a-real-route')
    expect(screen.getByRole('heading', { name: '404 页面不存在' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回作品广场' })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  it('renders the shared frontstage navigation with active state', () => {
    renderRoute('/projects')
    const mainNavigation = screen.getByRole('navigation', { name: '主导航' })
    const projectLink = mainNavigation.querySelector('a[href="/projects"]')
    expect(projectLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '发布' })).toHaveAttribute(
      'href',
      '/auth?from=%2Fsubmit',
    )
  })

  it('renders a separate admin navigation', () => {
    renderRoute('/admin/projects')
    expect(screen.getByRole('navigation', { name: '后台导航' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /返回前台/ })).toHaveAttribute(
      'href',
      '/projects',
    )
  })
})
