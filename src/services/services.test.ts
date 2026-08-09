import {
  comparisonSessionId,
  projectId,
  submissionDraftId,
  userId,
} from '../types'
import { adminService } from './adminService'
import { comparisonService } from './comparisonService'
import { notificationService } from './notificationService'
import { projectService } from './projectService'
import { configureServiceRuntime } from './runtime'
import { searchService } from './searchService'
import { submissionService } from './submissionService'

beforeAll(() => {
  configureServiceRuntime({ defaultDelayMs: 0 })
})

describe('typed prototype services', () => {
  it('returns cloned project data without mutating fixtures', async () => {
    const first = await projectService.getById(projectId('project-quizforge'))
    expect(first.ok).toBe(true)
    if (!first.ok || first.data.currentName.state !== 'known') return
    first.data.currentName.value = '本地修改'
    const second = await projectService.getById(projectId('project-quizforge'))
    expect(second.ok).toBe(true)
    if (second.ok && second.data.currentName.state === 'known') {
      expect(second.data.currentName.value).toBe('题练工坊')
    }
  })

  it('injects traceable network and server errors', async () => {
    const network = await projectService.list({ scenario: 'network_error' })
    const server = await projectService.list({ scenario: 'service_error' })
    expect(network).toMatchObject({
      ok: false,
      error: { code: 'VC_NETWORK_UNAVAILABLE', retryable: true },
    })
    expect(server).toMatchObject({
      ok: false,
      error: { code: 'VC_SERVICE_UNAVAILABLE', retryable: true },
    })
  })

  it('supports stable search, empty, and sparse result scenarios', async () => {
    const normal = await searchService.search('PDF')
    const empty = await searchService.search('PDF', {}, { scenario: 'empty_results' })
    const sparse = await searchService.search('口语', {}, { scenario: 'sparse_results' })
    expect(normal.ok && normal.data.hits.length).toBeGreaterThanOrEqual(3)
    expect(empty).toMatchObject({ ok: true, data: { exactCount: 0 } })
    expect(sparse.ok && sparse.data.hits.length).toBeLessThanOrEqual(2)
  })

  it('searches the verified public portfolio records from the shared project dataset', async () => {
    const result = await searchService.search('Haoqi')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hits.map(({ project }) => project.id)).toContain(projectId('project-haoqi-design'))
    const project = result.data.hits.find(({ project }) => project.id === projectId('project-haoqi-design'))?.project
    expect(project?.publicUrl).toMatchObject({ state: 'known', value: 'https://haoqi.design/' })
  })

  it('provides comparison lookup and size validation', async () => {
    const found = await comparisonService.get(
      comparisonSessionId('comparison-mia-speaking'),
    )
    expect(found.ok).toBe(true)
    const tooSmall = await comparisonService.validateForComparison([
      projectId('project-speakmirror'),
    ])
    expect(tooSmall).toMatchObject({
      ok: false,
      error: { code: 'VC_COMPARISON_TOO_SMALL' },
    })
  })

  it('supports partial extraction and review outcomes', async () => {
    const extraction = await submissionService.extract('https://example.test/new', {
      scenario: 'extraction_partial',
    })
    expect(extraction).toMatchObject({
      ok: true,
      data: { failedFields: ['repositoryUrl', 'screenshotUrl'] },
    })
    const draft = await submissionService.getDraft(
      submissionDraftId('draft-mia-study-review'),
    )
    expect(draft.ok && draft.data).toBeTruthy()
    if (draft.ok && draft.data) {
      const reviewed = await submissionService.submit(draft.data, {
        scenario: 'review_changes_requested',
      })
      expect(reviewed).toMatchObject({ ok: true, data: { status: 'changes_requested' } })
    }
  })

  it('returns a recoverable URL-check result when only the public access probe times out', async () => {
    const response = await submissionService.checkUrl('example.test/slow-tool', {
      scenario: 'timeout',
    })
    expect(response).toMatchObject({
      ok: true,
      data: {
        normalizedUrl: 'https://example.test/slow-tool',
        canCreateDraft: true,
      },
    })
    expect(response.ok && response.data.checks.find(({ key }) => key === 'access')).toMatchObject({
      status: 'warning',
    })
  })

  it('returns notifications and admin queues through services', async () => {
    const notifications = await notificationService.listForUser(userId('user-mia'))
    const queue = await adminService.listProjectQueue()
    expect(notifications.ok && notifications.data.length).toBeGreaterThanOrEqual(2)
    expect(queue.ok && queue.data).toHaveLength(38)
  })
})
