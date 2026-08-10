import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { catalogError } from './errors.js'
import type { CatalogStore, StoredProject } from './store.js'
import type {
  CategoryId,
  CreatorProjection,
  CreatorSummary,
  InteractionSummary,
  LatestEventSummary,
  ListProjectsInput,
  ProjectCardProjection,
  ProjectListProjection,
  ProjectProjection,
} from './types.js'
import { categoryIds } from './types.js'
import { parseProjectSnapshot } from './validation.js'

interface CursorPayload {
  readonly v: 1
  readonly category_id: CategoryId | null
  readonly snapshot_at: string
  readonly after_updated_at: string
  readonly after_project_id: string
}

export interface CatalogServiceDependencies {
  readonly store: CatalogStore
  readonly cursorSecret: string
  readonly now?: () => Date
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function requireUuid(value: string): string {
  if (!isUuid(value)) throw catalogError('PROJECT_ID_INVALID', 400)
  return value.toLowerCase()
}

function encodePart(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function parseCount(value: string): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw catalogError('CATALOG_COUNTER_INVALID', 500)
  return count
}

function creatorSummaries(value: unknown): readonly CreatorSummary[] {
  if (!Array.isArray(value)) throw catalogError('CATALOG_CREATOR_PROJECTION_INVALID', 500)
  return Object.freeze(value.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw catalogError('CATALOG_CREATOR_PROJECTION_INVALID', 500)
    }
    const record = entry as Record<string, unknown>
    if (typeof record.creator_id !== 'string' || !isUuid(record.creator_id)) {
      throw catalogError('CATALOG_CREATOR_PROJECTION_INVALID', 500)
    }
    if (typeof record.display_name !== 'string' || record.display_name.trim().length < 1 || record.display_name.length > 80) {
      throw catalogError('CATALOG_CREATOR_PROJECTION_INVALID', 500)
    }
    if (record.avatar_url !== null && typeof record.avatar_url !== 'string') {
      throw catalogError('CATALOG_CREATOR_PROJECTION_INVALID', 500)
    }
    if (!['unverified', 'verified', 'disputed'].includes(String(record.verification_status))) {
      throw catalogError('CATALOG_CREATOR_PROJECTION_INVALID', 500)
    }
    return Object.freeze({
      creator_id: record.creator_id,
      display_name: record.display_name.trim(),
      avatar_url: record.avatar_url as string | null,
      verification_status: record.verification_status as CreatorSummary['verification_status'],
    })
  }))
}

function latestEvent(value: unknown): LatestEventSummary | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw catalogError('CATALOG_EVENT_PROJECTION_INVALID', 500)
  const record = value as Record<string, unknown>
  if (
    typeof record.event_id !== 'string' || !isUuid(record.event_id) ||
    typeof record.event_type !== 'string' ||
    typeof record.event_time !== 'string' || Number.isNaN(Date.parse(record.event_time)) ||
    !['exact', 'day', 'month', 'year', 'estimated'].includes(String(record.time_precision)) ||
    typeof record.event_summary !== 'string'
  ) {
    throw catalogError('CATALOG_EVENT_PROJECTION_INVALID', 500)
  }
  return Object.freeze({
    event_id: record.event_id,
    event_type: record.event_type,
    event_time: record.event_time,
    time_precision: record.time_precision as LatestEventSummary['time_precision'],
    event_summary: record.event_summary,
  })
}

function profileObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw catalogError('CREATOR_PROFILE_INVALID', 500)
  return value as Record<string, unknown>
}

export class CatalogService {
  private readonly store: CatalogStore
  private readonly cursorSecret: string
  private readonly now: () => Date

  constructor(dependencies: CatalogServiceDependencies) {
    if (dependencies.cursorSecret.length < 32) throw new Error('CATALOG_CURSOR_SECRET_INVALID')
    this.store = dependencies.store
    this.cursorSecret = dependencies.cursorSecret
    this.now = dependencies.now ?? (() => new Date())
  }

