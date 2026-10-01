import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createInitialAppState, persistAppState } from '../state'

describe('discovery page workspace', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it.each([
    '/categories', '/categories/ai-question-generation', '/categories/personal-sites-portfolios',
    '/activity', '/search?q=PDF&mode=works',
    '/discover?idea=我想把大学PDF讲义生成选择题',
    '/discover/result?idea=学习&category=ai_learning_quiz',
    '/categories/missing-topic', '/search?q=完全不存在&mode=works',
  ])('keeps %s inside one accessible discovery workspace', async (path) => {
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    await waitFor(() => expect(screen.getByRole('main').querySelector('.discovery-shell')).not.toBeNull())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveClass('highfi-scope')
  })

  it.each([
    ['/categories', '分类加载中'],
    ['/categories/ai-question-generation', 'AI 出题专题加载中'],
    ['/activity', '公开动态加载中'],
    ['/search?q=PDF&mode=works', '正在搜索作品'],
    ['/discover?idea=我想把大学PDF讲义生成选择题', '正在整理你的想法'],
    ['/discover/result?idea=学习&category=ai_learning_quiz', '正在寻找匹配作品'],
  ])('retains loading and service errors in the workspace at %s', async (path, loadingLabel) => {
    const seeded = createInitialAppState()
    seeded.serviceScenario = 'service_error'
    persistAppState(seeded)
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    expect(screen.getByRole('status', { name: loadingLabel })).toBeInTheDocument()
    expect(screen.getByRole('main').querySelector('.discovery-shell')).not.toBeNull()
    expect(await screen.findByText('服务暂时不可用，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByRole('main').querySelector('.discovery-shell')).not.toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
