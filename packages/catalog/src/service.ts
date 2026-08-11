import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { catalogError } from './errors.js'
import type { CatalogStore, StoredAsset, StoredEvent, StoredProject } from './store.js'
import type {
  AssetPage,
  AssetPublicProjection,
  CategoryId,
  CreatorProjection,
  CreatorSummary,
  EvidenceSummary,
  EventPage,
  EventType,
  InteractionSummary,
  LatestEventSummary,
  ListProjectAssetsInput,
  ListProjectEventsInput,
  ListProjectsInput,
  ProjectCardProjection,
  ProjectListProjection,
  ProjectProjection,
  ProjectSummary,
  PublicFeedEventProjection,
  RelationPublicProjection,
} from './types.js'
import {
  assetAcquisitionMethods,
  assetAvailabilityStatuses,
  assetComponentRoles,
  assetTypes,
  categoryChangeTypes,
  categoryIds,
  eventTypes,
  projectAccessStatuses,
} from './types.js'
import { parseProjectSnapshot } from './validation.js'

interface CursorPayload {
  readonly v: 1
  readonly category_id: CategoryId | null
  readonly snapshot_at: string
  readonly after_updated_at: string
  readonly after_project_id: string
}

interface EventCursorPayload {
  readonly v: 1
  readonly kind: 'events'
  readonly project_id: string
  readonly event_types: readonly EventType[]
  readonly include_superseded: boolean
  readonly after_sort_at: string
  readonly after_event_id: string
}

interface AssetCursorPayload {
  readonly v: 1
  readonly kind: 'assets'
  readonly project_id: string
  readonly after_updated_at: string
  readonly after_asset_id: string
}

const publicPageSize = 30

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

function parseReadVersion(value: string | number): number {
  const version = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(version) || version < 1) throw catalogError('CATALOG_VERSION_INVALID', 500)
  return version
}

function dateString(value: unknown, code: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw catalogError(code, 500)
  return value
}

function nullableDateString(value: unknown, code: string): string | null {
  return value === null ? null : dateString(value, code)
}

function validPartialEventTime(value: unknown, precision: unknown): value is string {
  if (typeof value !== 'string' || !['day', 'month', 'year', 'estimated'].includes(String(precision))) return false
  if (precision === 'year') return /^\d{4}$/.test(value) && value !== '0000'
  if (precision === 'month') {
    const match = /^(\d{4})-(\d{2})$/.exec(value)
    return match !== null && match[1] !== '0000' && Number(match[2]) >= 1 && Number(match[2]) <= 12
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function evidenceSummaries(value: unknown): readonly EvidenceSummary[] {
  if (!Array.isArray(value) || value.length > 1_000) throw catalogError('CATALOG_EVIDENCE_PROJECTION_INVALID', 500)
  return Object.freeze(value.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw catalogError('CATALOG_EVIDENCE_PROJECTION_INVALID', 500)
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.evidence_id !== 'string' || !isUuid(record.evidence_id) ||
      (record.field_path !== null && (typeof record.field_path !== 'string' || record.field_path.length > 240)) ||
      !['platform_verified_fact', 'verified_author_statement', 'trusted_external_source', 'system_inference'].includes(String(record.evidence_type)) ||
      !['official_site', 'repository', 'release_note', 'media_report', 'author_statement', 'platform_check'].includes(String(record.source_channel)) ||
      typeof record.source_summary !== 'string' || record.source_summary.length > 2_000 ||
      !['high', 'medium', 'low', 'unknown'].includes(String(record.confidence)) ||
      !['valid', 'expiring'].includes(String(record.freshness_status)) ||
      !['none', 'in_review', 'resolved', 'insufficient_evidence'].includes(String(record.dispute_status))
    ) {
      throw catalogError('CATALOG_EVIDENCE_PROJECTION_INVALID', 500)
    }
    return Object.freeze({
      evidence_id: record.evidence_id,
      field_path: record.field_path as string | null,
      evidence_type: record.evidence_type as EvidenceSummary['evidence_type'],
      source_channel: record.source_channel as EvidenceSummary['source_channel'],
      source_summary: record.source_summary,
      captured_at: dateString(record.captured_at, 'CATALOG_EVIDENCE_PROJECTION_INVALID'),
      verified_at: nullableDateString(record.verified_at, 'CATALOG_EVIDENCE_PROJECTION_INVALID'),
      confidence: record.confidence as EvidenceSummary['confidence'],
      freshness_status: record.freshness_status as EvidenceSummary['freshness_status'],
      dispute_status: record.dispute_status as EvidenceSummary['dispute_status'],
    })
  }))
}

