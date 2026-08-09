import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../components'
import { ComparisonProvider } from '../features'
import { AppStateProvider, useAppState } from '../state'
import { DiscoverResultPage } from './DiscoverResultPage'

const query = 'idea=PDF%E7%BB%83%E4%B9%A0&target=university_students&scenario=question_generation&input=pdf&practice=single_choice&practice=short_answer&output=questions&output=practice_set'

function Probe() {
  const location = useLocation()
  const { state } = useAppState()
  return <output aria-label="页面状态">{location.search}|compare={state.comparisonProjectIds.join(',')}</output>
}

function renderPage(extra = '') {
  return render(<MemoryRouter initialEntries={[`/discover/result?${query}${extra}`]}><AppStateProvider><ToastProvider><ComparisonProvider><Routes><Route path="/discover/result" element={<><DiscoverResultPage /><Probe /></>} /></Routes></ComparisonProvider></ToastProvider></AppStateProvider></MemoryRouter>)
}

describe('DiscoverResultPage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('shows traceable structured analysis without a competition claim', async () => {
    renderPage('&view=analysis')
    expect(await screen.findByRole('heading', { name: '找到相似作品' })).toBeInTheDocument()
    expect(screen.getByText(/结果来自社区目前收录的公开作品/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '常见做法' })).toBeInTheDocument()
    expect(screen.getAllByText('查看包含的作品').length).toBeGreaterThan(0)
    expect(screen.getByText(/公开复用资产 1 项/)).toBeInTheDocument()
  })

  it('keeps one or two exact works visible and separates relaxed matches', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '精确匹配作品' })).toBeInTheDocument()
    expect(screen.getByText('题练工坊')).toBeInTheDocument()
    expect(screen.getByText('Paper to Practice')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '相近作品' })).toBeInTheDocument()
    expect(screen.getByText('PDF 题库实验室')).toBeInTheDocument()
    expect(screen.getByText(/只符合部分条件，可以作为补充参考/)).toBeInTheDocument()
  })

  it('offers adjacent categories and saves a reproducible zero-result query', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/discover/result?idea=%E6%95%99%E5%B8%88%E6%97%A5%E7%BB%83&target=teachers&scenario=daily_practice&input=video&practice=dictation&output=flashcards']}><AppStateProvider><ToastProvider><ComparisonProvider><Routes><Route path="/discover/result" element={<DiscoverResultPage />} /></Routes></ComparisonProvider></ToastProvider></AppStateProvider></MemoryRouter>)
    expect(await screen.findByText(/根据你的使用场景和输入内容/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '换个方向继续探索' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看相关专题 →' })).toHaveAttribute('href', '/categories/daily-practice')
    await user.click(screen.getByRole('button', { name: '保存查询' }))
    expect(screen.getByText('已保存这次搜索，下次可以从相同链接继续。')).toBeInTheDocument()
    expect(localStorage.getItem('vibecheck:saved-discovery-queries')).toContain('/discover/result?')
    expect(screen.getByRole('link', { name: '修改条件' })).toHaveAttribute('href', expect.stringContaining('/discover?idea='))
    expect(screen.getByRole('link', { name: '回到作品广场' })).toHaveAttribute('href', '/projects')
  })

  it('opens a statistic as a corresponding work filter', async () => {
    const user = userEvent.setup(); renderPage('&view=analysis')
    await screen.findByRole('heading', { name: '作品状态' })
    await user.click(screen.getByRole('button', { name: '部分异常 · 1' }))
    expect(screen.getByRole('tab', { name: '作品结果' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('页面状态')).toHaveTextContent('status=partial_abnormal')
    expect(screen.getByText('Paper to Practice')).toBeInTheDocument()
    expect(screen.queryByText('题练工坊')).not.toBeInTheDocument()
  })

  it('preserves URL filters and comparison choices while switching views', async () => {
    const user = userEvent.setup(); renderPage('&view=works&asset=none')
    const projectName = await screen.findByText('Paper to Practice')
    const card = projectName.closest('.project-card') as HTMLElement
    await user.click(within(card).getByRole('button', { name: '加入比较' }))
    expect(screen.getByLabelText('页面状态')).toHaveTextContent('project-papertopractice')
    await user.click(screen.getByRole('tab', { name: '同类分析' }))
    expect(screen.getByLabelText('页面状态')).toHaveTextContent('asset=none')
    await user.click(screen.getByRole('tab', { name: '作品结果' }))
    expect(within(screen.getByText('Paper to Practice').closest('.project-card') as HTMLElement).getByRole('button', { name: '移出比较' })).toBeInTheDocument()
  })

  it('matches portfolio ideas against portfolio dimensions only', async () => {
    render(<MemoryRouter initialEntries={['/discover/result?idea=%E5%BC%80%E5%8F%91%E8%80%85%E4%BD%9C%E5%93%81%E9%9B%86&category=personal_site_portfolio&siteType=portfolio&role=developer&goal=showcase_projects&view=works']}><AppStateProvider><ToastProvider><ComparisonProvider><Routes><Route path="/discover/result" element={<DiscoverResultPage />} /></Routes></ComparisonProvider></ToastProvider></AppStateProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '精确匹配作品' })).toBeInTheDocument()
    expect(screen.getByText('Stackfolio')).toBeInTheDocument()
    expect(screen.getByText('Terminal Craft')).toBeInTheDocument()
    expect(screen.getAllByText('个人主页与作品集').length).toBeGreaterThan(0)
    expect(screen.queryByText('题练工坊')).not.toBeInTheDocument()
  })

  it('shows honest relaxed portfolio matches when all conditions produce zero exact results', async () => {
    render(<MemoryRouter initialEntries={['/discover/result?idea=%E7%94%A8%E4%B8%80%E9%A1%B5%E5%B1%95%E7%A4%BA%E5%BC%80%E5%8F%91%E8%80%85%E9%A1%B9%E7%9B%AE%E5%92%8C%E6%BA%90%E7%A0%81&category=personal_site_portfolio&siteType=portfolio&role=developer&goal=showcase_projects&pageModel=single_page&visual=minimal&assetType=source_code&view=works']}><AppStateProvider><ToastProvider><ComparisonProvider><Routes><Route path="/discover/result" element={<DiscoverResultPage />} /></Routes></ComparisonProvider></ToastProvider></AppStateProvider></MemoryRouter>)
    expect((await screen.findByRole('heading', { name: '找到相似作品' })).closest('header')).toHaveTextContent('0 个完全匹配的作品，并整理了 4 个相近参考')
    expect(screen.getByRole('heading', { name: '最接近的作品' })).toBeInTheDocument()
    expect(screen.getAllByText(/命中.+但未满足全部意图维度/).length).toBeGreaterThan(0)
    expect(screen.getByText('根据你确认的网站类型、创作者身份和建站目的，我们找到了相关专题。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除统计筛选' })).not.toBeInTheDocument()
  })
})
