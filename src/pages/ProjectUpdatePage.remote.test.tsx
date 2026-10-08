import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/providers'
import { ProjectUpdatePage } from './ProjectUpdatePage'
import { projects, prototypeUsers } from '../mocks'
import { appReducer, createInitialAppState, persistAppState } from '../state'
import * as appState from '../state'
import type { AuthSessionDto } from '../services/authService'
import * as authContext from '../features/auth/AuthSessionContext'
import * as services from '../services'

vi.mock('../state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state')>()
  return { ...actual, useAppState: vi.fn() }
})

vi.mock('../features/auth/AuthSessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/auth/AuthSessionContext')>()
  return { ...actual, useAuthSession: vi.fn() }
})

vi.mock('../services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services')>()
  return {
    ...actual,
    developerApi: { listMyProjects: vi.fn() },
    projectService: { getById: vi.fn() },
    projectUpdateApi: { create: vi.fn(), get: vi.fn(), patch: vi.fn(), preview: vi.fn(), submit: vi.fn(), withdraw: vi.fn() },
  }
})

const session: AuthSessionDto = {
  authenticated: true, user_id: 'user-zhou', display_name: '周', account_status: 'active', roles: ['verified_author'],
  primary_role: 'verified_author', permissions: [], session_version: 1, csrf_token: 'csrf-token',
  recent_auth_at: '2026-10-08T00:00:00.000Z', expires_at: '2026-10-09T00:00:00.000Z',
}

const project = projects.find((item) => item.id === 'project-speakmirror')!
const baseProjection = {
  update_id: 'update-1', project_id: 'project-speakmirror', owner_user_id: 'user-zhou', origin_review_status: 'published_author' as const,
  base_version_id: 'version-1', current_version_id: 'version-1', update_type: 'version' as const, category_change_type: null,
  payload_diff: [], before_after: [], evidence_draft_ids: [], media_reference_ids: [],
  authorization_snapshot: {
    creator_account_link_id: 'link-1', creator_id: 'creator-zhou', author_relation_id: 'relation-1', permission_profile_id: 'OWNER_V1' as const,
    permission_profile_version: 1 as const, permission_profile_config_hash: 'a'.repeat(64), link_version: 1, author_relation_version: 1,
    capabilities: ['ownership.view', 'project_update.create', 'project_update.submit'] as const, field_paths: ['/project_core/status_note'],
  },
  effective_capabilities: ['ownership.view', 'project_update.create', 'project_update.submit'] as const, effective_field_paths: ['/project_core/status_note'],
  authorization_state: 'active' as const, status: 'editing' as const, review_work_item_id: null, apply_attempt_count: 0, version: 1,
  created_at: '2026-10-08T00:00:00.000Z', updated_at: '2026-10-08T00:00:00.000Z',
}

function renderRemote(type: 'version' | 'status' | 'address' | 'asset' = 'version') {
  const router = createMemoryRouter([{ path: '/project/:id/update', element: <ProjectUpdatePage /> }], { initialEntries: [`/project/project-speakmirror/update?type=${type}`] })
  return render(<AppProviders><RouterProvider router={router} /></AppProviders>)
}

