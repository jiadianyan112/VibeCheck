import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../state'
import { ToastProvider } from '../components'
import { AuthorVerificationPage } from './AuthorVerificationPage'
import { projectService } from '../services/projectService'
import type { AuthSessionDto } from '../services/authService'
import type { Project } from '../types'

const session = { authenticated: true, user_id: '11111111-1111-4111-8111-111111111111', display_name: '林舟', csrf_token: 'csrf' } as AuthSessionDto
const project = { id: '22222222-2222-4222-8222-222222222222', currentName: { state: 'known', value: '真实作品' } } as unknown as Project
const request = {
  verification_id: '33333333-3333-4333-8333-333333333333', project_id: project.id,
  creator_resolution_mode: 'create_new_creator', creator_account_link_id: null, target_creator_id: null,
  new_creator_profile_input: { kind: 'individual', display_name: '林舟', bio: '', avatar_url: null, website_url: null },
  requested_link_role: 'owner', provisional_link_policy: null, link_policy_snapshot: null,
  method: 'manual_material', public_summary: '我维护并开发这个作品。', material_summaries: [], status: 'draft',
  status_history: [{ status: 'draft', at: '2026-10-08T00:00:00Z' }], latest_public_review_message: null,
  supersedes_verification_id: null, resulting_creator_id: null, resulting_link_id: null, resulting_author_relation_id: null,
  resulting_profile_version_id: null, approved_link_role: null, approved_permission_profile_ref: null,
  version: 1, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z',
} as const

vi.mock('../features/auth/AuthSessionContext', () => ({ useAuthSession: () => ({ status: 'authenticated', session, acceptSession: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }) }))
const mocks = vi.hoisted(() => {
  class MockVerificationApiError extends Error {
    constructor(readonly code: string, readonly status: number, readonly retryable = false) {
      super(code)
      this.name = 'VerificationApiError'
    }
  }
  class MockDeveloperApiError extends Error {
    constructor(readonly code: string, readonly status: number) {
      super(code)
      this.name = 'DeveloperApiError'
    }
  }
  return {
    VerificationApiError: MockVerificationApiError,
    DeveloperApiError: MockDeveloperApiError,
    projectGetById: vi.fn(), developerListMyProjects: vi.fn(), get: vi.fn(), listMyCreatorLinks: vi.fn(), create: vi.fn(), patch: vi.fn(), prepareMaterial: vi.fn(), uploadMaterial: vi.fn(), completeMaterial: vi.fn(), getMaterial: vi.fn(), submit: vi.fn(), withdraw: vi.fn(),
  }
})
vi.mock('../services/projectService', () => ({ projectService: { getById: mocks.projectGetById } }))
vi.mock('../services/verificationApi', () => ({ verificationApi: mocks, VerificationApiError: mocks.VerificationApiError }))
vi.mock('../services/developerApi', () => ({ developerApi: { listMyProjects: mocks.developerListMyProjects }, DeveloperApiError: mocks.DeveloperApiError }))

const mockedProjectService = vi.mocked(projectService)
const mockedVerificationApi = mocks

