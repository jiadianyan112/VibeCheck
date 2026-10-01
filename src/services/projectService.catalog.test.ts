import { afterEach, expect, it, vi } from 'vitest'
import { projectService } from './projectService'
import { projectId } from '../types'

const publishedId = '20437d7e-61a8-4e70-9d6e-f8e96cc5d45d'
const card = {
  project_id: publishedId,
  version_id: 'f2dc6ae0-0a73-4b0d-adfe-e7d91c0c8b4f',
  current_name: '数据库里的作品',
  one_line_definition: '公开目录作品',
  category_id: 'ai_learning_quiz',
  cover_media_reference_ids: [],
  access_status: 'accessible',
  review_status: 'published_platform',
  last_verified_at: '2026-09-27T00:00:00.000Z',
  creator_summaries: [],
  ai_coding_tools: { knowledge_state: 'unknown', values: [] },
  interaction_summary: { favorite_count: 0, like_count: 0, visible_comment_count: 0, follower_count: 0 },
  latest_event_summary: null,
  read_version: 1,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('reads published works from the database catalog and resolves their detail by stable id', async () => {
  vi.stubEnv('PROD', true)
  const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(
    url.includes('/api/v1/projects?')
      ? { items: [card], next_cursor: null, result_version: '1' }
      : { ...card, project_core: { current_name: card.current_name, one_line_definition: card.one_line_definition, public_url: 'https://example.test/work' }, category_data: {}, first_seen_at: card.last_verified_at, created_at: card.last_verified_at },
  )))
  vi.stubGlobal('fetch', fetchMock)

  const listed = await projectService.list()
  expect(listed.ok).toBe(true)
  if (!listed.ok) return
  expect(listed.data.map((project) => project.id)).toEqual([publishedId])
  expect(listed.data.some((project) => project.id === 'project-submission-local')).toBe(false)

  const detail = await projectService.getBundle(projectId(publishedId))
  expect(detail.ok).toBe(true)
  if (!detail.ok) return
  expect(detail.data.project.currentName).toMatchObject({ state: 'known', value: card.current_name })
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/projects/${publishedId}`), expect.any(Object))
})

it('shows catalog failures instead of displaying sample works as published content', async () => {
  vi.stubEnv('PROD', true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
  const result = await projectService.list()
  expect(result).toMatchObject({ ok: false, error: { code: 'VC_CATALOG_UNAVAILABLE' } })
})