function relations(value: unknown): readonly RelationPublicProjection[] {
  if (!Array.isArray(value) || value.length > 1_000) throw catalogError('CATALOG_RELATION_PROJECTION_INVALID', 500)
  return Object.freeze(value.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw catalogError('CATALOG_RELATION_PROJECTION_INVALID', 500)
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.relation_id !== 'string' || !isUuid(record.relation_id) ||
      typeof record.subject_project_id !== 'string' || !isUuid(record.subject_project_id) ||
      typeof record.object_project_id !== 'string' || !isUuid(record.object_project_id) ||
      typeof record.subject_project_name !== 'string' || record.subject_project_name.length < 1 || record.subject_project_name.length > 80 ||
      typeof record.object_project_name !== 'string' || record.object_project_name.length < 1 || record.object_project_name.length > 80 ||
      !['inspired_by', 'reference', 'fork', 'remix', 'based_on_template', 'uses_component', 'source_derivative'].includes(String(record.relation_type)) ||
      (record.asset_id !== null && (typeof record.asset_id !== 'string' || !isUuid(record.asset_id))) ||
      !['subject_author', 'object_author', 'platform', 'system'].includes(String(record.statement_by)) ||
      typeof record.statement_summary !== 'string' || record.statement_summary.length < 1 || record.statement_summary.length > 1_000 ||
      !['unilateral_confirmed', 'bilateral_confirmed', 'platform_verified'].includes(String(record.confirmation_status))
    ) {
      throw catalogError('CATALOG_RELATION_PROJECTION_INVALID', 500)
    }
    return Object.freeze({
      relation_id: record.relation_id,
      subject_project_id: record.subject_project_id,
      subject_project_name: record.subject_project_name,
      object_project_id: record.object_project_id,
      object_project_name: record.object_project_name,
      relation_type: record.relation_type as RelationPublicProjection['relation_type'],
      asset_id: record.asset_id as string | null,
      statement_by: record.statement_by as RelationPublicProjection['statement_by'],
      statement_summary: record.statement_summary,
      confirmation_status: record.confirmation_status as RelationPublicProjection['confirmation_status'],
      evidence_summaries: evidenceSummaries(record.evidence_summaries),
      last_verified_at: dateString(record.last_verified_at, 'CATALOG_RELATION_PROJECTION_INVALID'),
      read_version: parseReadVersion(record.read_version as string | number),
    })
  }))
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
    typeof record.event_type !== 'string' || !eventTypes.includes(record.event_type as EventType) ||
    !validPartialEventTime(record.event_time, record.time_precision) ||
    !['day', 'month', 'year', 'estimated'].includes(String(record.time_precision)) ||
    typeof record.event_summary !== 'string'
  ) {
    throw catalogError('CATALOG_EVENT_PROJECTION_INVALID', 500)
  }
  return Object.freeze({
    event_id: record.event_id,
    event_type: record.event_type as EventType,
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
    const stored = await this.getPublicStoredProject(projectId)
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
      evidence_summaries: evidenceSummaries(stored.evidence_summaries ?? []),
      relations: relations(stored.relations ?? []),
    })
  }

  async listProjectEvents(input: ListProjectEventsInput): Promise<EventPage> {
    const projectId = requireUuid(input.projectId)
    await this.getPublicStoredProject(projectId)
    const uniqueTypes = [...new Set(input.eventTypes)]
    if (uniqueTypes.length !== input.eventTypes.length || uniqueTypes.some((type) => !eventTypes.includes(type))) {
      throw catalogError('EVENT_TYPES_INVALID', 400)
    }
    const cursor = input.cursor === null ? null : this.decodeEventCursor(input.cursor)
    if (
      cursor !== null && (
        cursor.project_id !== projectId ||
        cursor.include_superseded !== input.includeSuperseded ||
        JSON.stringify(cursor.event_types) !== JSON.stringify(uniqueTypes)
      )
    ) {
      throw catalogError('CURSOR_QUERY_MISMATCH', 400)
    }
    const stored = await this.store.listProjectEvents({
      projectId,
      eventTypes: uniqueTypes,
      includeSuperseded: input.includeSuperseded,
      afterSortAt: cursor === null ? null : new Date(cursor.after_sort_at),
      afterEventId: cursor?.after_event_id ?? null,
      limit: publicPageSize + 1,
    })
    const hasMore = stored.length > publicPageSize
    const page = stored.slice(0, publicPageSize)
    const items = Object.freeze(page.map((event) => this.event(event)))
    const last = page.at(-1)
    const nextCursor = hasMore && last
      ? this.encodeSignedCursor({
          v: 1,
          kind: 'events',
          project_id: projectId,
          event_types: uniqueTypes,
          include_superseded: input.includeSuperseded,
          after_sort_at: last.event_sort_at.toISOString(),
          after_event_id: last.event_id,
        } satisfies EventCursorPayload)
      : null
    return Object.freeze({ items, next_cursor: nextCursor })
  }

  async listProjectAssets(input: ListProjectAssetsInput): Promise<AssetPage> {
    const projectId = requireUuid(input.projectId)
    await this.getPublicStoredProject(projectId)
    const cursor = input.cursor === null ? null : this.decodeAssetCursor(input.cursor)
    if (cursor !== null && cursor.project_id !== projectId) throw catalogError('CURSOR_QUERY_MISMATCH', 400)
    const stored = await this.store.listProjectAssets({
      projectId,
      afterUpdatedAt: cursor === null ? null : new Date(cursor.after_updated_at),
      afterAssetId: cursor?.after_asset_id ?? null,
      limit: publicPageSize + 1,
    })
    const hasMore = stored.length > publicPageSize
    const page = stored.slice(0, publicPageSize)
    const items = Object.freeze(page.map((asset) => this.asset(asset)))
    const last = page.at(-1)
    const nextCursor = hasMore && last
      ? this.encodeSignedCursor({
          v: 1,
          kind: 'assets',
          project_id: projectId,
          after_updated_at: last.updated_at.toISOString(),
          after_asset_id: last.asset_id,
        } satisfies AssetCursorPayload)
      : null
    return Object.freeze({ items, next_cursor: nextCursor })
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
      read_version: parseReadVersion(stored.aggregate_version),
    })
  }

  private card(stored: StoredProject, parsed = parseProjectSnapshot(
    stored.snapshot_json,
    stored.category_id,
    stored.category_schema_version,
  )): ProjectCardProjection {
    if (stored.current_name !== parsed.project_core.current_name) throw catalogError('CATALOG_POINTER_MISMATCH', 500)
    if (!projectAccessStatuses.includes(stored.access_status as never)) {
      throw catalogError('CATALOG_PROJECT_PROJECTION_INVALID', 500)
    }
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
      access_status: stored.access_status as ProjectCardProjection['access_status'],
      review_status: stored.review_status as 'published_platform' | 'published_author',
      last_verified_at: stored.last_verified_at.toISOString(),
      creator_summaries: creatorSummaries(stored.creator_summaries),
      ai_coding_tools: parsed.project_core.ai_coding_tools,
      interaction_summary: interactionSummary,
      latest_event_summary: latestEvent(stored.latest_event_summary),
      read_version: parseReadVersion(stored.aggregate_version),
    })
  }

  private async getPublicStoredProject(projectId: string): Promise<StoredProject> {
    const stored = await this.store.getProject(requireUuid(projectId))
    if (stored === null) throw catalogError('PROJECT_NOT_FOUND', 404)
    if (stored.review_status === 'deleted') throw catalogError('PROJECT_DELETED', 410)
    if (stored.review_status === 'restricted' || stored.review_status === 'archived') {
      throw catalogError('PROJECT_NOT_PUBLIC', 403)
    }
    return stored
  }

  private event(stored: StoredEvent): PublicFeedEventProjection {
    if (
      !isUuid(stored.event_id) || !isUuid(stored.project_id) ||
      (stored.version_id !== null && !isUuid(stored.version_id)) ||
      !eventTypes.includes(stored.event_type as EventType) ||
      (stored.category_change_type !== null && !categoryChangeTypes.includes(stored.category_change_type as never)) ||
      !['day', 'month', 'year', 'estimated'].includes(stored.time_precision) ||
      stored.event_sort_rule_version !== 'event_sort.v1' ||
      stored.event_summary.length < 1 || stored.event_summary.length > 1_000 ||
      !['system', 'platform_editor', 'verified_author', 'public_observation'].includes(stored.source_actor) ||
      !['published', 'superseded'].includes(stored.lifecycle_status) ||
      (stored.supersedes_event_id !== null && !isUuid(stored.supersedes_event_id)) ||
      !['none', 'has_in_review', 'has_resolved', 'has_insufficient_evidence'].includes(stored.evidence_dispute_summary)
    ) {
      throw catalogError('CATALOG_EVENT_PROJECTION_INVALID', 500)
    }
    if (!validPartialEventTime(stored.event_time, stored.time_precision) || Number.isNaN(stored.event_sort_at.getTime())) {
      throw catalogError('CATALOG_EVENT_PROJECTION_INVALID', 500)
    }
    const summary = this.projectSummary(stored.project_summary)
    if (summary.project_id !== stored.project_id) throw catalogError('CATALOG_EVENT_PROJECTION_INVALID', 500)
    return Object.freeze({
      event_id: stored.event_id,
      project_id: stored.project_id,
      version_id: stored.version_id,
      event_type: stored.event_type as EventType,
      category_change_type: stored.category_change_type as PublicFeedEventProjection['category_change_type'],
      event_time: stored.event_time,
      time_precision: stored.time_precision as PublicFeedEventProjection['time_precision'],
      event_sort_at: stored.event_sort_at.toISOString(),
      event_sort_rule_version: 'event_sort.v1',
      event_summary: stored.event_summary,
      source_actor: stored.source_actor as PublicFeedEventProjection['source_actor'],
      lifecycle_status: stored.lifecycle_status,
      supersedes_event_id: stored.supersedes_event_id,
      evidence_summaries: evidenceSummaries(stored.evidence_summaries),
      evidence_dispute_summary: stored.evidence_dispute_summary as PublicFeedEventProjection['evidence_dispute_summary'],
      project_summary: summary,
    })
  }

  private asset(stored: StoredAsset): AssetPublicProjection {
    if (
      !isUuid(stored.asset_id) || !isUuid(stored.project_id) ||
      !assetTypes.includes(stored.asset_type as never) ||
      (stored.component_role !== null && !assetComponentRoles.includes(stored.component_role as never)) ||
      stored.name.length < 1 || stored.name.length > 120 ||
      stored.description.length < 1 || stored.description.length > 1_000 ||
      !assetAvailabilityStatuses.includes(stored.availability_status as never) ||
      stored.license_type.length < 1 || stored.license_type.length > 120 ||
      !['free', 'paid', 'contact', 'unknown'].includes(stored.price_type) ||
      !assetAcquisitionMethods.includes(stored.acquisition_method as never) ||
      (!stored.has_safe_web_url && !stored.has_contact_uri) ||
      Number.isNaN(stored.last_verified_at.getTime())
    ) {
      throw catalogError('CATALOG_ASSET_PROJECTION_INVALID', 500)
    }
    const targetKind = stored.has_safe_web_url && stored.has_contact_uri
      ? 'both'
      : stored.has_safe_web_url ? 'safe_web_url' : 'contact_uri'
    return Object.freeze({
      asset_id: stored.asset_id,
      project_id: stored.project_id,
      asset_type: stored.asset_type as AssetPublicProjection['asset_type'],
      component_role: stored.component_role as AssetPublicProjection['component_role'],
      name: stored.name,
      description: stored.description,
      availability_status: stored.availability_status as AssetPublicProjection['availability_status'],
      license_type: stored.license_type,
      price_type: stored.price_type as AssetPublicProjection['price_type'],
      acquisition_method: stored.acquisition_method as AssetPublicProjection['acquisition_method'],
      target_kind: targetKind,
      target_status: 'requires_resolve',
      evidence_summaries: evidenceSummaries(stored.evidence_summaries),
      last_verified_at: stored.last_verified_at.toISOString(),
      read_version: parseReadVersion(stored.version),
    })
  }

  private projectSummary(value: unknown): ProjectSummary {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw catalogError('CATALOG_PROJECT_SUMMARY_INVALID', 500)
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.project_id !== 'string' || !isUuid(record.project_id) ||
      typeof record.current_name !== 'string' || record.current_name.length < 1 || record.current_name.length > 80 ||
      typeof record.category_id !== 'string' || !categoryIds.includes(record.category_id as CategoryId) ||
      typeof record.access_status !== 'string' || !projectAccessStatuses.includes(record.access_status as never)
    ) {
      throw catalogError('CATALOG_PROJECT_SUMMARY_INVALID', 500)
    }
    return Object.freeze({
      project_id: record.project_id,
      current_name: record.current_name,
      category_id: record.category_id as CategoryId,
      access_status: record.access_status as ProjectSummary['access_status'],
    })
  }

  private encodeCursor(payload: CursorPayload): string {
    return this.encodeSignedCursor(payload)
  }

  private encodeSignedCursor(payload: CursorPayload | EventCursorPayload | AssetCursorPayload): string {
    const body = encodePart(JSON.stringify(payload))
    const signature = encodePart(createHmac('sha256', this.cursorSecret).update(body).digest())
    return `${body}.${signature}`
  }

  private decodeCursor(value: string): CursorPayload {
    const payload = this.decodeSignedCursor(value)
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

  private decodeEventCursor(value: string): EventCursorPayload {
    const cursor = this.decodeSignedCursor(value) as Partial<EventCursorPayload>
    if (
      cursor.v !== 1 || cursor.kind !== 'events' ||
      typeof cursor.project_id !== 'string' || !isUuid(cursor.project_id) ||
      !Array.isArray(cursor.event_types) || cursor.event_types.some((type) => !eventTypes.includes(type)) ||
      typeof cursor.include_superseded !== 'boolean' ||
      typeof cursor.after_sort_at !== 'string' || Number.isNaN(Date.parse(cursor.after_sort_at)) ||
      typeof cursor.after_event_id !== 'string' || !isUuid(cursor.after_event_id)
    ) {
      throw catalogError('CURSOR_INVALID', 400)
    }
    return cursor as EventCursorPayload
  }

  private decodeAssetCursor(value: string): AssetCursorPayload {
    const cursor = this.decodeSignedCursor(value) as Partial<AssetCursorPayload>
    if (
      cursor.v !== 1 || cursor.kind !== 'assets' ||
      typeof cursor.project_id !== 'string' || !isUuid(cursor.project_id) ||
      typeof cursor.after_updated_at !== 'string' || Number.isNaN(Date.parse(cursor.after_updated_at)) ||
      typeof cursor.after_asset_id !== 'string' || !isUuid(cursor.after_asset_id)
    ) {
      throw catalogError('CURSOR_INVALID', 400)
    }
    return cursor as AssetCursorPayload
  }

  private decodeSignedCursor(value: string): unknown {
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
    return payload
  }
}
