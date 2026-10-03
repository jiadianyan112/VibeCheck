import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InteractionApiError,
  interactionApi,
  type InteractionSnapshot,
} from './interactionApi'
import type { AuthSessionDto } from './authService'

const session = { csrf_token: 'csrf-test' } as AuthSessionDto

function snapshot(projectId: string, like = false): InteractionSnapshot {
  return {
    project_id: projectId,
    states: { favorite: false, like, follow: false },
    counts: { favorite_count: 2, like_count: like ? 1 : 0, follower_count: 1 },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('interactionApi', () => {
  it.each(['favorite', 'follow'] as const)('saves final %s state with CSRF', async type => {
    const item = { ...snapshot('project-1'), states: { like: false, favorite: true, follow: type === 'follow' } }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(item))
    vi.stubGlobal('fetch', fetchMock)
    await expect(interactionApi.setState(type, 'project-1', true, session)).resolves.toEqual(item)
    expect(fetchMock.mock.calls[0]![0]).toContain(`/interactions/${type}/project/project-1`)
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('x-csrf-token')).toBe('csrf-test')
  })

  it('reads paginated favorites without importing local IDs', async () => {
    const item = { ...snapshot('project-1'), states: { like: false, favorite: true, follow: false } }
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [item], next_cursor: 'signed-next' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(interactionApi.favorites('signed-first')).resolves.toEqual({ items: [item], next_cursor: 'signed-next' })
    expect(fetchMock.mock.calls[0]![0]).toContain('cursor=signed-first')
    fetchMock.mockResolvedValue(Response.json({ items: [snapshot('project-1')], next_cursor: null }))
    await expect(interactionApi.favorites()).rejects.toBeInstanceOf(InteractionApiError)
  })
  it('returns no items without requesting when the project list is empty', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(interactionApi.list([])).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads project interactions in batches of 100 and merges the returned items', async () => {
    const projectIds = Array.from({ length: 205 }, (_, index) => `project-${index}`)
    const signal = new AbortController().signal
    const pages = [
      { items: [snapshot('project-1')] },
      { items: [snapshot('project-101', true)] },
      { items: [snapshot('project-200')] },
    ]
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(Response.json(pages[calls.length - 1]))
    }))

    await expect(interactionApi.list(projectIds, signal)).resolves.toEqual([
      snapshot('project-1'),
      snapshot('project-101', true),
      snapshot('project-200'),
    ])
    expect(calls).toHaveLength(3)
    expect(new URL(calls[0]!.url, 'https://example.test').searchParams.get('project_ids')).toBe(projectIds.slice(0, 100).join(','))
    expect(new URL(calls[1]!.url, 'https://example.test').searchParams.get('project_ids')).toBe(projectIds.slice(100, 200).join(','))
    expect(new URL(calls[2]!.url, 'https://example.test').searchParams.get('project_ids')).toBe(projectIds.slice(200).join(','))
    expect(calls.every(({ init }) => init?.method === 'GET' && init.credentials === 'include' && init.cache === 'no-store' && init.signal === signal)).toBe(true)
  })

  it('sets the final like state with CSRF and returns only the validated snapshot', async () => {
    const projectId = 'project-42'
    const requestId = 'client-request-42'
    const finalSnapshot = snapshot(projectId, false)
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ...finalSnapshot,
      result: 'changed',
      count_deltas: { favorite_count: 0, like_count: -1, follower_count: 0 },
      change_sources: { favorite: null, like: 'explicit', follow: null },
      updated_at: '2026-10-02T00:00:00.000Z',
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => requestId) })

    await expect(interactionApi.setLike(projectId, false, session)).resolves.toEqual(finalSnapshot)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`/api/v1/interactions/like/project/${projectId}`)
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('include')
    expect(init.cache).toBe('no-store')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(session.csrf_token)
    expect(JSON.parse(String(init.body))).toEqual({ state: false, client_request_id: requestId })
  })

  it('propagates server error codes and statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
      { error: { code: 'INTERACTION_FORBIDDEN' } },
      { status: 403 },
    )))

    await expect(interactionApi.list(['project-1'])).rejects.toMatchObject({
      code: 'INTERACTION_FORBIDDEN',
      status: 403,
    })
  })

  it.each([
    ['an unrequested project', [snapshot('other-project')]],
    ['a duplicate project', [snapshot('project-1'), snapshot('project-1')]],
  ])('rejects %s returned by a list batch', async (_label, items) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items })))

    await expect(interactionApi.list(['project-1', 'project-2'])).rejects.toMatchObject({
      code: 'INTERACTION_INVALID_RESPONSE',
      status: 200,
    })
  })

  it('rejects a mutation snapshot for a different project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(snapshot('other-project'))))

    await expect(interactionApi.setLike('project-1', true, session)).rejects.toMatchObject({
      code: 'INTERACTION_INVALID_RESPONSE',
      status: 200,
    })
  })

  it.each([
    ['state', { ...snapshot('project-1'), states: { favorite: false, like: 'yes', follow: false } }],
    ['count', { ...snapshot('project-1'), counts: { favorite_count: -1, like_count: 0, follower_count: 0 } }],
  ])('rejects an invalid response %s shape', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: [body] })))

    await expect(interactionApi.list(['project-1'])).rejects.toBeInstanceOf(InteractionApiError)
  })
})