function renderPage() {
  const router = createMemoryRouter([{ path: '/project/:id/verify-author', element: <AuthorVerificationPage /> }], { initialEntries: ['/project/22222222-2222-4222-8222-222222222222/verify-author'] })
  return render(<AppStateProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></AppStateProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) } })
  mockedProjectService.getById.mockResolvedValue({ ok: true, data: project })
  mockedVerificationApi.developerListMyProjects.mockResolvedValue({ items: [], next_cursor: null })
  mockedVerificationApi.get.mockResolvedValue(null)
  mockedVerificationApi.listMyCreatorLinks.mockResolvedValue([])
  mockedVerificationApi.create.mockResolvedValue(request)
  mockedVerificationApi.patch.mockResolvedValue({ ...request, version: 2, status: 'draft' })
  mockedVerificationApi.prepareMaterial.mockResolvedValue({ material: { material_id: '44444444-4444-4444-8444-444444444444', verification_id: request.verification_id, applicant_scan_state: 'pending', reason_key: null, next_action: 'complete_upload', upload_expires_at: null, version: 1 }, upload_url: 'https://upload.example.test/material', upload_headers: {}, upload_expires_at: '2026-10-08T01:00:00Z' })
  mockedVerificationApi.uploadMaterial.mockResolvedValue(undefined)
  mockedVerificationApi.completeMaterial.mockResolvedValue({ material: { material_id: '44444444-4444-4444-8444-444444444444', verification_id: request.verification_id, applicant_scan_state: 'pending', reason_key: null, next_action: 'wait', upload_expires_at: null, version: 2 }, scan_queued: true })
  mockedVerificationApi.getMaterial.mockResolvedValue({ material_id: '44444444-4444-4444-8444-444444444444', verification_id: request.verification_id, applicant_scan_state: 'accepted', reason_key: null, next_action: 'continue_submission', upload_expires_at: null, version: 3 })
  mockedVerificationApi.submit.mockResolvedValue({ ...request, version: 4, status: 'pending', material_summaries: [{ material_id: '44444444-4444-4444-8444-444444444444', verification_id: request.verification_id, applicant_scan_state: 'accepted', reason_key: null, next_action: 'continue_submission', upload_expires_at: null, version: 3 }] })
})