  async listProjects(input: ListProjectsInput): Promise<ProjectListProjection> {
    if (input.limit < 1 || input.limit > 50 || !Number.isInteger(input.limit)) {
      throw catalogError('LIMIT_INVALID', 400)
    }
    if (input.categoryId !== null && !categoryIds.includes(input.categoryId)) {
      throw catalogError('CATEGORY_ID_INVALID', 400)
    }
    const cursor = input.cursor === null ? null : this.decodeCursor(input.cursor)
    if (cursor !== null && cursor.category_id !== input.categoryId) throw catalogError('CURSOR_QUERY_MISMATCH', 400)
    const snapshotAt = cursor === null ? this.now() : new Date(cursor.snapshot_at)
    const stored = await this.store.listPublicProjects({
      categoryId: input.categoryId,
      snapshotAt,
      afterUpdatedAt: cursor === null ? null : new Date(cursor.after_updated_at),
      afterProjectId: cursor?.after_project_id ?? null,
      limit: input.limit + 1,
    })
    const hasMore = stored.length > input.limit
    const page = stored.slice(0, input.limit)
    const items = Object.freeze(page.map((project) => this.card(project)))
    const last = page.at(-1)
    const nextCursor = hasMore && last
      ? this.encodeCursor({
          v: 1,
          category_id: input.categoryId,
          snapshot_at: snapshotAt.toISOString(),
          after_updated_at: last.updated_at.toISOString(),
          after_project_id: last.project_id,
        })
      : null
    const resultVersion = createHash('sha256')
      .update(JSON.stringify({
        category_id: input.categoryId,
        snapshot_at: snapshotAt.toISOString(),
        items: items.map(({ project_id, version_id, read_version }) => [project_id, version_id, read_version]),
      }))
      .digest('hex')
    return Object.freeze({ items, next_cursor: nextCursor, result_version: resultVersion })
  }

  async getProject(projectId: string): Promise<ProjectProjection> {
    const stored = await this.store.getProject(requireUuid(projectId))
    if (stored === null) throw catalogError('PROJECT_NOT_FOUND', 404)
    if (stored.review_status === 'deleted') throw catalogError('PROJECT_DELETED', 410)
    if (stored.review_status === 'restricted' || stored.review_status === 'archived') {
      throw catalogError('PROJECT_NOT_PUBLIC', 403)
    }
    const snapshot = parseProjectSnapshot(stored.snapshot_json, stored.category_id, stored.category_schema_version)
    const card = this.card(stored, snapshot)
    return Object.freeze({
      ...card,
      viewer_schema: 'public',
      visibility: 'public',
      project_core: snapshot.project_core,
      category_data: snapshot.category_data,
      first_seen_at: stored.first_seen_at.toISOString(),
      created_at: stored.created_at.toISOString(),
      author_link_status: stored.author_link_status,
      completeness_level: stored.completeness_level,
      freshness_status: stored.freshness_status,
      record_source: stored.record_source,
    })
  }

  async getCreator(creatorId: string): Promise<CreatorProjection> {
    if (!isUuid(creatorId)) throw catalogError('CREATOR_ID_INVALID', 400)
    const stored = await this.store.getCreator(creatorId.toLowerCase())
    if (stored === null) throw catalogError('CREATOR_NOT_FOUND', 404)
    if (stored.merge_status === 'merged') throw catalogError('CREATOR_MERGED', 409)
    if (stored.merge_status === 'disputed') throw catalogError('CREATOR_NOT_PUBLIC', 403)
    const profile = profileObject(stored.profile_snapshot_json)
    if (
      typeof profile.display_name !== 'string' || profile.display_name.trim().length < 1 ||
      (profile.avatar_url !== null && typeof profile.avatar_url !== 'string') ||
      typeof profile.bio !== 'string' || !Array.isArray(profile.contacts) ||
      !['unverified', 'verified', 'disputed'].includes(String(profile.verification_status))
    ) {
      throw catalogError('CREATOR_PROFILE_INVALID', 500)
    }
    const contacts = profile.contacts.map((contact) => {
      if (contact === null || typeof contact !== 'object' || Array.isArray(contact)) throw catalogError('CREATOR_PROFILE_INVALID', 500)
      const values = contact as Record<string, unknown>
      if (Object.values(values).some((value) => typeof value !== 'string')) throw catalogError('CREATOR_PROFILE_INVALID', 500)
      return Object.freeze(values as Record<string, string>)
    })
    return Object.freeze({
      creator_id: stored.creator_id,
      display_name: profile.display_name.trim(),
      avatar_url: profile.avatar_url as string | null,
      verification_status: profile.verification_status as CreatorProjection['verification_status'],
      viewer_schema: 'public',
      bio: profile.bio,
      contacts: Object.freeze(contacts),
      published_project_ids: Object.freeze(stored.published_project_ids),
      read_version: Number(stored.aggregate_version),
    })
  }

