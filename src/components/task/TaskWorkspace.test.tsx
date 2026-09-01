import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ErrorSummary,
  LivePreview,
  StatusBeacon,
  StepRail,
  TaskShell,
  type TaskStepItem,
} from './index'

const steps: TaskStepItem[] = [
  { id: 'address', label: '检查地址', state: 'complete' },
  { id: 'details', label: '基础信息', state: 'current' },
  { id: 'preview', label: '预览与提交', state: 'upcoming' },
]

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

describe('shared submission task workspace components', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: originalScrollIntoView,
    })
    vi.unstubAllGlobals()
  })

  it('renders the task shell with a semantic header, rail, main content, and optional aside', () => {
    render(
      <TaskShell
        eyebrow="发布作品"
        title="把作品交给 VibeCheck"
        description={<p>完成六个阶段，随时可以保存。</p>}
        rail={<StepRail steps={steps} />}
        aside={<p>当前进度：已保存</p>}
      >
        <form aria-label="作品资料"><label htmlFor="task-name">作品名称</label><input id="task-name" /></form>
      </TaskShell>,
    )

    expect(screen.getByRole('heading', { name: '把作品交给 VibeCheck', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('发布作品')).toHaveClass('task-shell__eyebrow')
    expect(screen.getByRole('navigation', { name: '任务步骤' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('form', { name: '作品资料' }))
    expect(screen.getByRole('complementary', { name: '任务上下文' })).toContainElement(screen.getByText('当前进度：已保存'))
  })

  it('marks only the current step and keeps upcoming steps non-interactive', async () => {
    const onStepSelect = vi.fn()
    render(<StepRail steps={steps} onStepSelect={onStepSelect} />)

    expect(document.querySelector('[data-step-id="details"]')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '检查地址' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '预览与提交' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-step-id="preview"]')).toHaveAttribute('data-step-state', 'upcoming')

    await userEvent.setup().click(screen.getByRole('button', { name: '检查地址' }))
    expect(onStepSelect).toHaveBeenCalledWith(steps[0])
  })

  it('keeps the current step visible when the horizontal rail mounts or advances', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
    const firstSteps: TaskStepItem[] = [
      { id: 'address', label: '检查地址', state: 'complete' },
      { id: 'prefill', label: '基础信息', state: 'complete' },
      { id: 'definition', label: '定位与用途', state: 'current' },
      { id: 'solution', label: '核心内容', state: 'upcoming' },
      { id: 'development', label: '开发与资产', state: 'upcoming' },
      { id: 'preview', label: '预览与提交', state: 'upcoming' },
    ]
    const { rerender } = render(<StepRail steps={firstSteps} />)

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }))
    scrollIntoView.mockClear()

    rerender(<StepRail steps={firstSteps.map((step) => step.id === 'solution' ? { ...step, state: 'current' } : step.id === 'definition' ? { ...step, state: 'complete' } : step)} />)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }))
  })

  it('uses instant nearest scrolling for the current step when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width') || query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })

    render(<StepRail steps={steps} />)

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'nearest' }))
  })

  it('renders live preview content without owning an input or draft state', () => {
    render(
      <LivePreview eyebrow="实时预览" title="即将展示的作品">
        <p>这是从当前草稿推导出的摘要。</p>
      </LivePreview>,
    )

    expect(screen.getByRole('region', { name: '即将展示的作品' })).toHaveClass('live-preview')
    expect(screen.getByText('这是从当前草稿推导出的摘要。')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('announces errors assertively and ordinary progress politely', () => {
    const { rerender } = render(<StatusBeacon tone="error" label="无法保存" detail="请重试。" />)

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByText('无法保存')).toBeInTheDocument()
    expect(screen.getByText('请重试。')).toBeInTheDocument()

    rerender(<StatusBeacon tone="progress" label="正在保存" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('focuses and scrolls each error target when an error link is activated', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    const field = document.createElement('input')
    field.id = 'project-name'
    field.scrollIntoView = scrollIntoView
    const focus = vi.spyOn(field, 'focus')
    document.body.append(field)

    render(
      <ErrorSummary
        errors={[{ fieldId: 'project-name', label: '作品名称', message: '请填写作品名称。' }]}
      />,
    )

    expect(screen.getByRole('link', { name: '作品名称' })).toHaveAttribute('href', '#project-name')
    expect(screen.getByText('请填写作品名称。')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '作品名称' }))
    expect(focus).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('uses instant scrolling when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    const field = document.createElement('input')
    field.id = 'project-summary'
    field.scrollIntoView = scrollIntoView
    document.body.append(field)

    render(
      <ErrorSummary
        errors={[{ fieldId: 'project-summary', label: '作品简介', message: '请填写作品简介。' }]}
      />,
    )

    await user.click(screen.getByRole('link', { name: '作品简介' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
  })
})
