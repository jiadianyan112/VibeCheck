import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AuthGateProvider, ComparisonProvider } from '../features'
import { AppStateProvider } from '../state'
import { SearchPage } from './SearchPage'

function Probe() { const location = useLocation(); return <output aria-label="当前查询">{location.search}</output> }
function renderSearch(path: string) { return render(<MemoryRouter initialEntries={[path]}><AppStateProvider><ToastProvider><AuthGateProvider><ComparisonProvider><Routes><Route path="/search" element={<><SearchPage /><Probe /></>} /></Routes></ComparisonProvider></AuthGateProvider></ToastProvider></AppStateProvider></MemoryRouter>) }

describe('SearchPage', () => {
  beforeEach(() => localStorage.clear())

  it('returns stable PDF results and field-level match reasons', async () => {
    renderSearch('/search?q=PDF')
    expect(await screen.findByRole('heading', { name: '3 个结果' })).toBeInTheDocument()
    expect(screen.getAllByText('为什么匹配')).toHaveLength(3)
    expect(screen.getAllByText('材料输入').length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: '搜作品' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches modes without clearing the query and defaults long text to similar', async () => {
    const user = userEvent.setup(); renderSearch('/search?q=PDF')
    await screen.findByRole('heading', { name: '3 个结果' })
    await user.click(screen.getByRole('tab', { name: '查同类' }))
    expect(screen.getByLabelText('当前查询')).toHaveTextContent('q=PDF')
    expect(screen.getByLabelText('当前查询')).toHaveTextContent('mode=similar')
    expect(screen.getByDisplayValue('PDF')).toBeInTheDocument()
    const view = screen.getByLabelText('当前查询').textContent
    expect(view).toContain('PDF')
  })

  it('shows a dedicated no-results state', async () => {
    renderSearch('/search?q=%E5%AE%8C%E5%85%A8%E4%B8%8D%E5%AD%98%E5%9C%A8')
    expect(await screen.findByText('没有找到匹配的公开作品')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '发布作品' })).toHaveAttribute('href', '/submit')
  })
})