describe('production ProjectUpdatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_USE_REMOTE_PROJECT_UPDATES', 'true')
    ;(globalThis as Record<string, unknown>).__VIBECHECK_REMOTE_PROJECT_UPDATES__ = true
    localStorage.clear()
    sessionStorage.clear()
    const state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[1]! })
    persistAppState(state)
    vi.mocked(appState.useAppState).mockReturnValue({ state, dispatch: vi.fn() })
    vi.mocked(authContext.useAuthSession).mockReturnValue({ status: 'authenticated', session, acceptSession: vi.fn(), signOut: vi.fn(), refresh: vi.fn() })
    vi.mocked(services.projectService.getById).mockResolvedValue({ ok: true, data: project })
    vi.mocked(services.developerApi.listMyProjects).mockResolvedValue({ items: [{ project_id: 'project-speakmirror', current_name: '口语回声', developer: { kind: 'individual', display_name: '周', avatar_url: null, website_url: null, creator_id: 'creator-zhou', verification_status: 'verified' }, verification_id: 'verification-1', verification_status: 'verified', can_manage: true }], next_cursor: null })
    vi.mocked(services.projectUpdateApi.get).mockResolvedValue(baseProjection)
    vi.mocked(services.projectUpdateApi.create).mockResolvedValue(baseProjection)
    vi.mocked(services.projectUpdateApi.patch).mockResolvedValue({ ...baseProjection, version: 2, payload_diff: [{ field_path: '/project_core/status_note', after_value: 'v1.2 版本说明' }] })
    vi.mocked(services.projectUpdateApi.preview).mockResolvedValue({ update_id: 'update-1', version: 2, preview_hash: 'b'.repeat(64), base_version_id: 'version-1', current_version_id: 'version-1', before_after: [], authorization_snapshot: baseProjection.authorization_snapshot, validation: { ready_for_submit: true, changed_field_count: 1, evidence_draft_count: 0, media_reference_count: 0 } })
    vi.mocked(services.projectUpdateApi.submit).mockResolvedValue({ update_id: 'update-1', status: 'update_pending', version: 3, review_work_item_id: 'work-1', work_item_status: 'queued', submitted_at: '2026-10-08T00:00:00.000Z' })
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__VIBECHECK_REMOTE_PROJECT_UPDATES__
    vi.unstubAllEnvs()
  })

  it('submits a version note draft and leaves public state unchanged while pending', async () => {
    const user = userEvent.setup()
    renderRemote()
    expect(await screen.findByRole('heading', { name: '更新 口语回声' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '版本说明' }), 'v1.2 版本说明')
    await user.type(screen.getByRole('textbox', { name: '来源说明' }), '开发者公开发布说明。')
    await user.type(screen.getByRole('textbox', { name: '影响范围' }), '详情访问入口。')
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交审核' }))

    expect(await screen.findByText('更新已提交审核')).toBeInTheDocument()
    expect(screen.queryByText('更新已发布')).not.toBeInTheDocument()
    expect(services.projectUpdateApi.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-speakmirror', updateType: 'version', baseVersionId: expect.any(String) }))
    expect(services.projectUpdateApi.patch).toHaveBeenCalledWith(expect.objectContaining({ evidenceDraftIds: [], mediaReferenceIds: [], diff: [{ field_path: '/project_core/status_note', after_value: 'v1.2 版本说明' }] }))
    expect(services.projectUpdateApi.preview).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 }))
    expect(services.projectUpdateApi.submit).toHaveBeenCalledWith(expect.objectContaining({ version: 2, previewHash: 'b'.repeat(64) }))
  })

  it('restores the editable value from a saved payload diff', async () => {
    sessionStorage.setItem('vibecheck:project-update:user-zhou:project-speakmirror:version', 'update-1')
    vi.mocked(services.projectUpdateApi.get).mockResolvedValue({
      ...baseProjection,
      payload_diff: [{ field_path: '/project_core/status_note', after_value: '恢复的版本说明' }],
    })

    renderRemote()

    expect(await screen.findByRole('textbox', { name: '版本说明' })).toHaveValue('恢复的版本说明')
    expect(services.projectUpdateApi.create).not.toHaveBeenCalled()
  })

  it('clears terminal storage, shows the last result, and creates a new draft explicitly', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('vibecheck:project-update:user-zhou:project-speakmirror:version', 'update-1')
    vi.mocked(services.projectUpdateApi.get).mockResolvedValue({ ...baseProjection, status: 'applied' })
    vi.mocked(services.projectUpdateApi.create).mockResolvedValue({ ...baseProjection, update_id: 'update-2' })

    renderRemote()

    expect(await screen.findByText('上次更新已应用')).toBeInTheDocument()
    expect(sessionStorage.getItem('vibecheck:project-update:user-zhou:project-speakmirror:version')).toBeNull()
    expect(screen.queryByRole('textbox', { name: '版本说明' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始新的更新' }))
    expect(services.projectUpdateApi.create).toHaveBeenCalledWith(expect.objectContaining({ updateType: 'version', projectId: 'project-speakmirror' }))
    expect(await screen.findByRole('textbox', { name: '版本说明' })).toBeInTheDocument()
    expect(sessionStorage.getItem('vibecheck:project-update:user-zhou:project-speakmirror:version')).toBe('update-2')
  })

  it.each(['address', 'asset'] as const)('does not create an unsupported %s draft', async (type) => {
    renderRemote(type)

    expect(await screen.findByText(type === 'address' ? '公开地址更新暂不可用' : '复用资产更新暂不可用')).toBeInTheDocument()
    expect(services.projectUpdateApi.create).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '返回作品详情' })).toHaveAttribute('href', '/project/project-speakmirror')
  })
})
