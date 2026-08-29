import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../styles/tokens.css'
import '../styles/highfi-foundation.css'
import '../styles/highfi-components.css'
import { StyleSandboxPage } from './StyleSandboxPage'

describe('StyleSandboxPage', () => {
  it('shows the reusable low-fidelity component states', () => {
    render(<StyleSandboxPage />)
    expect(screen.getByRole('heading', { name: '操作与输入' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '卡片与标签页' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '对比表与窄屏替代' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '加载、空态与错误' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(screen.getByText('请输入完整的 https:// 地址')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('region', { name: /可横向滚动/ })).toHaveAttribute('tabindex', '0')
  })

  it('renders high-fidelity accent and inverse primitives', () => {
    render(<StyleSandboxPage />)
    expect(screen.getByRole('button', { name: '品牌操作' })).toHaveClass('button--accent')
    expect(screen.getByText('荧光状态')).toHaveClass('tag--accent')
    expect(screen.getByText('反相状态')).toHaveClass('tag--inverse')
  })

  it('opts the sandbox into the high-fidelity scope and applies accent color', () => {
    render(<StyleSandboxPage />)
    const main = screen.getByRole('main')
    const appShell = main.closest('.app-shell')
    const highfiScope = main.closest('.highfi-scope')
    expect(appShell).not.toBeNull()
    expect(highfiScope).not.toBeNull()
    expect(highfiScope).not.toBe(appShell)
    expect(appShell?.contains(highfiScope)).toBe(true)
    const accentButton = screen.getByRole('button', { name: '品牌操作' })
    const accentStyle = getComputedStyle(accentButton)
    expect(accentStyle.background).toBe('var(--brand-lime)')
    expect(accentStyle.transition).toContain('background-color')
  })

  it('changes controlled tabs', async () => {
    const user = userEvent.setup()
    render(<StyleSandboxPage />)
    await user.click(screen.getByRole('tab', { name: '错误' }))
    expect(screen.getByText('该作品的状态仍需核验。')).toBeInTheDocument()
  })

  it('closes modal with Escape and returns focus', async () => {
    const user = userEvent.setup()
    render(<StyleSandboxPage />)
    const trigger = screen.getByRole('button', { name: '打开弹层示例' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '保留当前操作上下文' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens and closes the drawer from its close control', async () => {
    const user = userEvent.setup()
    render(<StyleSandboxPage />)
    await user.click(screen.getByRole('button', { name: '打开抽屉示例' }))
    expect(screen.getByRole('dialog', { name: '证据详情' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭抽屉' }))
    expect(screen.queryByRole('dialog', { name: '证据详情' })).not.toBeInTheDocument()
  })
})
