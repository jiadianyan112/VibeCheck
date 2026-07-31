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

describe('ProjectDetailPage structured profile', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('renders product fields in design order with a unified four-node flow', async () => {
    renderProject('project-quizforge')
    expect(await screen.findByRole('heading', { name: '产品结构' })).toBeInTheDocument()
    const labels = screen.getAllByRole('term').map((element) => element.textContent)
    expect(labels.slice(0, 8)).toEqual(['目标用户', '核心问题', '使用场景', '主要输入', '主要输出', '核心功能', '登录要求', '分享能力'])
    expect(screen.getByText('材料输入')).toBeInTheDocument()
    expect(screen.getByText('内容处理')).toBeInTheDocument()
    expect(screen.getByText('完成练习')).toBeInTheDocument()
    expect(screen.getByText('反馈与记录')).toBeInTheDocument()
    const similar = screen.getByRole('link', { name: '从这些字段查看同类' })
    expect(similar).toHaveAttribute('href', expect.stringContaining('scenario=question_generation'))
    expect(similar).toHaveAttribute('href', expect.stringContaining('input=pdf'))
  })

  it('marks unknown development fields with their recorded reasons', async () => {
    renderProject('project-learntrack')
    expect(await screen.findByRole('heading', { name: '开发信息' })).toBeInTheDocument()
    expect(screen.getByText('未知：公开页面未说明使用的模型')).toBeInTheDocument()
    expect(screen.getByText('未知：未发现可验证的技术栈信息')).toBeInTheDocument()
    expect(screen.getByText('未知：作者未公开开发周期')).toBeInTheDocument()
  })

  it('opens evidence from an individual key field', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    await user.click(await screen.findByRole('button', { name: '核心问题来源（1）' }))
    expect(screen.getByRole('dialog', { name: '事实来源与核验记录' })).toBeInTheDocument()
    expect(screen.getByText('公开页面可访问并展示 PDF 生成题目流程。')).toBeInTheDocument()
  })
})
