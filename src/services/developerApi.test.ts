import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeveloperApiError, developerApi, type MyProjectPage } from './developerApi'

describe('developerApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists one explicit cursor page with the session cookie and abort signal', async () => {
    const signal = new AbortController().signal
    const page: MyProjectPage = {
      items: [{
        project_id: 'project-1',
        current_name: '作品一',
        developer: { kind: 'individual', display_name: '开发者', avatar_url: null, website_url: null, creator_id: null, verification_status: 'unverified' },
        verification_id: 'verification-1',
        verification_status: 'pending',
        can_manage: false,
      }],
      next_cursor: 'cursor-2',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }))

    await expect(developerApi.listMyProjects({ limit: 1, cursor: 'cursor-1', projectId: 'project-1', signal })).resolves.toEqual(page)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/me/projects?limit=1&cursor=cursor-1&project_id=project-1', expect.objectContaining({
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: expect.objectContaining({ accept: 'application/json' }),
    }))
  })

  it('preserves HTTP status and server error code for permission handling', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 }))

    await expect(developerApi.listMyProjects()).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
    } satisfies Partial<DeveloperApiError>)
  })
})
