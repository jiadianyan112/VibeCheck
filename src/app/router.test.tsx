import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from './providers'
import { appRoutes } from './router'
import { prototypeUsers } from '../mocks'
import { appReducer, createInitialAppState, persistAppState } from '../state'
import { createLoginAction } from '../features/auth/session'

function renderRoute(path: string) {
  const memoryRouter = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AppProviders>
      <RouterProvider router={memoryRouter} />
    </AppProviders>,
  )
}

describe('application route skeleton', () => {
  beforeEach(() => localStorage.clear())

  it.each([
    ['/projects', '先看看别人怎么做，再决定自己怎么做。'],
    ['/discover', '先确认你要解决的问题'],
    ['/discover/result', '同类作品分析'],
    ['/project/project-quizforge', '题练工坊'],
    ['/compare/comparison-anonymous-pdf', '比较会话'],
    ['/submit', '发布作品'],
    ['/auth?from=%2Fsubmit', '选择原型身份'],
  ])('renders %s', async (path, heading) => {
    renderRoute(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('shows a useful error for an unknown project id', async () => {
    renderRoute('/project/project-001')
    expect(await screen.findByText('未找到对应作品档案。')).toBeInTheDocument()
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
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[2]!)))
    renderRoute('/admin/projects')
    expect(screen.getByRole('navigation', { name: '后台导航' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /返回前台/ })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  it('renders an admin route for a staff identity', async () => {
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[2]!)))
    renderRoute('/admin/project/project-quizforge')
    expect(await screen.findByRole('heading', { name: '编辑 题练工坊' })).toBeInTheDocument()
  })

  it('redirects a guest admin request to the identity simulator', async () => {
    renderRoute('/admin/projects')
    expect(await screen.findByRole('heading', { name: '选择原型身份' })).toBeInTheDocument()
    expect(screen.getByText('/admin/projects')).toBeInTheDocument()
  })
})
