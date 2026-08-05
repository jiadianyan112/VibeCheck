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

  it('shows a verified identity, linked works, updates, assets and a stable route', () => {
    renderCreator('creator-zhou')
    expect(screen.getByRole('heading', { name: '周可' })).toBeInTheDocument()
    expect(screen.getByText('身份已验证')).toBeInTheDocument()
    expect(screen.getByText('/creator/creator-zhou')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '口语回声' })).toHaveAttribute('href', '/project/project-speakmirror')
    expect(screen.getByRole('link', { name: 'LexiDeck 背词卡' })).toHaveAttribute('href', '/project/project-lexideck')
    expect(screen.getByRole('heading', { name: '最近更新' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '公开复用资产' })).toBeInTheDocument()
    expect(screen.getByText('口语反馈提示词结构')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关注作者' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '私信' })).not.toBeInTheDocument()
  })

  it('copies the author share URL with an explicit confirmation', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderCreator('creator-zhou')
    await user.click(screen.getByRole('button', { name: '复制分享链接' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/creator\/creator-zhou$/))
    expect(screen.getByText('作者主页分享链接已复制。')).toBeInTheDocument()
  })

  it('labels a one-party reuse relation as waiting for confirmation', () => {
    renderCreator('creator-qiao')
    expect(screen.getByText('单方已确认，待另一方确认')).toBeInTheDocument()
    expect(screen.getByText('口语回声 → EchoScore')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看复用方作品' })).toHaveAttribute('href', '/project/project-speakmirror')
  })

  it('does not attribute an unlinked platform record to an unverified creator', () => {
    renderCreator('creator-lab')
    expect(screen.getByText('身份未验证')).toBeInTheDocument()
    expect(screen.getByText('暂无经验证关联作品')).toBeInTheDocument()
    expect(screen.queryByText('PDF 题库实验室')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '浏览作品广场' })).toHaveAttribute('href', '/projects')
  })

  it('offers a single recovery route for an unknown author id', () => {
    renderCreator('creator-missing')
    expect(screen.getByText('未找到作者主页')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回作品广场' })).toHaveAttribute('href', '/projects')
  })
})
