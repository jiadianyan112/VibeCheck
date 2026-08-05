import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import { appReducer, createInitialAppState, persistAppState } from '../state'

function renderMe() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/me'] })
  return render(<AppProviders><RouterProvider router={router} /></AppProviders>)
}

function loginAs(index: number) {
  const state = appReducer(createInitialAppState(), createLoginAction(prototypeUsers[index]!))
  persistAppState(state)
  return state
}

describe('PersonalCenterPage', () => {
  beforeEach(() => localStorage.clear())

  it('returns a guest to role simulation and keeps the original route', async () => {
    renderMe()
    expect(await screen.findByRole('heading', { name: '选择原型身份' })).toBeInTheDocument()
    expect(screen.getByText('/me')).toBeInTheDocument()
  })

  it('returns all registered-user history to shared source records', async () => {
    loginAs(0)
    renderMe()
    expect(await screen.findByRole('heading', { name: '米娅的个人中心' })).toBeInTheDocument()
    const favorites = screen.getByRole('region', { name: '收藏' })
    expect(within(favorites).getByRole('link', { name: '题练工坊' })).toHaveAttribute('href', '/project/project-quizforge')
    expect(screen.getByRole('link', { name: '继续比较' })).toHaveAttribute('href', '/compare/comparison-mia-speaking')
    expect(screen.getByRole('link', { name: '恢复草稿' })).toHaveAttribute('href', expect.stringContaining('/submit/new?draft=draft-mia-study-review'))
    expect(screen.getByText('待人工审核')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回比较' })).toHaveAttribute('href', '/compare/comparison-mia-speaking#comparison-decision')
    expect(screen.queryByRole('heading', { name: '平台管理入口' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '我的作品' })).not.toBeInTheDocument()
  })

  it('shows review status and field messages from the same submission draft', async () => {
    const state = loginAs(0)
    const draft = state.submissionDrafts[0]!
    persistAppState({ ...state, submissionDrafts: [{ ...draft, status: 'changes_requested', reviewMessages: { oneLineDefinition: '请把目标用户和核心价值写得更具体。' } }] })
    renderMe()
    expect(await screen.findByText('需修改')).toBeInTheDocument()
    expect(screen.getByText(/请把目标用户和核心价值写得更具体。/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看审核' })).toHaveAttribute('href', `/submit/new?draft=${draft.id}`)
  })

  it('shows author work management without staff-only tools', async () => {
    loginAs(1)
    renderMe()
    expect(await screen.findByRole('heading', { name: '我的作品' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看我的作者主页' })).toHaveAttribute('href', '/creator/creator-zhou')
    expect(screen.getAllByRole('link', { name: '更新作品' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '作品更新待办' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '平台管理入口' })).not.toBeInTheDocument()
  })

  it('shows staff tools only to editor or administrator roles', async () => {
    loginAs(2)
    renderMe()
    expect(await screen.findByRole('heading', { name: '平台管理入口' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /发布审核/ })).toHaveAttribute('href', '/admin/reviews')
    expect(screen.getByRole('link', { name: /状态监测/ })).toHaveAttribute('href', '/admin/status-monitor')
    expect(screen.queryByRole('heading', { name: '作品更新待办' })).not.toBeInTheDocument()
  })
})
