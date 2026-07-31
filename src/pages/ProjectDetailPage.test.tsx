import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AuthGateProvider, ComparisonProvider } from '../features'
import { AppStateProvider } from '../state'
import { ProjectDetailPage } from './ProjectDetailPage'

function renderProject(id: string) {
  return render(<MemoryRouter initialEntries={[`/project/${id}`]}><AppStateProvider><ToastProvider><AuthGateProvider><ComparisonProvider><Routes><Route path="/project/:id" element={<ProjectDetailPage />} /></Routes></ComparisonProvider></AuthGateProvider></ToastProvider></AppStateProvider></MemoryRouter>)
}

describe('ProjectDetailPage hero', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('shows current status, verification time and verified creator above the fold', async () => {
    renderProject('project-quizforge')
    expect(await screen.findByRole('heading', { name: '题练工坊' })).toBeInTheDocument()
    expect(screen.getByText('正常可访问')).toBeInTheDocument()
    expect(screen.getByText(/核验于 2026年7月28日/)).toBeInTheDocument()
    expect(screen.getByText('已关联验证作者')).toBeInTheDocument()
    expect(screen.getByText('林序 · 已验证')).toBeInTheDocument()
  })

  it('guards the external experience link before leaving the prototype', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    await user.click(await screen.findByRole('button', { name: '立即体验 ↗' }))
    expect(screen.getByRole('dialog', { name: '即将离开 VibeCheck' })).toBeInTheDocument()
    expect(screen.getByText('目标站点：example.test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '继续访问' })).toHaveAttribute('target', '_blank')
  })

  it('keeps the unlinked author claim secondary to core actions', async () => {
    renderProject('project-pdfquizlab')
    expect(await screen.findByText('尚未关联作者')).toBeInTheDocument()
    expect(screen.getByText('平台编辑收录')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '我是作者，申请关联' })).toHaveClass('weak-link')
    expect(screen.getByLabelText('作品核心操作')).toContainElement(screen.getByRole('button', { name: '收藏' }))
  })

  it('routes protected collection through login while sharing remains available', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    await user.click(await screen.findByRole('button', { name: '收藏' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭弹层' }))
    await user.click(screen.getByRole('button', { name: '分享' }))
    expect(screen.getByText('已准备分享：题练工坊 · VibeCheck')).toBeInTheDocument()
  })
})
