import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StyleSandboxPage } from './StyleSandboxPage'

describe('StyleSandboxPage', () => {
  it('shows the required low-fidelity component groups', () => {
    render(<StyleSandboxPage />)
    expect(screen.getByRole('heading', { name: '操作与输入' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '作品卡片' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '对比表与窄屏替代' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '加载与空状态' })).toBeInTheDocument()
  })

  it('opens and closes the dialog example', async () => {
    const user = userEvent.setup()
    render(<StyleSandboxPage />)
    await user.click(screen.getByRole('button', { name: '打开弹层示例' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
