import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { configureServiceRuntime } from '../services'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import type { AuthorVerificationRequest } from '../types'

const projectPath = '/project/project-pdfquizlab'

function seedUser() {
  const state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  persistAppState(state)
}

function renderVerification(scenario = 'default') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`${projectPath}/verify-author?scenario=${scenario}`] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedRequest(): AuthorVerificationRequest {
  const state = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
  return state.verificationRequests[0]
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, privateReference: string) {
  await user.click(await screen.findByRole('radio', { name: '代码仓库' }))
  await user.type(screen.getByRole('textbox', { name: '材料摘要' }), '仓库公开页面包含作品域名与维护者资料。')
  await user.type(screen.getByRole('textbox', { name: '私有材料引用' }), privateReference)
  await user.click(screen.getByRole('button', { name: '提交人工审核' }))
}

describe('author verification page', () => {
  beforeEach(() => { localStorage.clear(); configureServiceRuntime({ defaultDelayMs: 0 }); seedUser() })

  it('stores materials only in the private request and shows pending without an ETA', async () => {
    const user = userEvent.setup()
    const { router } = renderVerification()
    await fillAndSubmit(user, 'private://secret-pending-material')
    expect(await screen.findByRole('heading', { name: '待人工审核' })).toBeInTheDocument()
    expect(screen.getByText(/不展示倒计时/)).toBeInTheDocument()
    await waitFor(() => expect(persistedRequest().privateMaterialReference).toBe('private://secret-pending-material'))
    await act(async () => { await router.navigate(projectPath) })
    expect(await screen.findByRole('heading', { name: 'PDF 题库实验室', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('private://secret-pending-material')).not.toBeInTheDocument()
  })

  it('links the existing project and enables management after a successful manual review', async () => {
    const user = userEvent.setup()
    const { router } = renderVerification('review_approved')
    await fillAndSubmit(user, 'private://secret-approved-material')
    expect(await screen.findByRole('heading', { name: '验证成功' })).toBeInTheDocument()
    expect(screen.getByText('作品数量').parentElement).toHaveTextContent('保持不变')
    expect(screen.getByRole('link', { name: '补充产品信息' })).toHaveAttribute('href', '/project/project-pdfquizlab/update?type=product')
    await act(async () => { await router.navigate(projectPath) })
    expect(await screen.findByRole('link', { name: '管理作品' })).toBeInTheDocument()
    expect(screen.getByText(/米娅 · 已验证管理权限/)).toBeInTheDocument()
    expect(screen.queryByText('private://secret-approved-material')).not.toBeInTheDocument()
  })

  it('freezes high-risk edits for a disputed ownership claim', async () => {
    const user = userEvent.setup()
    const { router } = renderVerification('verification_disputed')
    await fillAndSubmit(user, 'private://secret-disputed-material')
    expect(await screen.findByRole('heading', { name: '归属争议' })).toBeInTheDocument()
    expect(screen.getByText('高风险编辑已冻结')).toBeInTheDocument()
    await act(async () => { await router.navigate(projectPath) })
    expect(await screen.findByText('归属争议处理中')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '管理作品' })).not.toBeInTheDocument()
    expect(screen.queryByText('private://secret-disputed-material')).not.toBeInTheDocument()
  })
})
