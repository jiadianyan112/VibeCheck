import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { configureServiceRuntime } from '../services'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import { submissionDraftId, type SubmissionDraft } from '../types'

const draftId = submissionDraftId('draft-t39-review')

function seedDraft() {
  let state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  const draft: SubmissionDraft = {
    id: draftId,
    userId: prototypeUsers[0]!.id,
    status: 'draft',
    step: 'preview',
    fields: {
      currentName: '审核状态演示', publicUrl: 'https://example.test/review', screenshotUrl: null, accessStatus: 'normal', repositoryUrl: null,
      oneLineDefinition: '演示从提交到首次发布的完整状态。', targetUsers: ['university_students'], coreProblem: '审核状态不透明', useScenarios: ['daily_practice'], mainInputs: ['plain_text'], mainOutputs: ['practice_set'], coreFlow: [{ id: 'one', order: 1, label: '提交材料', description: '' }], practiceFormats: [], feedbackMethods: [], differentiation: '', aiCodingTools: ['codex'],
    },
    originalExtraction: {}, assetIds: [], duplicateProjectId: null, validationErrors: {}, reviewMessages: {}, submittedFields: null, submittedAssetIds: [], supplementalMaterial: '', publishedProjectId: null, publishedEventId: null,
    createdAt: '2026-07-31T10:00:00+08:00', updatedAt: '2026-07-31T10:20:00+08:00', submittedAt: null, withdrawnAt: null,
  }
  state = appReducer(state, { type: 'DRAFT_UPSERT', draft })
  persistAppState(state)
}

function renderReview(scenario = 'default') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/submit/new?draft=${draftId}&step=preview&scenario=${scenario}`] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedDraft(): SubmissionDraft {
  const state = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
  return state.submissionDrafts.find((draft: SubmissionDraft) => draft.id === draftId)
}

describe('submission preview and review status', () => {
  beforeEach(() => { localStorage.clear(); configureServiceRuntime({ defaultDelayMs: 0 }); seedDraft() })

  it('confirms once, shows pending without a fabricated ETA, saves material and withdraws', async () => {
    const user = userEvent.setup()
    renderReview()
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    expect(screen.getByLabelText('社区卡片预览')).toHaveTextContent('审核状态演示')
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    expect(screen.getByText(/不展示倒计时或承诺日期/)).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '补充说明或公开材料地址' }), 'https://example.test/material')
    await user.click(screen.getByRole('button', { name: '保存补充材料' }))
    await waitFor(() => expect(persistedDraft().supplementalMaterial).toBe('https://example.test/material'))
    await user.click(screen.getByRole('button', { name: '撤回审核' }))
    await user.click(screen.getByRole('button', { name: '确认撤回' }))
    expect(await screen.findByRole('heading', { name: '审核状态：已撤回' })).toBeInTheDocument()
    expect(persistedDraft().submittedFields?.currentName).toBe('审核状态演示')
  })

  it('creates a stable project and public first-published event after approval', async () => {
    const user = userEvent.setup()
    const { router } = renderReview('review_approved')
    await user.click(await screen.findByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：已通过' })).toBeInTheDocument()
    const approved = persistedDraft()
    expect(approved.publishedProjectId).toMatch(/^project-submission-/)
    expect(approved.publishedEventId).toMatch(/^event-submission-/)
    await user.click(screen.getByRole('link', { name: '进入作品详情' }))
    expect(await screen.findByRole('heading', { name: '审核状态演示', level: 1 })).toBeInTheDocument()
    await act(async () => { await router.navigate('/activity') })
    expect(await screen.findByText('审核状态演示通过审核并首次发布。')).toBeInTheDocument()
  })

  it('keeps the same submitted version when the review service fails and retries', async () => {
    const user = userEvent.setup()
    const { router } = renderReview()
    await user.click(await screen.findByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    await screen.findByRole('heading', { name: '审核状态：待审核' })
    const submittedAt = persistedDraft().submittedAt
    const submittedName = persistedDraft().submittedFields?.currentName
    await act(async () => { await router.navigate(`/submit/new?draft=${draftId}&step=preview&scenario=service_error`) })
    await user.click(screen.getByRole('button', { name: '刷新审核状态' }))
    expect(await screen.findByText('模拟服务暂时不可用，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByText('VC_SERVICE_UNAVAILABLE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(persistedDraft()).toMatchObject({ status: 'pending_review', submittedAt, submittedFields: { currentName: submittedName } })
  })
})
