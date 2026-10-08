import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AppStateProvider } from '../state'
import { CreatorProfilePage } from './CreatorProfilePage'

function renderCreator(id: string) {
  return render(
    <AppStateProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/creator/${id}`]}>
          <Routes><Route path="/creator/:id" element={<CreatorProfilePage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </AppStateProvider>,
  )
}

describe('CreatorProfilePage', () => {
  beforeEach(() => localStorage.clear())

  it('shows the developer profile and associated works without legacy author sections', () => {
    renderCreator('creator-zhou')
    expect(screen.getByRole('heading', { name: '周可' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制分享链接' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '口语回声' })).toHaveAttribute('href', '/project/project-speakmirror')
    expect(screen.getByRole('link', { name: 'LexiDeck 背词卡' })).toHaveAttribute('href', '/project/project-lexideck')
    expect(screen.getByRole('heading', { name: '关联作品' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '最近更新' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '公开复用资产' })).not.toBeInTheDocument()
    expect(screen.queryByText('口语反馈提示词结构')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '周可，已验证' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关注作者' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '私信' })).not.toBeInTheDocument()
  })

  it('copies the developer share URL with an explicit confirmation', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderCreator('creator-zhou')
    await user.click(screen.getByRole('button', { name: '复制分享链接' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/creator\/creator-zhou$/))
    expect(screen.getByText('开发者主页分享链接已复制。')).toBeInTheDocument()
  })

  it('keeps the profile focused on associated works', () => {
    renderCreator('creator-qiao')
    expect(screen.getByRole('heading', { name: '关联作品' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'EchoScore' })).toHaveAttribute('href', '/project/project-echoscore')
    expect(screen.queryByText('单方已确认，待另一方确认')).not.toBeInTheDocument()
  })

  it('does not attribute an unlinked platform record to an unverified creator', () => {
    renderCreator('creator-lab')
    expect(screen.getByRole('heading', { name: '练习实验室' })).toBeInTheDocument()
    expect(screen.getByText('暂无关联作品')).toBeInTheDocument()
    expect(screen.queryByText('PDF 题库实验室')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '浏览作品广场' })).toHaveAttribute('href', '/projects')
  })

  it('offers a single recovery route for an unknown developer id', () => {
    renderCreator('creator-missing')
    expect(screen.getByText('未找到开发者主页')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回作品广场' })).toHaveAttribute('href', '/projects')
  })
})
