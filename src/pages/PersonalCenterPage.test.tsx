import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('returns a guest to email OTP login and keeps the original route', async () => {
    renderMe()
    expect(await screen.findByRole('heading', { name: '登录／注册' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '邮箱验证码登录' })).toBeInTheDocument()
  })

  it('returns all registered-user history to shared source records', async () => {
    const user = userEvent.setup()
    loginAs(0)
    renderMe()
    expect(await screen.findByRole('heading', { name: '米娅的个人中心' })).toBeInTheDocument()
    const favorites = screen.getByRole('region', { name: '收藏' })
    const quizLink = within(favorites).getByRole('link', { name: '题练工坊' })
    expect(quizLink).toHaveAttribute('href', '/project/project-quizforge')
    expect(within(favorites).getAllByRole('button', { name: '关注更新' })).toHaveLength(2)
    expect(within(favorites).getAllByRole('button', { name: '取消关注更新' })).toHaveLength(2)
    const quizItem = quizLink.closest('li') as HTMLElement
    await user.click(within(quizItem).getByRole('button', { name: '关注更新' }))
    expect(within(quizItem).getByRole('button', { name: '取消关注更新' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: '关注的作品更新' })).not.toBeInTheDocument()
    const comparisonLinks = screen.getAllByRole('link', { name: '继续比较' }).map((link) => link.getAttribute('href'))
    expect(comparisonLinks).toEqual(expect.arrayContaining([
      '/compare/comparison-anonymous-pdf#structured-comparison-heading',
      '/compare/comparison-mia-speaking#structured-comparison-heading',
    ]))
    expect(screen.getByRole('link', { name: '继续编辑' })).toHaveAttribute('href', expect.stringContaining('/submit/new?draft=draft-mia-study-review'))
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