describe('AuthorVerificationPage', () => {
  it('prefills the developer form from the project camelCase profile', async () => {
    mockedProjectService.getById.mockResolvedValueOnce({
      ok: true,
      data: {
        ...project,
        developer: {
          kind: 'team',
          displayName: '微光工作室',
          avatarUrl: 'https://example.test/logo.png',
          websiteUrl: 'https://example.test/',
          creatorId: null,
          verificationStatus: 'unverified',
        },
      } as unknown as Project,
    })

    renderPage()

    expect(await screen.findByLabelText('团队名称')).toHaveValue('微光工作室')
    expect(screen.getByLabelText('头像或团队 Logo 地址（可选）')).toHaveValue('https://example.test/logo.png')
    expect(screen.getByLabelText('官网（可选）')).toHaveValue('https://example.test/')
  })

  it('shows the real loading error and retries instead of reporting a missing project', async () => {
    const user = userEvent.setup()
    mockedVerificationApi.listMyCreatorLinks.mockRejectedValueOnce(new mockedVerificationApi.VerificationApiError('CREATOR_LINKS_UNAVAILABLE', 503, true))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('操作未完成（CREATOR_LINKS_UNAVAILABLE）')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '认领作品' })).toBeInTheDocument()
    expect(mockedVerificationApi.listMyCreatorLinks).toHaveBeenCalledTimes(2)
  })

  it('creates a server draft, uploads clean material, and submits only after the scan is accepted', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('heading', { name: '认领作品' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '材料说明' }), '我维护并开发这个作品，材料可在公开仓库核对。')
    await user.upload(screen.getByLabelText('上传证明材料'), new File(['proof'], 'proof.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: '提交身份审核' }))
    await waitFor(() => expect(mockedVerificationApi.create).toHaveBeenCalledOnce())
    expect(mockedVerificationApi.patch).toHaveBeenCalledWith(session, request.verification_id, expect.objectContaining({ expected_version: 1, requested_link_role: 'owner' }))
    expect(mockedVerificationApi.prepareMaterial).toHaveBeenCalledWith(session, expect.objectContaining({ verification_id: request.verification_id, declared_mime: 'application/pdf' }))
    expect(mockedVerificationApi.completeMaterial).toHaveBeenCalledOnce()
    expect(mockedVerificationApi.submit).toHaveBeenCalledWith(session, request.verification_id, 2, ['44444444-4444-4444-8444-444444444444'])
    expect(await screen.findByRole('heading', { name: '待人工审核' })).toBeInTheDocument()
  })

  it('shows a recoverable version conflict without discarding the form', async () => {
    const user = userEvent.setup()
    mockedVerificationApi.patch.mockRejectedValueOnce(new mockedVerificationApi.VerificationApiError('VERIFICATION_VERSION_CONFLICT', 409, true))
    renderPage()
    await user.type(await screen.findByRole('textbox', { name: '材料说明' }), '我维护并开发这个作品，材料可在公开仓库核对。')
    await user.upload(screen.getByLabelText('上传证明材料'), new File(['proof'], 'proof.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: '提交身份审核' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('申请已在其他设备更新')
    expect(screen.getByRole('textbox', { name: '材料说明' })).toHaveValue('我维护并开发这个作品，材料可在公开仓库核对。')
  })

  it('retries a failed patch on the created draft without posting a second draft', async () => {
    const user = userEvent.setup()
    const createdVerificationId = '66666666-6666-4666-8666-666666666666'
    const createdRequest = { ...request, verification_id: createdVerificationId }
    mockedVerificationApi.create.mockResolvedValueOnce(createdRequest)
    mockedVerificationApi.patch
      .mockRejectedValueOnce(new mockedVerificationApi.VerificationApiError('NETWORK_UNAVAILABLE', 0, true))
      .mockResolvedValueOnce({ ...createdRequest, version: 2, status: 'draft' as const })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: '材料说明' }), '我维护并开发这个作品，材料可在公开仓库核对。')
    await user.upload(screen.getByLabelText('上传证明材料'), new File(['proof'], 'proof.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: '提交身份审核' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接失败')
    expect(mockedVerificationApi.create).toHaveBeenCalledOnce()
    expect(mockedVerificationApi.patch).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '提交身份审核' }))
    await waitFor(() => expect(mockedVerificationApi.patch).toHaveBeenCalledTimes(2))
    expect(mockedVerificationApi.create).toHaveBeenCalledOnce()
    expect(mockedVerificationApi.patch.mock.calls[1]?.[1]).toBe(createdVerificationId)
  })

  it('recovers the latest verification id from the cross-device projects endpoint', async () => {
    mockedVerificationApi.developerListMyProjects.mockResolvedValue({ items: [{ project_id: project.id, current_name: '真实作品', developer: null, verification_id: request.verification_id, verification_status: 'pending', can_manage: false }], next_cursor: null })
    mockedVerificationApi.get.mockResolvedValue({ ...request, status: 'pending' })

    renderPage()

    expect(await screen.findByRole('heading', { name: '待人工审核' })).toBeInTheDocument()
    expect(mockedVerificationApi.developerListMyProjects).toHaveBeenCalledWith({ projectId: project.id })
    expect(mockedVerificationApi.get).toHaveBeenCalledWith(session, request.verification_id)
  })

  it.each(['failed', 'withdrawn'] as const)('keeps the %s request id when reapplying after a cross-device refresh', async (status) => {
    const user = userEvent.setup()
    const newVerificationId = '55555555-5555-4555-8555-555555555555'
    const terminalRequest = { ...request, status }
    const nextRequest = { ...request, verification_id: newVerificationId, status: 'draft' as const }
    mockedVerificationApi.developerListMyProjects.mockResolvedValue({ items: [{ project_id: project.id, current_name: '真实作品', developer: null, verification_id: request.verification_id, verification_status: status, can_manage: false }], next_cursor: null })
    mockedVerificationApi.get.mockResolvedValue(terminalRequest)
    mockedVerificationApi.create.mockResolvedValueOnce(nextRequest)
    mockedVerificationApi.patch.mockResolvedValueOnce({ ...nextRequest, version: 2 })

    renderPage()

    expect(await screen.findByRole('button', { name: '重新申请' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新申请' }))
    await user.type(await screen.findByRole('textbox', { name: '材料说明' }), '我维护并开发这个作品，材料可在公开仓库核对。')
    await user.upload(screen.getByLabelText('上传证明材料'), new File(['proof'], 'proof.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: '提交身份审核' }))

    await waitFor(() => expect(mockedVerificationApi.create).toHaveBeenCalledOnce())
    expect(mockedVerificationApi.create).toHaveBeenCalledWith(session, expect.objectContaining({
      project_id: project.id,
      supersedes_verification_id: request.verification_id,
    }))
  })
})
