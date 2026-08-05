import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { projects, prototypeUsers } from '../mocks'
import { appReducer, createInitialAppState, persistAppState } from '../state'

function renderAdmin(path: string, userIndex = 2) {
  persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[userIndex]!)))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  return { ...result, router }
}

describe('T47 admin dashboard and project queue', () => {
  beforeEach(() => localStorage.clear())

  it('shows only simulated queue counts and actionable work links', async () => {
    renderAdmin('/admin')
    expect(await screen.findByRole('heading', { name: '后台首页／数据看板' })).toBeInTheDocument()
    expect(screen.getByText(`模拟数据 · ${prototypeUsers[2]!.displayName}`)).toBeInTheDocument()
    expect(screen.getByText('同源作品档案').parentElement).toHaveTextContent(String(projects.length))
    expect(screen.getAllByRole('link', { name: '进入队列' }).some((link) => link.getAttribute('href') === '/admin/projects?pending=1')).toBe(true)
    expect(screen.getByText(/不代表真实流量、市场规模或业务结论/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the full same-source queue and enters A03 through a stable project id', async () => {
    const user = userEvent.setup()
    const { router } = renderAdmin('/admin/projects')
    expect(await screen.findByRole('heading', { name: '作品列表' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(projects.length + 1)
    const row = screen.getByRole('row', { name: /题练工坊/ })
    expect(within(row).getByText('作者发布')).toBeInTheDocument()

    await user.click(within(row).getByRole('link', { name: '进入编辑' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/project/project-quizforge'))
    expect(await screen.findByRole('heading', { name: '编辑 题练工坊' })).toBeInTheDocument()
  })

  it('reproduces combined filters from the URL and exposes an explicit empty exit', async () => {
    const { router } = renderAdmin('/admin/projects?category=speaking_mock_exam&access=ended&author=linked')
    expect(await screen.findByRole('row', { name: /EchoScore/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /口语回声/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(router.state.location.search).toBe('?category=speaking_mock_exam&access=ended&author=linked')

    await act(async () => { await router.navigate('/admin/projects?category=question_generation&access=ended') })
    expect(await screen.findByText('没有符合条件的作品')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '清空筛选' })).toHaveLength(2)
  })

  it('keeps the pending and exception shortcuts deterministic', async () => {
    const { router } = renderAdmin('/admin/projects?pending=1')
    expect(await screen.findByRole('row', { name: /DictaFlow 听写流/ })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(2)

    await act(async () => { await router.navigate('/admin/projects?exception=1') })
    expect((await screen.findAllByText('异常待复核')).length).toBeGreaterThanOrEqual(3)
  })

  it('denies the management surface to a normal registered user', async () => {
    renderAdmin('/admin/projects', 0)
    expect(await screen.findByRole('heading', { name: '无后台访问权限' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '作品列表' })).not.toBeInTheDocument()
  })
})
