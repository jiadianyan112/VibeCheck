import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider, createInitialAppState, persistAppState } from '../state'
import { DiscoverPage } from './DiscoverPage'

function Destination() { const location = useLocation(); return <output aria-label="结果地址">{location.pathname}{location.search}</output> }
function renderDiscover(path: string) { return render(<MemoryRouter initialEntries={[path]}><AppStateProvider><Routes><Route path="/discover" element={<DiscoverPage />} /><Route path="/discover/result" element={<Destination />} /><Route path="/search" element={<Destination />} /></Routes></AppStateProvider></MemoryRouter>) }

describe('DiscoverPage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('redirects the retired empty entry to unified search', async () => {
    renderDiscover('/discover')
    expect(await screen.findByLabelText('结果地址')).toHaveTextContent('/search')
  })

  it('allows deleting, adding and restoring parsed tags without changing raw text', async () => {
    const user = userEvent.setup(); renderDiscover('/discover?idea=%E6%8A%8A%20PDF%20%E8%AE%B2%E4%B9%89%E7%94%9F%E6%88%90%E7%BB%83%E4%B9%A0%E9%A2%98')
    expect(await screen.findByText('想法已整理')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '原始想法' })).getByText('把 PDF 讲义生成练习题')).toBeInTheDocument()
    expect(screen.getByLabelText('完整产品想法')).toHaveValue('把 PDF 讲义生成练习题')
    await user.click(screen.getByRole('button', { name: '删除主要输入：PDF' }))
    expect(screen.queryByRole('button', { name: '删除主要输入：PDF' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('添加主要输入'), 'image')
    expect(screen.getByRole('button', { name: '删除主要输入：图片' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销修改' }))
    expect(screen.getByRole('button', { name: '删除主要输入：PDF' })).toBeInTheDocument()
    expect(screen.getByLabelText('完整产品想法')).toHaveValue('把 PDF 讲义生成练习题')
  })

  it('confirms structured intent through a recoverable result URL', async () => {
    const user = userEvent.setup(); renderDiscover('/discover?idea=%E5%81%9A%E4%B8%80%E4%B8%AA%E5%8F%A3%E8%AF%AD%E6%A8%A1%E8%80%83%E5%B9%B6%E8%87%AA%E5%8A%A8%E8%AF%84%E5%88%86')
    await screen.findByText('想法已整理')
    await user.click(screen.getByRole('button', { name: '确认并查找相似作品' }))
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('/discover/result?')
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('scenario=speaking_mock_exam')
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('input=audio')
  })

  it('confirms a portfolio idea with category-specific conditions', async () => {
    const user = userEvent.setup(); renderDiscover('/discover?idea=%E6%88%91%E6%83%B3%E5%81%9A%E4%B8%80%E4%B8%AA%E6%9E%81%E7%AE%80%E5%BC%80%E5%8F%91%E8%80%85%E4%BD%9C%E5%93%81%E9%9B%86%EF%BC%8C%E5%B1%95%E7%A4%BA%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%E5%92%8C%E6%BA%90%E7%A0%81')
    await screen.findByText('想法已整理')
    expect(screen.getByLabelText('作品品类')).toHaveValue('personal_site_portfolio')
    expect(screen.getByLabelText('添加作者身份')).toBeInTheDocument()
    expect(screen.queryByLabelText('添加使用场景')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并查找相似作品' }))
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('category=personal_site_portfolio')
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('role=developer')
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('visual=minimal')
  })

  it('supports manually constructing an unrecognized intent and restores it after remount', async () => {
    const user = userEvent.setup(); const path = '/discover?idea=%E5%81%9A%E4%B8%80%E4%B8%AA%E5%BE%88%E7%89%B9%E5%88%AB%E7%9A%84%E4%B8%9C%E8%A5%BF'
    const view = renderDiscover(path)
    expect(await screen.findByText('还需要一些信息')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并查找相似作品' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('作品品类'), 'ai_learning_quiz')
    await user.selectOptions(screen.getByLabelText('添加使用场景'), 'daily_practice')
    expect(screen.getByRole('button', { name: '确认并查找相似作品' })).toBeEnabled()
    view.unmount(); renderDiscover(path)
    expect(await screen.findByRole('button', { name: '删除使用场景：日常刷题' })).toBeInTheDocument()
  })

  it('offers keyword and manual-tag exits when parsing times out', async () => {
    const seeded = createInitialAppState(); seeded.serviceScenario = 'timeout'; persistAppState(seeded)
    const user = userEvent.setup(); renderDiscover('/discover?idea=%E4%B8%80%E4%B8%AA%E5%8F%A3%E8%AF%AD%E7%BB%83%E4%B9%A0%E6%83%B3%E6%B3%95')
    expect(await screen.findByRole('heading', { name: '暂时无法自动整理这段想法' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看关键词结果' })).toHaveAttribute('href', '/search?q=%E4%B8%80%E4%B8%AA%E5%8F%A3%E8%AF%AD%E7%BB%83%E4%B9%A0%E6%83%B3%E6%B3%95&mode=works')
    expect(screen.getByRole('button', { name: '使用这些信息查找作品' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('添加使用场景'), 'speaking_mock_exam')
    expect(screen.getByRole('button', { name: '使用这些信息查找作品' })).toBeEnabled()
  })
})
