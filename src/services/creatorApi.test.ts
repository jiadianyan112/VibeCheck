import { afterEach, describe, expect, it, vi } from 'vitest'
import { creatorApi } from './creatorApi'

describe('creatorApi', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads the public creator projection with credentials and maps the stable fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      creator_id: 'creator-1', display_name: '微光工作室', kind: 'team', avatar_url: null,
      website_url: 'https://example.com/', verification_status: 'verified', bio: '做小型工具。',
      contacts: [{ label: '官网', url: 'https://example.com/' }], published_project_ids: ['project-1'], read_version: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(creatorApi.get('creator-1')).resolves.toMatchObject({ display_name: '微光工作室', kind: 'team', published_project_ids: ['project-1'] })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/creators/creator-1', expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })
})
