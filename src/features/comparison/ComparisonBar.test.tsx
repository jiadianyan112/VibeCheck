import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Button, ToastProvider } from '../../components'
import { projects } from '../../mocks'
import { AppStateProvider, useAppState } from '../../state'
import { ComparisonProvider, FloatingCompareBar, useComparison } from './ComparisonBar'

function Harness() {
  const { addProject } = useComparison()
  const { dispatch } = useAppState()
  return <><Button onClick={() => addProject(projects[0]!.id)}>添加重复作品</Button>{projects.slice(2, 6).map((project, index) => <Button key={project.id} onClick={() => addProject(project.id)}>添加候选{index + 1}</Button>)}<Button onClick={() => dispatch({ type: 'COMPARISON_CLEAR' })}>直接清空</Button><FloatingCompareBar /></>
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter><AppStateProvider><ToastProvider><ComparisonProvider>{children}</ComparisonProvider></ToastProvider></AppStateProvider></MemoryRouter>
}

describe('FloatingCompareBar', () => {
  beforeEach(() => localStorage.clear())

  it('shows 2–5 selected works and rejects duplicates', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    expect(screen.getByText('比较栏 · 2/5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '开始比较' })).toHaveAttribute('href', '/compare/comparison-anonymous-pdf#structured-comparison-heading')
    expect(screen.getByRole('button', { name: '查看作品' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: '查看作品' }))
    expect(screen.getByRole('button', { name: '收起作品' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: '添加重复作品' }))
    expect(screen.getByText('这个作品已经在比较栏中。')).toBeInTheDocument()
    expect(screen.getByText('比较栏 · 2/5')).toBeInTheDocument()
  })

  it('stays hidden at zero and disables comparison at one', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '直接清空' }))
    expect(screen.queryByLabelText('当前比较栏')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '添加候选1' }))
    expect(screen.getByText('比较栏 · 1/5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始比较' })).toBeDisabled()
  })

  it('requires an explicit replacement when a sixth work is added', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '添加候选1' }))
    await user.click(screen.getByRole('button', { name: '添加候选2' }))
    await user.click(screen.getByRole('button', { name: '添加候选3' }))
    expect(screen.getByText('比较栏 · 5/5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '添加候选4' }))
    expect(screen.getByRole('dialog', { name: '比较栏已满，请选择替换项' })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /替换/ })[0]!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('比较栏 · 5/5')).toBeInTheDocument()
  })
})
