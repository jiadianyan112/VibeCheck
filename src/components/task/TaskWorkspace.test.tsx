import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorSummary, LivePreview, StatusBeacon, StepRail, TaskPreview, TaskShell } from './index'

describe('submission task workspace', () => {
  it('maps the existing editing steps to six non-interactive stages', () => {
    const { container } = render(<StepRail currentStep="definition" />)
    expect([...container.querySelectorAll('[data-step-id]')].map((item) => item.textContent)).toEqual([
      '检查地址', '基础信息', '定位与用途', '核心内容', '开发与资产', '预览与提交',
    ])
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(container.querySelector('[data-step-id="details"]')).toHaveAttribute('data-step-state', 'complete')
    expect(container.querySelector('[data-step-id="details"]')).toHaveAttribute('aria-label', '基础信息，已完成')
    expect(container.querySelector('[data-step-id="purpose"]')).toHaveAttribute('aria-label', '定位与用途，当前步骤')
    expect(container.querySelector('[data-step-id="content"]')).toHaveAttribute('aria-label', '核心内容，后续步骤')
    expect(container.querySelector('[data-step-id="content"]')).toHaveAttribute('data-step-state', 'upcoming')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps the preview collapsed on small screens and lets a keyboard user open it', async () => {
    const user = userEvent.setup()
    render(<TaskPreview><p>当前作品内容</p></TaskPreview>)
    expect(screen.getByText('查看作品预览').closest('details')).not.toHaveAttribute('open')
    screen.getByText('查看作品预览').focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('查看作品预览').closest('details')).toHaveAttribute('open')
  })

  it('uses current props for the preview and falls back when its selected cover fails', () => {
    const { rerender } = render(<LivePreview fields={{ currentName: '初稿', categoryId: 'personal_site_portfolio' }} coverUrl="blob:cover" />)
    fireEvent.error(screen.getByRole('img', { name: '初稿的封面预览' }))
    expect(screen.getByRole('img', { name: '默认封面' })).toBeInTheDocument()
    rerender(<LivePreview fields={{ currentName: '新名称', oneLineDefinition: '新的介绍', categoryId: 'ai_learning_quiz' }} />)
    expect(screen.getByText('新名称')).toBeInTheDocument()
    expect(screen.queryByText('初稿')).not.toBeInTheDocument()
    expect(screen.getByText('新的介绍')).toBeInTheDocument()
    expect(screen.getByText('AI 学习与题库')).toBeInTheDocument()
  })

  it('links errors to actual inputs, including the first checkbox of a group', async () => {
    const user = userEvent.setup()
    render(<><ErrorSummary errors={[{ targetId: 'name', message: '请填写作品名称' }, { targetId: 'roles', message: '请选择创作者身份' }]} /><input id="name" /><fieldset><legend>创作者身份</legend><input id="roles" type="checkbox" /></fieldset></>)
    await user.click(screen.getByRole('link', { name: '请选择创作者身份' }))
    expect(document.getElementById('roles')).toHaveFocus()
    await user.click(screen.getByRole('link', { name: '请填写作品名称' }))
    expect(document.getElementById('name')).toHaveFocus()
  })

  it('keeps state readable inside the shared task structure', () => {
    const { container } = render(<TaskShell title="发布作品" currentStep="address" status={<StatusBeacon state="pending" label="待审核" />} aside={<p>辅助信息</p>}><input aria-label="作品地址" /></TaskShell>)
    expect(screen.getByRole('heading', { level: 1, name: '发布作品' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('待审核')
    expect(container.querySelector('.highfi-scope .task-shell__aside')).not.toBeNull()
    expect(container.querySelector('.wire-panel')).toBeNull()
  })
})
