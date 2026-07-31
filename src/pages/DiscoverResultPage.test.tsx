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
    renderPage()
    expect(await screen.findByRole('heading', { name: '同类作品分析' })).toBeInTheDocument()
    expect(screen.getByText(/当前固定收录样本/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '方案分组' })).toBeInTheDocument()
    expect(screen.getAllByText('查看统计来源').length).toBeGreaterThan(0)
    expect(screen.getByText(/公开复用资产 1 项/)).toBeInTheDocument()
  })

  it('opens a statistic as a corresponding work filter', async () => {
    const user = userEvent.setup(); renderPage()
    await screen.findByRole('heading', { name: '状态分布' })
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
})
