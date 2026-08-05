import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState, type AppState } from '../state'

function renderEditor(path = '/admin/project/project-quizforge', userIndex = 2) {
  persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[userIndex]!)))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  return { ...result, router }
}

function storedState() {
  return JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as AppState
}

describe('T48 admin project editor', () => {
  beforeEach(() => localStorage.clear())

  it('shows all maintenance modules and field-level trust metadata', async () => {
    renderEditor()
    expect(await screen.findByRole('heading', { name: '编辑 题练工坊' })).toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: '作品编辑模块' })
    for (const label of ['身份', '定义', '方案', '功能', '开发', '状态', '历史', '资产', '关系']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(screen.getAllByText('来源').length).toBeGreaterThan(10)
    expect(screen.getAllByText('验证时间').length).toBeGreaterThan(10)
    expect(screen.getAllByText('可信类型').length).toBeGreaterThan(10)
    expect(screen.getByRole('link', { name: '通过状态复核处理地址迁移' })).toHaveAttribute('href', '/admin/status-monitor')
    expect(screen.getByText(/迁移、暂停、结束、限制展示和归属争议不能在普通保存中被覆盖/)).toBeInTheDocument()
  })

  it('saves allowed fields to the shared record and immediately syncs the public detail', async () => {
    const user = userEvent.setup()
    const { router } = renderEditor()
    const name = await screen.findByRole('textbox', { name: '当前名称' })
    await user.clear(name)
    await user.type(name, '题练工坊 · 后台校订')
    await user.clear(screen.getByRole('textbox', { name: '核心功能' }))
    await user.type(screen.getByRole('textbox', { name: '核心功能' }), '材料导入\n分层练习')
    await user.click(screen.getByRole('button', { name: '保存允许字段' }))

    expect(await screen.findByRole('status')).toHaveTextContent('作品字段已保存并同步前台')
    await waitFor(() => expect(storedState().projectOverrides[0]?.currentName).toMatchObject({ value: '题练工坊 · 后台校订' }))
    expect(storedState().projectOverrides[0]?.publicUrl).toMatchObject({ value: 'https://example.test/products/project-quizforge' })
    expect(storedState().projectOverrides[0]?.accessStatus).toMatchObject({ value: 'normal' })

    await act(async () => { await router.navigate('/project/project-quizforge') })
    expect(await screen.findByRole('heading', { name: '题练工坊 · 后台校订' })).toBeInTheDocument()
  })

  it('shows editor versus administrator permissions on an administrator-only field', async () => {
    const editor = renderEditor()
    expect(await screen.findByRole('textbox', { name: '原始收录平台' })).toBeDisabled()
    editor.unmount()
    localStorage.clear()

    renderEditor('/admin/project/project-quizforge', 3)
    expect(await screen.findByRole('textbox', { name: '原始收录平台' })).toBeEnabled()
    expect(screen.getByText('管理员可编辑')).toBeInTheDocument()
  })

  it('keeps invalid edits unsaved and marks the corresponding module', async () => {
    const user = userEvent.setup()
    renderEditor()
    const name = await screen.findByRole('textbox', { name: '当前名称' })
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: '保存允许字段' }))

    expect(screen.getByText('作品名称不能为空。')).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByRole('navigation', { name: '作品编辑模块' })).toHaveTextContent('身份 · 有错误')
    expect(storedState().projectOverrides).toEqual([])
  })

  it('provides a stable exit for a missing project id', async () => {
    renderEditor('/admin/project/project-missing')
    expect(await screen.findByText('后台未找到对应作品')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回作品列表' })).toHaveAttribute('href', '/admin/projects')
  })
})
