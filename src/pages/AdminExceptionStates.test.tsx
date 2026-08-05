import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState, type AppState } from '../state'

function renderAdmin(path: string) {
  persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[3]!)))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<AppProviders><RouterProvider router={router} /></AppProviders>)
}

function storedState() {
  return JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as AppState
}

describe('T51 admin exception states', () => {
  beforeEach(() => localStorage.clear())

  it('keeps edits during a version conflict and supports compare then rebase', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/project/project-quizforge?scenario=version_conflict')
    const name = await screen.findByRole('textbox', { name: '当前名称' })
    await user.clear(name)
    await user.type(name, '题练工坊并发校订')
    await user.type(screen.getByRole('textbox', { name: '本次字段修改原因（必填）' }), '保留并发校订内容。')
    await user.click(screen.getByRole('button', { name: '保存允许字段' }))
    expect(await screen.findByRole('heading', { name: '并发版本冲突' })).toBeInTheDocument()
    expect(name).toHaveValue('题练工坊并发校订')
    expect(screen.getByText('比较版本')).toBeInTheDocument()
    expect(storedState().projectOverrides).toEqual([])
    await user.click(screen.getByRole('button', { name: '基于最新版本保留编辑内容' }))
    expect(name).toHaveValue('题练工坊并发校订')
    await user.click(screen.getByRole('button', { name: '保存允许字段' }))
    await waitFor(() => expect(storedState().projectOverrides[0]?.currentName).toMatchObject({ value: '题练工坊并发校订' }))
  })

  it('keeps edit content and reason after a save failure, then retries once', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/project/project-quizforge?scenario=save_error')
    const name = await screen.findByRole('textbox', { name: '当前名称' })
    const reason = screen.getByRole('textbox', { name: '本次字段修改原因（必填）' })
    await user.clear(name)
    await user.type(name, '题练工坊保存重试')
    await user.type(reason, '模拟失败后重试。')
    await user.click(screen.getByRole('button', { name: '保存允许字段' }))
    expect(await screen.findByText(/保存服务暂时失败/)).toBeInTheDocument()
    expect(name).toHaveValue('题练工坊保存重试')
    expect(reason).toHaveValue('模拟失败后重试。')
    expect(storedState().projectOverrides).toEqual([])
    await user.click(screen.getByRole('button', { name: '重试保存' }))
    await waitFor(() => expect(storedState().projectOverrides[0]?.currentName).toMatchObject({ value: '题练工坊保存重试' }))
    expect(storedState().adminAuditLogs.filter((log) => log.fieldKey === 'currentName')).toHaveLength(1)
  })

  it('shows an explicit evidence-missing state instead of inventing a source', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/project/project-quizforge?scenario=evidence_missing')
    await user.click(await screen.findByRole('button', { name: '核对一句话定义证据' }))
    const dialog = screen.getByRole('dialog', { name: '一句话定义 · 证据核对' })
    expect(within(dialog).getByText('没有可引用证据')).toBeInTheDocument()
    expect(within(dialog).getByText(/请在证据管理中补充，不要猜测/)).toBeInTheDocument()
  })

  it('detects a duplicate review and creates only one review, event and notification after refresh', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/reviews?scenario=duplicate_review')
    const queue = await screen.findByRole('region', { name: '发布审核队列' })
    const reason = screen.getByRole('textbox', { name: '本次操作原因（必填）' })
    await user.type(reason, '复用已存在审核单。')
    await user.click(within(queue).getByRole('button', { name: '通过' }))
    expect(await screen.findByText(/检测到同一提交版本已有审核单/)).toBeInTheDocument()
    expect(reason).toHaveValue('复用已存在审核单。')
    expect(storedState().adminWorkflowLogs).toEqual([])
    await user.click(screen.getByRole('button', { name: '刷新现有审核单' }))
    await user.click(within(queue).getByRole('button', { name: '通过' }))
    await user.click(screen.getByRole('button', { name: '确认并留痕' }))
    await waitFor(() => expect(storedState().adminWorkflowLogs.filter((log) => log.action === 'publication_approved')).toHaveLength(1))
    const state = storedState()
    expect(new Set(state.lifecycleEventAdditions.map((event) => event.id)).size).toBe(state.lifecycleEventAdditions.length)
    expect(new Set(state.notifications.map((notification) => notification.id)).size).toBe(state.notifications.length)
  })
})
