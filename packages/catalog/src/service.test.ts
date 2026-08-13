import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CatalogError } from './errors.js'
import { CatalogService } from './service.js'
import type {
  CatalogStore,
  ListStoredAssetsInput,
  ListStoredEventsInput,
  ListStoredProjectsInput,
  StoredAsset,
  StoredCreator,
  StoredEvent,
  StoredProject,
} from './store.js'

const projectIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const

function learningSnapshot(name: string) {
  return {
    project_core: {
      current_name: name,
      public_url: `https://${name.toLowerCase()}.example.com`,
      repository_url: null,
      original_platform: null,
      cover_media_reference_ids: ['cover-reference-1'],
      one_line_definition: `${name} 的学习练习工具`,
      ai_coding_tools: {
        knowledge_state: 'unknown',
        values: [],
        source_type: 'system_inference',
        observed_at: '2026-08-10T00:00:00.000Z',
      },
      tech_stack: [],
      deployment_platform: null,
      access_status: 'normal',
      maintenance_signal: 'unknown',
      status_note: null,
    },
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    category_data: {
      target_users: ['university_students'],
      core_problem: '把学习材料转换为可练习内容',
      use_scenarios: ['daily_practice'],
      main_inputs: ['pdf'],
      main_outputs: ['questions'],
      core_flow: [{ order: 1, name: '上传材料' }],
      content_processing: [],
      practice_formats: [],
      feedback_methods: [],
      learning_records: [],
      differentiation: null,
      core_features: [],
      secondary_features: [],
      login_requirement: 'unknown',
      sharing_capability: 'unknown',
    },
  }
}

function storedProject(index: number, name = `Project${index + 1}`): StoredProject {
  const date = new Date(Date.UTC(2026, 7, 10, 0, 0, 3 - index))
  return {
    project_id: projectIds[index]!,
    current_version_id: `${index + 4}${String(index + 4).repeat(7)}-${String(index + 4).repeat(4)}-4${String(index + 4).repeat(3)}-8${String(index + 4).repeat(3)}-${String(index + 4).repeat(12)}`,
    current_name: name,
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    review_status: 'published_platform',
    access_status: 'normal',
    http_check_status: 'normal',
    author_link_status: 'unlinked',
    completeness_level: 'complete',
    freshness_status: 'valid',
    record_source: 'platform_editor',
    first_seen_at: date,
    last_verified_at: date,
    aggregate_version: '1',
    created_at: date,
    updated_at: date,
    snapshot_json: learningSnapshot(name),
    favorite_count: '0',
    like_count: '0',
    follower_count: '0',
    visible_comment_count: '0',
    creator_summaries: [],
    latest_event_summary: null,
  }
}

function storedEvent(index: number): StoredEvent {
  return {
    event_id: `${index + 7}${String(index + 7).repeat(7)}-${String(index + 7).repeat(4)}-4${String(index + 7).repeat(3)}-8${String(index + 7).repeat(3)}-${String(index + 7).repeat(12)}`,
    project_id: projectIds[0],
    version_id: storedProject(0).current_version_id,
    event_type: index === 0 ? 'version_updated' : 'first_published',
    category_change_type: null,
    event_time: index === 0 ? '2026-08' : '2026-07-20',
    time_precision: index === 0 ? 'month' : 'day',
    event_sort_at: new Date(index === 0 ? '2026-08-01T00:00:00.000Z' : '2026-07-20T00:00:00.000Z'),
    event_sort_rule_version: 'event_sort.v1',
    event_summary: index === 0 ? '更新练习流程' : '首次发布',
    source_actor: 'verified_author',
    lifecycle_status: 'published',
    supersedes_event_id: null,
    evidence_summaries: [],
    evidence_dispute_summary: 'none',
    project_summary: {
      project_id: projectIds[0],
      current_name: 'Project1',
      category_id: 'ai_learning_quiz',
      access_status: 'normal',
    },
  }
}

function storedAsset(index: number): StoredAsset {
  const digit = String((index % 8) + 1)
  return {
    asset_id: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    project_id: projectIds[0],
    asset_type: 'source_code',
    component_role: null,
    name: `Source ${index + 1}`,
    description: '公开源码仓库',
    availability_status: 'available',
    license_type: 'MIT',
    price_type: 'free',
    acquisition_method: 'fork',
    has_safe_web_url: true,
    has_contact_uri: false,
    evidence_summaries: [],
    last_verified_at: new Date('2026-08-10T00:00:00.000Z'),
    version: '1',
    updated_at: new Date(Date.UTC(2026, 7, 10, 0, 0, 2 - index)),
  }
}

