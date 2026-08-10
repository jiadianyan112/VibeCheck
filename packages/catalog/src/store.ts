import type { Pool } from 'pg'

import type { CategoryId, CategorySchemaVersion } from './types.js'

export interface StoredProject {
  readonly project_id: string
  readonly current_version_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly category_schema_version: CategorySchemaVersion
  readonly review_status: 'published_platform' | 'published_author' | 'restricted' | 'archived' | 'deleted'
  readonly access_status: string
  readonly http_check_status: string
  readonly author_link_status: string
  readonly completeness_level: string
  readonly freshness_status: string
  readonly record_source: string
  readonly first_seen_at: Date
  readonly last_verified_at: Date
  readonly aggregate_version: string
  readonly created_at: Date
  readonly updated_at: Date
  readonly snapshot_json: unknown
  readonly favorite_count: string
  readonly like_count: string
  readonly follower_count: string
  readonly visible_comment_count: string
  readonly creator_summaries: unknown
  readonly latest_event_summary: unknown
}

export interface StoredCreator {
  readonly creator_id: string
  readonly aggregate_version: string
  readonly merge_status: 'canonical' | 'merged' | 'disputed'
  readonly canonical_creator_id: string | null
  readonly profile_snapshot_json: unknown
  readonly published_project_ids: string[]
}

export interface ListStoredProjectsInput {
  readonly categoryId: CategoryId | null
  readonly snapshotAt: Date
  readonly afterUpdatedAt: Date | null
  readonly afterProjectId: string | null
  readonly limit: number
}

export interface CatalogStore {
  listPublicProjects(input: ListStoredProjectsInput): Promise<readonly StoredProject[]>
  getProject(projectId: string): Promise<StoredProject | null>
  getCreator(creatorId: string): Promise<StoredCreator | null>
}

const projectProjectionSql = `
  SELECT
    project.project_id,
    project.current_version_id,
    project.current_name,
    project.category_id,
    project.category_schema_version,
    project.review_status,
    project.access_status,
    project.http_check_status,
    project.author_link_status,
    project.completeness_level,
    project.freshness_status,
    project.record_source,
    project.first_seen_at,
    project.last_verified_at,
    project.aggregate_version,
    project.created_at,
    project.updated_at,
    version.snapshot_json,
    COALESCE(counter.favorite_count, 0)::text AS favorite_count,
    COALESCE(counter.like_count, 0)::text AS like_count,
    COALESCE(counter.follower_count, 0)::text AS follower_count,
    COALESCE(counter.visible_comment_count, 0)::text AS visible_comment_count,
    COALESCE(author.creator_summaries, '[]'::jsonb) AS creator_summaries,
    latest.event_summary AS latest_event_summary
  FROM catalog.projects project
  JOIN catalog.project_versions version ON version.version_id = project.current_version_id
  LEFT JOIN catalog.project_interaction_counters counter ON counter.project_id = project.project_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'creator_id', creator.creator_id,
        'display_name', profile.profile_snapshot_json->>'display_name',
        'avatar_url', profile.profile_snapshot_json->'avatar_url',
        'verification_status', COALESCE(profile.profile_snapshot_json->>'verification_status', 'unverified')
      ) ORDER BY creator.creator_id
    ) AS creator_summaries
    FROM catalog.author_relations relation
    JOIN catalog.creators creator
      ON creator.creator_id = relation.creator_id
      AND creator.merge_status = 'canonical'
    JOIN catalog.creator_profile_versions profile
      ON profile.creator_profile_version_id = creator.current_profile_version_id
    WHERE relation.project_id = project.project_id AND relation.status = 'active'
  ) author ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'event_id', event.event_id,
      'event_type', event.event_type,
      'event_time', event.event_time,
      'time_precision', event.time_precision,
      'event_summary', event.event_summary
    ) AS event_summary
    FROM catalog.events event
    WHERE event.project_id = project.project_id
    ORDER BY event.event_time DESC, event.event_id DESC
    LIMIT 1
  ) latest ON true`

export class PostgresCatalogStore implements CatalogStore {
  constructor(private readonly pool: Pool) {}

  async listPublicProjects(input: ListStoredProjectsInput): Promise<readonly StoredProject[]> {
    const result = await this.pool.query<StoredProject>(
      `${projectProjectionSql}
       WHERE project.review_status IN ('published_platform', 'published_author')
         AND ($1::text IS NULL OR project.category_id = $1)
         AND project.updated_at <= $2
         AND (
           $3::timestamptz IS NULL
           OR (project.updated_at, project.project_id) < ($3::timestamptz, $4::uuid)
         )
       ORDER BY project.updated_at DESC, project.project_id DESC
       LIMIT $5`,
      [input.categoryId, input.snapshotAt, input.afterUpdatedAt, input.afterProjectId, input.limit],
    )
    return Object.freeze(result.rows)
  }

  async getProject(projectId: string): Promise<StoredProject | null> {
    const result = await this.pool.query<StoredProject>(
      `${projectProjectionSql}
       WHERE project.project_id = $1`,
      [projectId],
    )
    return result.rows[0] ?? null
  }

  async getCreator(creatorId: string): Promise<StoredCreator | null> {
    const result = await this.pool.query<StoredCreator>(
      `SELECT creator.creator_id,creator.aggregate_version,creator.merge_status,
         creator.canonical_creator_id,profile.profile_snapshot_json,
         COALESCE(array_agg(project.project_id ORDER BY project.updated_at DESC)
           FILTER (WHERE project.project_id IS NOT NULL),ARRAY[]::uuid[]) AS published_project_ids
       FROM catalog.creators creator
       LEFT JOIN catalog.creator_profile_versions profile
         ON profile.creator_profile_version_id=creator.current_profile_version_id
       LEFT JOIN catalog.author_relations relation
         ON relation.creator_id=creator.creator_id AND relation.status='active'
       LEFT JOIN catalog.projects project
         ON project.project_id=relation.project_id
         AND project.review_status IN ('published_platform','published_author')
       WHERE creator.creator_id=$1
       GROUP BY creator.creator_id,creator.aggregate_version,creator.merge_status,
         creator.canonical_creator_id,profile.profile_snapshot_json`,
      [creatorId],
    )
    return result.rows[0] ?? null
  }
}
