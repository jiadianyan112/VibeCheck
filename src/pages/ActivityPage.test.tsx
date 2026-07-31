import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider } from '../state'
import { ActivityPage } from './ActivityPage'

function Probe() { const location = useLocation(); return <output aria-label="当前查询">{location.search}</output> }
function renderActivity() {
  return render(<MemoryRouter initialEntries={['/activity']}><AppStateProvider><Routes><Route path="/activity" element={<><ActivityPage /><Probe /></>} /></Routes></AppStateProvider></MemoryRouter>)
}

describe('ActivityPage', () => {
  beforeEach(() => localStorage.clear())

  it('renders lifecycle events with sources and detail anchors', async () => {
    renderActivity()
    expect(await screen.findByRole('heading', { name: '最新动态' })).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /在作品详情中定位此事件/ })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/project\/[^#]+#event-/))
    expect(screen.getAllByRole('button', { name: /查看事件来源/ }).length).toBeGreaterThan(0)
  })

  it('filters by event type and category using URL state', async () => {
    const user = userEvent.setup(); renderActivity()
    await screen.findByRole('heading', { name: '最新动态' })
    await user.selectOptions(screen.getByLabelText('事件类型'), 'ended')
    expect(screen.getByLabelText('当前查询')).toHaveTextContent('type=ended')
    expect(screen.getAllByText('作者声明结束').length).toBeGreaterThan(0)
    await user.selectOptions(screen.getByLabelText('学习分类'), 'speaking-practice')
    expect(screen.getByLabelText('当前查询')).toHaveTextContent('category=speaking-practice')
  })
})