class MemoryCatalogStore implements CatalogStore {
  readonly calls: ListStoredProjectsInput[] = []
  readonly eventCalls: ListStoredEventsInput[] = []
  readonly assetCalls: ListStoredAssetsInput[] = []
  constructor(
    private readonly projects: StoredProject[],
    private readonly creator: StoredCreator | null = null,
    private readonly events: StoredEvent[] = [],
    private readonly assets: StoredAsset[] = [],
  ) {}

  async listPublicProjects(input: ListStoredProjectsInput): Promise<readonly StoredProject[]> {
    this.calls.push(input)
    const afterIndex = input.afterProjectId === null
      ? 0
      : this.projects.findIndex(({ project_id }) => project_id === input.afterProjectId) + 1
    return this.projects.slice(afterIndex, afterIndex + input.limit)
  }

  async getProject(projectId: string): Promise<StoredProject | null> {
    return this.projects.find(({ project_id }) => project_id === projectId) ?? null
  }

  async getCreator(): Promise<StoredCreator | null> {
    return this.creator
  }

  async listProjectEvents(input: ListStoredEventsInput): Promise<readonly StoredEvent[]> {
    this.eventCalls.push(input)
    const afterIndex = input.afterEventId === null
      ? 0
      : this.events.findIndex(({ event_id }) => event_id === input.afterEventId) + 1
    return this.events.slice(afterIndex, afterIndex + input.limit)
  }

  async listProjectAssets(input: ListStoredAssetsInput): Promise<readonly StoredAsset[]> {
    this.assetCalls.push(input)
    const afterIndex = input.afterAssetId === null
      ? 0
      : this.assets.findIndex(({ asset_id }) => asset_id === input.afterAssetId) + 1
    return this.assets.slice(afterIndex, afterIndex + input.limit)
  }
}

