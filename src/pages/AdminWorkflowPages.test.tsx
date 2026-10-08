import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState, type AppState } from '../state'

const identityMocks = vi.hoisted(() => ({
  listPending: vi.fn(), claim: vi.fn(), getClaimedDetail: vi.fn(), getReviewerMaterial: vi.fn(), createMaterialReadGrant: vi.fn(), preview: vi.fn(), confirm: vi.fn(), decide: vi.fn(), heartbeat: vi.fn(), release: vi.fn(),
}))
const identitySession = vi.hoisted(() => ({ authenticated: true, user_id: '99999999-9999-4999-8999-999999999999', display_name: '审核员', account_status: 'active', roles: ['admin'], primary_role: 'admin', permissions: ['admin:identity_review'], session_version: 1, csrf_token: 'csrf', recent_auth_at: '2026-10-08T00:00:00Z', expires_at: '2026-10-09T00:00:00Z' }))
vi.mock('../features/auth/AuthSessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/auth/AuthSessionContext')>()
  return { ...actual, useAuthSession: () => ({ status: 'authenticated', session: identitySession, acceptSession: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }) }
})
vi.mock('../services/developerReviewApi', () => ({
  developerReviewApi: identityMocks,
  DeveloperReviewApiError: class DeveloperReviewApiError extends Error {},
}))

const identityItem = { work_item_id: '11111111-1111-4111-8111-111111111111', target_id: '22222222-2222-4222-8222-222222222222', work_item_status: 'queued', version: 1, domain_summary: { status: 'pending' }, created_at: '2026-10-08T00:00:00Z' }
const identityClaimed = { ...identityItem, work_item_status: 'claimed', version: 2, claim_token: 'c'.repeat(43) }
const identityDetail = { viewer_schema: 'reviewer', verification_id: identityItem.target_id, project_id: '33333333-3333-4333-8333-333333333333', creator_resolution_mode: 'create_new_creator', creator_account_link_id: null, target_creator_id: null, new_creator_profile_input: { kind: 'team', display_name: 'VibeCheck Studio', bio: '团队简介' }, requested_link_role: 'owner', link_policy_snapshot: { policy_version: 'creator_link.v1', target_creator_aggregate_version: null, owner_link_set_version: null, allowed_link_roles: ['owner'], default_link_role: 'owner', allowed_permission_profile_refs: [{ profile_id: 'OWNER_V1', profile_version: 1, config_hash: 'a'.repeat(64) }], observed_owner_link_id: null, observed_owner_link_version: null, reused_link_id: null, reused_link_version: null }, method: 'manual_material', public_summary: '材料说明', material_ids: ['44444444-4444-4444-8444-444444444444'], evidence_refs: [], submission_revision: 1, status: 'pending', review_work_item_id: identityItem.work_item_id, version: 3 }

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
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    identityMocks.listPending.mockResolvedValue([identityItem])
    identityMocks.claim.mockResolvedValue(identityClaimed)
    identityMocks.getClaimedDetail.mockResolvedValue(identityDetail)
    identityMocks.getReviewerMaterial.mockResolvedValue({ material_id: identityDetail.material_ids[0], verification_id: identityItem.target_id, status: 'ready', scan_result: 'clean', rejection_reason_code: null, pre_terminal_scan_result: null, scan_attempt_count: 1, next_scan_at: null, processing_deadline_at: null, declared_mime: 'application/pdf', detected_mime: 'application/pdf', byte_size: 12, checksum_match: true, read_grant_eligibility: 'eligible', version: 1 })
    identityMocks.createMaterialReadGrant.mockResolvedValue({ read_url: '/api/v1/verification-material-read-grants/grant', expires_at: '2026-10-08T00:05:00Z' })
    identityMocks.preview.mockResolvedValue({ preview_token: 'p'.repeat(43), confirmation_summary_hash: 'b'.repeat(64), conflict_principal_version: null })
    identityMocks.confirm.mockResolvedValue({ confirm_token: 'f'.repeat(43) })
    identityMocks.decide.mockResolvedValue({ review_decision_id: '55555555-5555-4555-8555-555555555555', resulting_status: 'verified', project_id: identityDetail.project_id })
  })

  it('approves publication with confirmation and syncs the public project', async () => {
    const user = userEvent.setup()
    const router = renderAdmin('/admin/reviews')
    const queue = await screen.findByRole('region', { name: '发布审核队列' })
    expect(within(queue).getByText('词汇回声')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '本次操作原因（通过可选，其余必填）' }), '公开页面与提交版本一致。')
    await user.click(within(queue).getByRole('button', { name: '通过' }))
    await user.click(screen.getByRole('button', { name: '确认并留痕' }))
    await waitFor(() => {
      expect(storedState().submissionDrafts.find((draft) => draft.id === 'draft-mia-vocab-review')).toMatchObject({ status: 'approved' })
      expect(screen.queryByRole('region', { name: '发布审核队列' })).not.toBeInTheDocument()
    })
    const state = storedState()
    const publishedId = state.submissionDrafts.find((draft) => draft.id === 'draft-mia-vocab-review')!.publishedProjectId!
    expect(state.notifications.at(-1)).toMatchObject({ userId: 'user-mia', type: 'submission_reviewed' })
    expect(state.adminWorkflowLogs.at(-1)).toMatchObject({ action: 'publication_approved', reason: '公开页面与提交版本一致。' })
    await act(async () => { await router.navigate(`/project/${publishedId}`) })
    expect(await screen.findByRole('heading', { name: '词汇回声', level: 1 })).toBeInTheDocument()
  })

  it('approves a publication without a written reason but still requires one for return', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/reviews')
    const queue = await screen.findByRole('region', { name: '发布审核队列' })
    await user.click(within(queue).getAllByRole('button', { name: '退回' })[0]!)
    expect(screen.getByRole('alert')).toHaveTextContent('退回、拒绝和争议操作必须填写原因。')
    await user.click(within(queue).getAllByRole('button', { name: '通过' })[0]!)
    await user.click(screen.getByRole('button', { name: '确认并留痕' }))
    await waitFor(() => expect(storedState().adminWorkflowLogs.at(-1)).toMatchObject({ action: 'publication_approved', reason: '未填写原因（审核通过）' }))
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
    const queue = await screen.findByRole('region', { name: '开发者身份审核队列' })
    await user.click(within(queue).getByRole('button', { name: '打开审核' }))
    expect(await screen.findByText('团队 · VibeCheck Studio')).toBeInTheDocument()
    expect(screen.queryByText(/private:\/\/verification\//)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看材料' }))
    expect(await screen.findByRole('link', { name: '打开受控材料' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '通过并留痕' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('身份审核决定已保存'))
  })

  it('verifies identity without a written reason but requires one when requesting changes', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/author-verification')
    const queue = await screen.findByRole('region', { name: '开发者身份审核队列' })
    await user.click(within(queue).getByRole('button', { name: '打开审核' }))
    await user.click(screen.getByRole('button', { name: '要求补充' }))
    expect(screen.getByRole('alert')).toHaveTextContent('要求补充、失败和争议操作必须填写原因。')
    expect(identityMocks.decide).not.toHaveBeenCalled()
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
