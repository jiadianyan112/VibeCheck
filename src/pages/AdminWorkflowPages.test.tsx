import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState, type AppState } from '../state'

function renderAdmin(path: string, userIndex = 3) {
  persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[userIndex]!)))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  return router
}

function storedState() {
  return JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as AppState
}

describe('T50 admin workflow pages', () => {
  beforeEach(() => localStorage.clear())

  it('approves publication with confirmation and syncs the public project', async () => {
    const user = userEvent.setup()
    const router = renderAdmin('/admin/reviews')
    const queue = await screen.findByRole('region', { name: '发布审核队列' })
    expect(within(queue).getByText('词汇回声')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '本次操作原因（必填）' }), '公开页面与提交版本一致。')
    await user.click(within(queue).getByRole('button', { name: '通过' }))
    await user.click(screen.getByRole('button', { name: '确认并留痕' }))
    await waitFor(() => expect(storedState().submissionDrafts.find((draft) => draft.id === 'draft-mia-vocab-review')).toMatchObject({ status: 'approved' }))
    const state = storedState()
    const publishedId = state.submissionDrafts.find((draft) => draft.id === 'draft-mia-vocab-review')!.publishedProjectId!
    expect(state.notifications.at(-1)).toMatchObject({ userId: 'user-mia', type: 'submission_reviewed' })
    expect(state.adminWorkflowLogs.at(-1)).toMatchObject({ action: 'publication_approved', reason: '公开页面与提交版本一致。' })
    await act(async () => { await router.navigate(`/project/${publishedId}`) })
    expect(await screen.findByRole('heading', { name: '词汇回声', level: 1 })).toBeInTheDocument()
  })

  it('keeps high-risk controls disabled for an editor', async () => {
    renderAdmin('/admin/reviews', 2)
    expect(await screen.findByRole('button', { name: '标争议' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '限制展示' })).toBeDisabled()
  })

  it('merges duplicate records, preserves history and resolves the old public id', async () => {
    const user = userEvent.setup()
    const router = renderAdmin('/admin/duplicates')
    await screen.findByRole('heading', { name: '重复与合并' })
    await user.type(screen.getByRole('textbox', { name: '合并原因（必填）' }), '地址和产品结构核对为同一作品。')
    await user.click(screen.getByRole('button', { name: '确认合并候选' }))
    await user.click(screen.getByRole('button', { name: '合并并保留映射' }))
    await waitFor(() => expect(storedState().projectAliases['project-pdfquizlab']).toBe('project-quizforge'))
    const state = storedState()
    expect(state.projectOverrides.find((project) => project.id === 'project-pdfquizlab')).toMatchObject({ reviewStatus: 'archived' })
    expect(state.projectOverrides.find((project) => project.id === 'project-quizforge')?.historicalUrls).toEqual(expect.arrayContaining([expect.objectContaining({ url: 'https://example.test/products/project-pdfquizlab' })]))
    await act(async () => { await router.navigate('/project/project-pdfquizlab') })
    expect(await screen.findByText('作品页面已合并')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '题练工坊', level: 1 })).toBeInTheDocument()
  })

  it('reviews identity while keeping private material out of public audit output', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/author-verification')
    expect(await screen.findByText('private://verification/verification-mia-pdfquizlab')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '本次身份审核原因（必填）' }), '公开主页与作品地址相互关联。')
    await user.click(screen.getByRole('button', { name: '通过' }))
    await user.click(screen.getByRole('button', { name: '确认并留痕' }))
    await waitFor(() => expect(storedState().verificationRequests.find((request) => request.id === 'verification-mia-pdfquizlab')).toMatchObject({ status: 'verified' }))
    const state = storedState()
    expect(state.projectOverrides.find((project) => project.id === 'project-pdfquizlab')).toMatchObject({ authorLinkStatus: 'linked' })
    expect(JSON.stringify(state.adminWorkflowLogs)).not.toContain('private://verification/')
  })

  it('records the first URL anomaly without applying the proposed terminal state', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/status-monitor', 2)
    await screen.findByRole('heading', { name: '状态监测' })
    await user.selectOptions(screen.getByRole('combobox', { name: '拟确认状态' }), 'ended')
    await user.type(screen.getByRole('textbox', { name: '状态复核原因（必填）' }), '首次技术异常，等待第二来源复查。')
    await user.click(screen.getByRole('button', { name: '记录首次检查并进入待复查' }))
    await user.click(screen.getByRole('button', { name: '确认并留痕' }))
    await waitFor(() => expect(Object.values(storedState().statusReviewCounts)).toContain(1))
    const state = storedState()
    const reviewedId = Object.keys(state.statusReviewCounts)[0]!
    const project = state.projectOverrides.find((item) => item.id === reviewedId)!
    expect(project.reviewStatus).toBe('update_pending')
    expect(project.accessStatus).not.toMatchObject({ state: 'known', value: 'ended' })
    expect(state.adminWorkflowLogs.at(-1)).toMatchObject({ action: 'status_recheck_queued', afterValue: 'pending_recheck' })
  })
})