describe('CatalogService public projections', () => {
  it('creates a signed stable cursor and resumes the same category query', async () => {
    const store = new MemoryCatalogStore([storedProject(0), storedProject(1), storedProject(2)])
    const service = new CatalogService({
      store,
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
      now: () => new Date('2026-08-10T00:01:00.000Z'),
    })

    const first = await service.listProjects({ categoryId: 'ai_learning_quiz', limit: 2, cursor: null })
    assert.equal(first.items.length, 2)
    assert.ok(first.next_cursor)
    assert.equal(first.items[0]!.category_id, 'ai_learning_quiz')

    const second = await service.listProjects({
      categoryId: 'ai_learning_quiz',
      limit: 2,
      cursor: first.next_cursor,
    })
    assert.deepEqual(second.items.map(({ project_id }) => project_id), [projectIds[2]])
    assert.equal(store.calls[1]!.snapshotAt.toISOString(), '2026-08-10T00:01:00.000Z')
  })

  it('rejects cursor tampering and cross-category cursor reuse', async () => {
    const service = new CatalogService({
      store: new MemoryCatalogStore([storedProject(0), storedProject(1)]),
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
    })
    const first = await service.listProjects({ categoryId: null, limit: 1, cursor: null })
    await assert.rejects(
      service.listProjects({ categoryId: null, limit: 1, cursor: `${first.next_cursor}x` }),
      (error: unknown) => error instanceof CatalogError && error.code === 'CURSOR_INVALID',
    )
    await assert.rejects(
      service.listProjects({ categoryId: null, limit: 1, cursor: `${first.next_cursor}.ignored` }),
      (error: unknown) => error instanceof CatalogError && error.code === 'CURSOR_INVALID',
    )
    await assert.rejects(
      service.listProjects({ categoryId: 'ai_learning_quiz', limit: 1, cursor: first.next_cursor }),
      (error: unknown) => error instanceof CatalogError && error.code === 'CURSOR_QUERY_MISMATCH',
    )
  })

  it('returns public details and does not expose restricted or deleted records', async () => {
    const published = storedProject(0)
    const restricted = { ...storedProject(1), review_status: 'restricted' as const }
    const deleted = { ...storedProject(2), review_status: 'deleted' as const }
    const service = new CatalogService({
      store: new MemoryCatalogStore([published, restricted, deleted]),
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
    })
    const detail = await service.getProject(published.project_id)
    assert.equal(detail.viewer_schema, 'public')
    assert.equal(detail.category_data.core_problem, '把学习材料转换为可练习内容')
    await assert.rejects(
      service.getProject(restricted.project_id),
      (error: unknown) => error instanceof CatalogError && error.code === 'PROJECT_NOT_PUBLIC',
    )
    await assert.rejects(
      service.getProject(deleted.project_id),
      (error: unknown) => error instanceof CatalogError && error.code === 'PROJECT_DELETED',
    )
  })

  it('returns canonical event and asset projections without exposing asset targets', async () => {
    const store = new MemoryCatalogStore(
      [storedProject(0)],
      null,
      [storedEvent(0), storedEvent(1)],
      [storedAsset(0), storedAsset(1)],
    )
    const service = new CatalogService({
      store,
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
    })
    const events = await service.listProjectEvents({
      projectId: projectIds[0],
      eventTypes: ['version_updated'],
      includeSuperseded: false,
      cursor: null,
    })
    assert.equal(events.items[0]!.event_time, '2026-08')
    assert.equal(events.items[0]!.event_sort_rule_version, 'event_sort.v1')
    assert.deepEqual(store.eventCalls[0]!.eventTypes, ['version_updated'])

    const assets = await service.listProjectAssets({ projectId: projectIds[0], cursor: null })
    assert.equal(assets.items[0]!.target_kind, 'safe_web_url')
    assert.equal(assets.items[0]!.target_status, 'requires_resolve')
    assert.equal('safe_web_url' in assets.items[0]!, false)
  })

  it('rejects event filter duplication and cross-project subresource cursors', async () => {
    const store = new MemoryCatalogStore(
      [storedProject(0), storedProject(1)],
      null,
      Array.from({ length: 31 }, (_, index) => ({
        ...storedEvent(index % 2),
        event_id: `${String((index % 8) + 1).repeat(8)}-${String((index % 8) + 1).repeat(4)}-4${String((index % 8) + 1).repeat(3)}-8${String((index % 8) + 1).repeat(3)}-${index.toString().padStart(12, '0')}`,
      })),
      Array.from({ length: 31 }, (_, index) => ({
        ...storedAsset(index % 2),
        asset_id: `${String((index % 8) + 1).repeat(8)}-${String((index % 8) + 1).repeat(4)}-4${String((index % 8) + 1).repeat(3)}-8${String((index % 8) + 1).repeat(3)}-${index.toString().padStart(12, '0')}`,
      })),
    )
    const service = new CatalogService({
      store,
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
    })
    await assert.rejects(
      service.listProjectEvents({
        projectId: projectIds[0],
        eventTypes: ['version_updated', 'version_updated'],
        includeSuperseded: false,
        cursor: null,
      }),
      (error: unknown) => error instanceof CatalogError && error.code === 'EVENT_TYPES_INVALID',
    )
    const assetPage = await service.listProjectAssets({ projectId: projectIds[0], cursor: null })
    assert.ok(assetPage.next_cursor)
    await assert.rejects(
      service.listProjectAssets({ projectId: projectIds[1], cursor: assetPage.next_cursor }),
      (error: unknown) => error instanceof CatalogError && error.code === 'CURSOR_QUERY_MISMATCH',
    )
  })

  it('rejects invalid partial dates and frozen asset enum drift from the store', async () => {
    const invalidEventService = new CatalogService({
      store: new MemoryCatalogStore(
        [storedProject(0)],
        null,
        [{ ...storedEvent(0), event_time: '2026-13', category_change_type: 'unknown_change' }],
      ),
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
    })
    await assert.rejects(
      invalidEventService.listProjectEvents({
        projectId: projectIds[0], eventTypes: [], includeSuperseded: false, cursor: null,
      }),
      (error: unknown) => error instanceof CatalogError && error.code === 'CATALOG_EVENT_PROJECTION_INVALID',
    )

    const invalidAssetService = new CatalogService({
      store: new MemoryCatalogStore(
        [storedProject(0)],
        null,
        [],
        [{ ...storedAsset(0), acquisition_method: 'unsafe_redirect' }],
      ),
      cursorSecret: 'catalog-test-secret-at-least-thirty-two-characters',
    })
    await assert.rejects(
      invalidAssetService.listProjectAssets({ projectId: projectIds[0], cursor: null }),
      (error: unknown) => error instanceof CatalogError && error.code === 'CATALOG_ASSET_PROJECTION_INVALID',
    )
  })
})