  private card(stored: StoredProject, parsed = parseProjectSnapshot(
    stored.snapshot_json,
    stored.category_id,
    stored.category_schema_version,
  )): ProjectCardProjection {
    if (stored.current_name !== parsed.project_core.current_name) throw catalogError('CATALOG_POINTER_MISMATCH', 500)
    const interactionSummary: InteractionSummary = Object.freeze({
      favorite_count: parseCount(stored.favorite_count),
      like_count: parseCount(stored.like_count),
      follower_count: parseCount(stored.follower_count),
      visible_comment_count: parseCount(stored.visible_comment_count),
    })
    return Object.freeze({
      project_id: stored.project_id,
      version_id: stored.current_version_id,
      current_name: stored.current_name,
      category_id: stored.category_id,
      category_schema_version: stored.category_schema_version,
      one_line_definition: parsed.project_core.one_line_definition,
      cover_media_reference_ids: parsed.project_core.cover_media_reference_ids,
      access_status: stored.access_status,
      review_status: stored.review_status as 'published_platform' | 'published_author',
      last_verified_at: stored.last_verified_at.toISOString(),
      creator_summaries: creatorSummaries(stored.creator_summaries),
      ai_coding_tools: parsed.project_core.ai_coding_tools,
      interaction_summary: interactionSummary,
      latest_event_summary: latestEvent(stored.latest_event_summary),
      read_version: Number(stored.aggregate_version),
    })
  }

  private encodeCursor(payload: CursorPayload): string {
    const body = encodePart(JSON.stringify(payload))
    const signature = encodePart(createHmac('sha256', this.cursorSecret).update(body).digest())
    return `${body}.${signature}`
  }

  private decodeCursor(value: string): CursorPayload {
    const parts = value.split('.')
    if (value.length > 1_024 || parts.length !== 2) throw catalogError('CURSOR_INVALID', 400)
    const [body = '', signature = ''] = parts
    const expected = createHmac('sha256', this.cursorSecret).update(body).digest()
    let supplied: Buffer
    try {
      supplied = Buffer.from(signature, 'base64url')
    } catch {
      throw catalogError('CURSOR_INVALID', 400)
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw catalogError('CURSOR_INVALID', 400)
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      throw catalogError('CURSOR_INVALID', 400)
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw catalogError('CURSOR_INVALID', 400)
    const cursor = payload as Partial<CursorPayload>
    if (
      cursor.v !== 1 ||
      (cursor.category_id !== null && !categoryIds.includes(cursor.category_id as CategoryId)) ||
      typeof cursor.snapshot_at !== 'string' || Number.isNaN(Date.parse(cursor.snapshot_at)) ||
      typeof cursor.after_updated_at !== 'string' || Number.isNaN(Date.parse(cursor.after_updated_at)) ||
      typeof cursor.after_project_id !== 'string' || !isUuid(cursor.after_project_id)
    ) {
      throw catalogError('CURSOR_INVALID', 400)
    }
    return cursor as CursorPayload
  }
}
