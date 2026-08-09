import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { UnifiedSearchForm } from './UnifiedSearchForm'

function Probe() {
  const location = useLocation()
  return <output aria-label="当前地址">{location.pathname}{location.search}</output>
}

function renderForm() {
  return render(<MemoryRouter initialEntries={['/projects']}><Routes><Route path="*" element={<><UnifiedSearchForm id="test-search" className="test-form" inputClassName="input" submitClassName="button" /><Probe /></>} /></Routes></MemoryRouter>)
}

describe('UnifiedSearchForm', () => {
  it('uses the same input to route keywords and complete ideas', async () => {
    const user = userEvent.setup()
    const view = renderForm()
    const input = screen.getByRole('textbox', { name: '搜索作品或输入完整想法' })
    await user.type(input, 'PDF 出题')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/search?q=PDF%20%E5%87%BA%E9%A2%98')

    view.unmount()
    renderForm()
    const ideaInput = screen.getByRole('textbox', { name: '搜索作品或输入完整想法' })
    await user.type(ideaInput, '把 PDF 讲义生成练习题')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/discover?idea=')
  })
})
