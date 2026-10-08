import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../state'
import { ToastProvider } from '../components'
import { AdminAuthorVerificationPage } from './AdminAuthorVerificationPage'
import type { AuthSessionDto } from '../services/authService'

const session = { authenticated: true, user_id: '99999999-9999-4999-8999-999999999999', display_name: '审核员', csrf_token: 'csrf' } as AuthSessionDto
const item = { work_item_id: '11111111-1111-4111-8111-111111111111', target_id: '22222222-2222-4222-8222-222222222222', work_item_status: 'queued' as const, version: 1, domain_summary: { status: 'pending' }, created_at: '2026-10-08T00:00:00Z' }
const claimed = { ...item, work_item_status: 'claimed' as const, version: 2, claim_token: 'c'.repeat(43) }
const detail = { viewer_schema: 'reviewer' as const, verification_id: item.target_id, project_id: '33333333-3333-4333-8333-333333333333', creator_resolution_mode: 'create_new_creator' as const, creator_account_link_id: null, target_creator_id: null, new_creator_profile_input: { kind: 'team' as const, display_name: '团队', bio: '简介' }, requested_link_role: 'owner' as const, link_policy_snapshot: { policy_version: 'creator_link.v1' as const, target_creator_aggregate_version: null, owner_link_set_version: null, allowed_link_roles: ['owner' as const], default_link_role: 'owner' as const, allowed_permission_profile_refs: [{ profile_id: 'OWNER_V1' as const, profile_version: 1 as const, config_hash: 'a'.repeat(64) }], observed_owner_link_id: null, observed_owner_link_version: null, reused_link_id: null, reused_link_version: null }, method: 'manual_material', public_summary: '材料说明', material_ids: ['44444444-4444-4444-8444-444444444444'], evidence_refs: [], submission_revision: 1, status: 'pending' as const, review_work_item_id: item.work_item_id, version: 3 }

vi.mock('../features/auth/AuthSessionContext', () => ({ useAuthSession: () => ({ status: 'authenticated', session, acceptSession: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }) }))
const mocks = vi.hoisted(() => ({ listPending: vi.fn(), claim: vi.fn(), getClaimedDetail: vi.fn(), getReviewerMaterial: vi.fn(), createMaterialReadGrant: vi.fn(), preview: vi.fn(), confirm: vi.fn(), decide: vi.fn(), heartbeat: vi.fn(), release: vi.fn() }))
vi.mock('../services/developerReviewApi', () => ({ developerReviewApi: mocks }))
const mockedReviewApi = mocks

function renderPage() {
  const router = createMemoryRouter([{ path: '/admin/author-verification', element: <AdminAuthorVerificationPage /> }], { initialEntries: ['/admin/author-verification'] })
  return render(<AppStateProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></AppStateProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedReviewApi.listPending.mockResolvedValue([item])
  mockedReviewApi.claim.mockResolvedValue(claimed)
  mockedReviewApi.getClaimedDetail.mockResolvedValue(detail)
  mockedReviewApi.getReviewerMaterial.mockResolvedValue({ material_id: detail.material_ids[0]!, verification_id: item.target_id, status: 'ready', scan_result: 'clean', rejection_reason_code: null, pre_terminal_scan_result: null, scan_attempt_count: 1, next_scan_at: null, processing_deadline_at: null, declared_mime: 'application/pdf', detected_mime: 'application/pdf', byte_size: 12, checksum_match: true, read_grant_eligibility: 'eligible', version: 1 })
  mockedReviewApi.createMaterialReadGrant.mockResolvedValue({ read_url: '/api/v1/verification-material-read-grants/grant', expires_at: '2026-10-08T00:05:00Z' })
  mockedReviewApi.preview.mockResolvedValue({ preview_token: 'p'.repeat(43), confirmation_summary_hash: 'b'.repeat(64), conflict_principal_version: null })
  mockedReviewApi.confirm.mockResolvedValue({ confirm_token: 'f'.repeat(43) })
  mockedReviewApi.decide.mockResolvedValue({ review_decision_id: '55555555-5555-4555-8555-555555555555', resulting_status: 'verified', project_id: detail.project_id })
})

describe('AdminAuthorVerificationPage', () => {
  it('claims an identity request, grants controlled material access, and approves with server policy', async () => {
    const user = userEvent.setup()
    renderPage()
    const queue = await screen.findByRole('region', { name: '开发者身份审核队列' })
    await user.click(within(queue).getByRole('button', { name: '打开审核' }))
    expect(await screen.findByText('团队 · 团队')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看材料' }))
    expect(await screen.findByRole('link', { name: '打开受控材料' })).toHaveAttribute('href', '/api/v1/verification-material-read-grants/grant')
    await user.click(screen.getByRole('button', { name: '通过并留痕' }))
    await waitFor(() => expect(mockedReviewApi.decide).toHaveBeenCalledOnce())
    expect(mockedReviewApi.preview).toHaveBeenCalledWith(claimed, detail, session, 'approve', 'verification_approved')
    expect(mockedReviewApi.decide).toHaveBeenCalledWith(claimed, detail, 'p'.repeat(43), 'f'.repeat(43), session, 'approve', 'verification_approved', expect.any(String))
    expect(await screen.findByRole('status')).toHaveTextContent('身份审核决定已保存')
  })

  it('requires a reason before requesting supplements', async () => {
    const user = userEvent.setup()
    renderPage()
    const queue = await screen.findByRole('region', { name: '开发者身份审核队列' })
    await user.click(within(queue).getByRole('button', { name: '打开审核' }))
    await screen.findByText('团队 · 团队')
    await user.click(screen.getByRole('button', { name: '要求补充' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('要求补充、失败和争议操作必须填写原因')
    expect(mockedReviewApi.decide).not.toHaveBeenCalled()
  })

  it('marks legacy manager applications and prevents owner approval', async () => {
    const user = userEvent.setup()
    mockedReviewApi.getClaimedDetail.mockResolvedValueOnce({
      ...detail,
      requested_link_role: 'manager',
      link_policy_snapshot: {
        ...detail.link_policy_snapshot,
        allowed_link_roles: ['manager'],
        default_link_role: 'manager',
        allowed_permission_profile_refs: [{ profile_id: 'MANAGER_V1', profile_version: 1, config_hash: 'a'.repeat(64) }],
      },
    })
    renderPage()
    const queue = await screen.findByRole('region', { name: '开发者身份审核队列' })
    await user.click(within(queue).getByRole('button', { name: '打开审核' }))

    expect(await screen.findByText('历史管理者申请')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通过并留痕' })).toBeDisabled()
    expect(mockedReviewApi.decide).not.toHaveBeenCalled()
  })
})
