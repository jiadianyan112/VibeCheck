import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MyProjects } from './MyProjects'
import { developerApi } from '../../services/developerApi'

vi.mock('../../services/developerApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/developerApi')>()
  return { ...actual, developerApi: { listMyProjects: vi.fn() } }
})

describe('MyProjects', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('loads every server page and only exposes update for server-authorized projects', async () => {
    vi.mocked(developerApi.listMyProjects)
      .mockResolvedValueOnce({ items: [{ project_id: 'project-1', current_name: '未认证作品', developer: { kind: 'individual', display_name: '林舟', avatar_url: null, website_url: null, creator_id: null, verification_status: 'unverified' }, verification_id: 'verification-1', verification_status: 'pending', can_manage: false }], next_cursor: 'next' })
      .mockResolvedValueOnce({ items: [{ project_id: 'project-2', current_name: '已认证作品', developer: { kind: 'team', display_name: '微光工作室', avatar_url: null, website_url: null, creator_id: 'creator-2', verification_status: 'verified' }, verification_id: 'verification-2', verification_status: 'verified', can_manage: true }], next_cursor: null })

    render(<MemoryRouter><MyProjects userId="user-1" fallback={<p>fallback</p>} /></MemoryRouter>)

    expect(await screen.findByText('未认证作品')).toBeInTheDocument()
    expect(screen.getByText('开发团队 · 微光工作室')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '更新作品' })).toHaveAttribute('href', '/project/project-2/update')
    expect(screen.getByRole('link', { name: '查看认证进度' })).toHaveAttribute('href', '/project/project-1/verify-author?verification_id=verification-1')
    expect(developerApi.listMyProjects).toHaveBeenCalledTimes(2)
    expect(developerApi.listMyProjects).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'next', limit: 50 }))
  })
})
