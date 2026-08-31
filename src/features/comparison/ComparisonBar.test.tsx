import { render, screen, within } from '@testing-library/react'
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

  it('opens the selected works drawer and rejects duplicates', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    expect(screen.getByText('比较栏 · 2/5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '开始比较' })).toHaveAttribute('href', '/compare/comparison-anonymous-pdf#structured-comparison-heading')
    await user.click(screen.getByRole('button', { name: '查看作品' }))
    expect(screen.getByRole('dialog', { name: '已选作品' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /移出/ })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '添加重复作品' }))
    expect(screen.getByText('这个作品已经在比较栏中。')).toBeInTheDocument()
    expect(screen.getByText('比较栏 · 2/5')).toBeInTheDocument()
  })

  it('closes the selected works drawer with its close control', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '查看作品' }))
    const drawer = screen.getByRole('dialog', { name: '已选作品' })
    await user.click(within(drawer).getByRole('button', { name: '关闭抽屉' }))
    expect(screen.queryByRole('dialog', { name: '已选作品' })).not.toBeInTheDocument()
  })

  it('removes individual works from the selected works drawer', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '查看作品' }))
    await user.click(screen.getAllByRole('button', { name: /移出/ })[0]!)
    expect(screen.getByText('比较栏 · 1/5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始比较' })).toBeDisabled()
  })

  it('keeps selected works when clear is cancelled and clears them after confirmation', async () => {
    const user = userEvent.setup(); render(<Harness />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '查看作品' }))
    await user.click(screen.getByRole('button', { name: '清空' }))
    const confirmation = screen.getByRole('dialog', { name: '清空比较栏？' })
    await user.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.getByText('比较栏 · 2/5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空' }))
    await user.click(within(screen.getByRole('dialog', { name: '清空比较栏？' })).getByRole('button', { name: '确认清空' }))
    expect(screen.queryByLabelText('当前比较栏')).not.toBeInTheDocument()
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
