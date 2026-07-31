import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider } from '../state'
import { DiscoverPage } from './DiscoverPage'

function Destination() { const location = useLocation(); return <output aria-label="结果地址">{location.pathname}{location.search}</output> }
function renderDiscover(path: string) { return render(<MemoryRouter initialEntries={[path]}><AppStateProvider><Routes><Route path="/discover" element={<DiscoverPage />} /><Route path="/discover/result" element={<Destination />} /><Route path="/search" element={<Destination />} /></Routes></AppStateProvider></MemoryRouter>) }

describe('DiscoverPage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('allows deleting, adding and restoring parsed tags without changing raw text', async () => {
    const user = userEvent.setup(); renderDiscover('/discover?idea=%E6%8A%8A%20PDF%20%E8%AE%B2%E4%B9%89%E7%94%9F%E6%88%90%E7%BB%83%E4%B9%A0%E9%A2%98')
    expect(await screen.findByText('自动解析完成')).toBeInTheDocument()
    expect(screen.getAllByText('把 PDF 讲义生成练习题')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '删除主要输入：PDF' }))
    expect(screen.queryByRole('button', { name: '删除主要输入：PDF' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('添加主要输入'), 'image')
    expect(screen.getByRole('button', { name: '删除主要输入：图片' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '恢复原始解析' }))
    expect(screen.getByRole('button', { name: '删除主要输入：PDF' })).toBeInTheDocument()
    expect(screen.getAllByText('把 PDF 讲义生成练习题')).toHaveLength(2)
  })

  it('confirms structured intent through a recoverable result URL', async () => {
    const user = userEvent.setup(); renderDiscover('/discover?idea=%E5%81%9A%E4%B8%80%E4%B8%AA%E5%8F%A3%E8%AF%AD%E6%A8%A1%E8%80%83%E5%B9%B6%E8%87%AA%E5%8A%A8%E8%AF%84%E5%88%86')
    await screen.findByText('自动解析完成')
    await user.click(screen.getByRole('button', { name: '确认并查看同类分析' }))
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('/discover/result?')
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('scenario=speaking_mock_exam')
    expect(screen.getByLabelText('结果地址')).toHaveTextContent('input=audio')
  })

  it('supports manually constructing an unrecognized intent and restores it after remount', async () => {
    const user = userEvent.setup(); const path = '/discover?idea=%E5%81%9A%E4%B8%80%E4%B8%AA%E5%BE%88%E7%89%B9%E5%88%AB%E7%9A%84%E4%B8%9C%E8%A5%BF'
    const view = renderDiscover(path)
    expect(await screen.findByText('自动解析失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并查看同类分析' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('添加使用场景'), 'daily_practice')
    expect(screen.getByRole('button', { name: '确认并查看同类分析' })).toBeEnabled()
    view.unmount(); renderDiscover(path)
    expect(await screen.findByRole('button', { name: '删除使用场景：日常刷题' })).toBeInTheDocument()
  })
})
