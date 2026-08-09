import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AuthGateProvider, ComparisonProvider } from '../features'
import { AppStateProvider } from '../state'
import { SearchPage } from './SearchPage'

function Probe() { const location = useLocation(); return <output aria-label="当前查询">{location.pathname}{location.search}</output> }
function renderSearch(path: string) { return render(<MemoryRouter initialEntries={[path]}><AppStateProvider><ToastProvider><AuthGateProvider><ComparisonProvider><Routes><Route path="/search" element={<><SearchPage /><Probe /></>} /><Route path="/discover" element={<Probe />} /></Routes></ComparisonProvider></AuthGateProvider></ToastProvider></AppStateProvider></MemoryRouter>) }

describe('SearchPage', () => {
  beforeEach(() => localStorage.clear())

  it('returns stable PDF results and field-level match reasons', async () => {
    renderSearch('/search?q=PDF')
    expect(await screen.findByRole('heading', { name: '4 个结果' })).toBeInTheDocument()
    expect(screen.getAllByText('为什么匹配')).toHaveLength(4)
    expect(screen.getAllByText('材料输入').length).toBeGreaterThan(0)
    expect(screen.queryByRole('tablist', { name: '搜索模式' })).not.toBeInTheDocument()
  })

  it('can limit search to the new portfolio category without affecting learning search', async () => {
    renderSearch('/search?q=%E5%BC%80%E5%8F%91%E8%80%85%E4%BD%9C%E5%93%81%E9%9B%86&category=personal_site_portfolio&mode=works')
    expect(await screen.findByRole('heading', { name: /个结果/ })).toBeInTheDocument()
    expect(screen.getAllByText('个人主页与作品集').length).toBeGreaterThan(0)
    expect(screen.queryByText('AI 学习与题库', { selector: '.tag' })).not.toBeInTheDocument()
  })

  it('automatically routes complete ideas to analysis and honors the keyword fallback', async () => {
    const idea = encodeURIComponent('我想把大学 PDF 讲义生成选择题')
    const view = renderSearch(`/search?q=${idea}`)
    expect(await screen.findByLabelText('当前查询')).toHaveTextContent('/discover?idea=')
    view.unmount()

    renderSearch(`/search?q=${idea}&mode=works`)
    expect(await screen.findByRole('heading', { name: /个结果/ })).toBeInTheDocument()
    expect(screen.getByText('暂时按关键词搜索')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新整理想法 →' })).toHaveAttribute('href', expect.stringContaining('/discover?idea='))
  })

  it('shows a dedicated no-results state', async () => {
    renderSearch('/search?q=%E5%AE%8C%E5%85%A8%E4%B8%8D%E5%AD%98%E5%9C%A8')
    expect(await screen.findByText('没有找到匹配的公开作品')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '发布作品' })).toHaveAttribute('href', '/submit')
  })
})
