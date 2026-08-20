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
  readonly evidence_summaries?: unknown
  readonly relations?: unknown
}

export interface StoredCreator {
  readonly creator_id: string
  readonly aggregate_version: string
  readonly merge_status: 'canonical' | 'merged' | 'disputed'
  readonly canonical_creator_id: string | null
  readonly profile_snapshot_json: unknown
  readonly published_project_ids: string[]
}

export interface StoredEvent {
  readonly event_id: string
  readonly project_id: string
  readonly version_id: string | null
  readonly event_type: string
  readonly category_change_type: string | null
  readonly event_time: string
  readonly time_precision: string
  readonly event_sort_at: Date
  readonly event_sort_rule_version: string
  readonly event_summary: string
  readonly source_actor: string
  readonly lifecycle_status: 'published' | 'superseded'
  readonly supersedes_event_id: string | null
  readonly evidence_summaries: unknown
  readonly evidence_dispute_summary: string
  readonly project_summary: unknown
}

export interface StoredAsset {
  readonly asset_id: string
  readonly project_id: string
  readonly asset_type: string
  readonly component_role: string | null
  readonly name: string
  readonly description: string
  readonly availability_status: string
  readonly license_type: string
  readonly price_type: string
  readonly acquisition_method: string
  readonly has_safe_web_url: boolean
  readonly has_contact_uri: boolean
  readonly evidence_summaries: unknown
  readonly last_verified_at: Date
  readonly version: string
  readonly updated_at: Date
}

export interface StoredCategoryTaxonomy {
  readonly category_id: CategoryId
  readonly schema_version: CategorySchemaVersion
  readonly name: string
  readonly description: string
  readonly display_order: number
  readonly dictionary_version: string
  readonly project_count: number
  readonly calculated_at: Date
  readonly topics: unknown
}

export interface StoredTopic {
  readonly topic_id: string
  readonly category_id: CategoryId
  readonly canonical_slug: string
  readonly name: string
  readonly description: string
  readonly config_json: unknown
  readonly filter_snapshot_json: unknown
  readonly display_order: number
  readonly dictionary_version: string
  readonly project_count: number
  readonly calculated_at: Date
  readonly alias_resolved: boolean
  readonly alias_chain_length: number
}

export interface ListStoredProjectsInput {
  readonly categoryId: CategoryId | null
  readonly snapshotAt: Date
  readonly afterUpdatedAt: Date | null
  readonly afterProjectId: string | null
  readonly limit: number
}

export interface ListStoredEventsInput {
  readonly projectId: string
  readonly eventTypes: readonly string[]
  readonly includeSuperseded: boolean
  readonly afterSortAt: Date | null
  readonly afterEventId: string | null
  readonly limit: number
}

export interface ListStoredAssetsInput {
  readonly projectId: string
  readonly afterUpdatedAt: Date | null
  readonly afterAssetId: string | null
  readonly limit: number
}

export interface ListStoredPublicEventsInput {
  readonly categoryId: CategoryId | null
  readonly eventTypes: readonly string[]
  readonly afterSortAt: Date | null
  readonly afterEventId: string | null
  readonly limit: number
}

export interface CatalogStore {
  listPublicProjects(input: ListStoredProjectsInput): Promise<readonly StoredProject[]>
  getProject(projectId: string): Promise<StoredProject | null>
  getCreator(creatorId: string): Promise<StoredCreator | null>
  listProjectEvents(input: ListStoredEventsInput): Promise<readonly StoredEvent[]>
  listPublicEvents(input: ListStoredPublicEventsInput): Promise<readonly StoredEvent[]>
  listProjectAssets(input: ListStoredAssetsInput): Promise<readonly StoredAsset[]>
  getCategoryTaxonomy(categoryId: CategoryId): Promise<StoredCategoryTaxonomy | null>
  getTopic(slug: string): Promise<StoredTopic | null>
}

function publicEvidenceJson(alias: string): string {
  return `jsonb_build_object(
    'evidence_id', ${alias}.evidence_id,
    'field_path', ${alias}.field_path,
    'evidence_type', ${alias}.evidence_type,
    'source_channel', ${alias}.source_channel,
    'source_summary', ${alias}.source_summary,
    'captured_at', ${alias}.captured_at,
    'verified_at', ${alias}.verified_at,
    'confidence', ${alias}.confidence,
    'freshness_status', ${alias}.freshness_status,
    'dispute_status', ${alias}.dispute_status
  )`
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
      AND NOT EXISTS (
        SELECT 1 FROM catalog.events replacement WHERE replacement.supersedes_event_id = event.event_id
      )
    ORDER BY event.event_sort_at DESC, event.event_id DESC
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
      `SELECT base.*,
         COALESCE(project_evidence.evidence_summaries, '[]'::jsonb) AS evidence_summaries,
         COALESCE(project_relations.relations, '[]'::jsonb) AS relations
       FROM (${projectProjectionSql}
         WHERE project.project_id = $1
       ) base
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(${publicEvidenceJson('evidence')} ORDER BY evidence.captured_at DESC, evidence.evidence_id DESC)
           AS evidence_summaries
         FROM catalog.evidence evidence
         WHERE evidence.project_id = base.project_id
           AND (
             (evidence.object_type = 'project' AND evidence.object_id = base.project_id)
             OR (evidence.object_type = 'version' AND evidence.object_id = base.current_version_id)
           )
           AND evidence.visibility = 'public'
           AND evidence.validity_status = 'valid'
           AND evidence.freshness_status <> 'expired'
       ) project_evidence ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'relation_id', relation.relation_id,
             'subject_project_id', relation.subject_project_id,
             'subject_project_name', subject.current_name,
             'object_project_id', relation.object_project_id,
             'object_project_name', object_project.current_name,
             'relation_type', relation.relation_type,
             'asset_id', relation.asset_id,
             'statement_by', relation.statement_by,
             'statement_summary', relation.statement_summary,
             'confirmation_status', relation.confirmation_status,
             'evidence_summaries', COALESCE(relation_evidence.evidence_summaries, '[]'::jsonb),
             'last_verified_at', relation.last_verified_at,
             'read_version', relation.version
           ) ORDER BY relation.last_verified_at DESC, relation.relation_id DESC
         ) AS relations
         FROM catalog.relations relation
         JOIN catalog.projects subject ON subject.project_id = relation.subject_project_id
           AND subject.review_status IN ('published_platform', 'published_author')
         JOIN catalog.projects object_project ON object_project.project_id = relation.object_project_id
           AND object_project.review_status IN ('published_platform', 'published_author')
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(${publicEvidenceJson('evidence')} ORDER BY evidence.captured_at DESC, evidence.evidence_id DESC)
             AS evidence_summaries
           FROM catalog.evidence evidence
           WHERE evidence.object_type = 'relation'
             AND evidence.object_id = relation.relation_id
             AND evidence.visibility = 'public'
             AND evidence.validity_status = 'valid'
             AND evidence.freshness_status <> 'expired'
         ) relation_evidence ON true
         WHERE (relation.subject_project_id = base.project_id OR relation.object_project_id = base.project_id)
           AND relation.confirmation_status IN ('unilateral_confirmed', 'bilateral_confirmed', 'platform_verified')
       ) project_relations ON true`,
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

  async listProjectEvents(input: ListStoredEventsInput): Promise<readonly StoredEvent[]> {
    const result = await this.pool.query<StoredEvent>(
      `SELECT event.event_id,event.project_id,event.version_id,event.event_type,
         event.category_change_type,event.event_time,event.time_precision,event.event_sort_at,
         event.event_sort_rule_version,event.event_summary,event.source_actor,
         CASE WHEN replacement.event_id IS NULL THEN 'published' ELSE 'superseded' END AS lifecycle_status,
         event.supersedes_event_id,
         COALESCE(event_evidence.evidence_summaries, '[]'::jsonb) AS evidence_summaries,
         CASE
           WHEN event_evidence.has_in_review THEN 'has_in_review'
           WHEN event_evidence.has_insufficient THEN 'has_insufficient_evidence'
           WHEN event_evidence.has_resolved THEN 'has_resolved'
           ELSE 'none'
         END AS evidence_dispute_summary,
         jsonb_build_object(
           'project_id', project.project_id,
           'current_name', project.current_name,
           'category_id', project.category_id,
           'access_status', project.access_status
         ) AS project_summary
       FROM catalog.events event
       JOIN catalog.projects project ON project.project_id = event.project_id
       LEFT JOIN catalog.events replacement ON replacement.supersedes_event_id = event.event_id
       LEFT JOIN LATERAL (
         SELECT
           jsonb_agg(${publicEvidenceJson('evidence')} ORDER BY evidence.captured_at DESC, evidence.evidence_id DESC)
             AS evidence_summaries,
           COALESCE(bool_or(evidence.dispute_status = 'in_review'), false) AS has_in_review,
           COALESCE(bool_or(evidence.dispute_status = 'insufficient_evidence'), false) AS has_insufficient,
           COALESCE(bool_or(evidence.dispute_status = 'resolved'), false) AS has_resolved
         FROM catalog.evidence evidence
         WHERE evidence.event_id = event.event_id
           AND evidence.visibility = 'public'
           AND evidence.validity_status = 'valid'
           AND evidence.freshness_status <> 'expired'
       ) event_evidence ON true
       WHERE event.project_id = $1
         AND (cardinality($2::text[]) = 0 OR event.event_type = ANY($2::text[]))
         AND ($3::timestamptz IS NULL OR (event.event_sort_at, event.event_id) < ($3::timestamptz, $4::uuid))
         AND ($5::boolean OR replacement.event_id IS NULL)
       ORDER BY event.event_sort_at DESC, event.event_id DESC
       LIMIT $6`,
      [
        input.projectId,
        input.eventTypes,
        input.afterSortAt,
        input.afterEventId,
        input.includeSuperseded,
        input.limit,
      ],
    )
    return Object.freeze(result.rows)
  }

  async listPublicEvents(input: ListStoredPublicEventsInput): Promise<readonly StoredEvent[]> {
    const result = await this.pool.query<StoredEvent>(
      `SELECT event.event_id,event.project_id,event.version_id,event.event_type,
         event.category_change_type,event.event_time,event.time_precision,event.event_sort_at,
         event.event_sort_rule_version,event.event_summary,event.source_actor,
         'published'::text AS lifecycle_status,event.supersedes_event_id,
         COALESCE(event_evidence.evidence_summaries, '[]'::jsonb) AS evidence_summaries,
         CASE
           WHEN event_evidence.has_in_review THEN 'has_in_review'
           WHEN event_evidence.has_insufficient THEN 'has_insufficient_evidence'
           WHEN event_evidence.has_resolved THEN 'has_resolved'
           ELSE 'none'
         END AS evidence_dispute_summary,
         jsonb_build_object(
           'project_id', project.project_id,
           'current_name', project.current_name,
           'category_id', project.category_id,
           'access_status', project.access_status
         ) AS project_summary
       FROM catalog.events event
       JOIN catalog.projects project ON project.project_id=event.project_id
       LEFT JOIN catalog.events replacement ON replacement.supersedes_event_id=event.event_id
       LEFT JOIN LATERAL (
         SELECT
           jsonb_agg(${publicEvidenceJson('evidence')} ORDER BY evidence.captured_at DESC,evidence.evidence_id DESC)
             AS evidence_summaries,
           COALESCE(bool_or(evidence.dispute_status='in_review'),false) AS has_in_review,
           COALESCE(bool_or(evidence.dispute_status='insufficient_evidence'),false) AS has_insufficient,
           COALESCE(bool_or(evidence.dispute_status='resolved'),false) AS has_resolved
         FROM catalog.evidence evidence
         WHERE evidence.event_id=event.event_id
           AND evidence.visibility='public'
           AND evidence.validity_status='valid'
           AND evidence.freshness_status<>'expired'
       ) event_evidence ON true
       WHERE project.review_status IN ('published_platform','published_author')
         AND replacement.event_id IS NULL
         AND ($1::text IS NULL OR project.category_id=$1)
         AND (cardinality($2::text[])=0 OR event.event_type=ANY($2::text[]))
         AND ($3::timestamptz IS NULL OR (event.event_sort_at,event.event_id)<($3::timestamptz,$4::uuid))
       ORDER BY event.event_sort_at DESC,event.event_id DESC
       LIMIT $5`,
      [input.categoryId,input.eventTypes,input.afterSortAt,input.afterEventId,input.limit],
    )
    return Object.freeze(result.rows)
  }

  async listProjectAssets(input: ListStoredAssetsInput): Promise<readonly StoredAsset[]> {
    const result = await this.pool.query<StoredAsset>(
      `SELECT asset.asset_id,asset.project_id,asset.asset_type,asset.component_role,
         asset.name,asset.description,asset.availability_status,asset.license_type,
         asset.price_type,asset.acquisition_method,
         (asset.safe_web_url IS NOT NULL) AS has_safe_web_url,
         (asset.contact_uri IS NOT NULL) AS has_contact_uri,
         COALESCE(asset_evidence.evidence_summaries, '[]'::jsonb) AS evidence_summaries,
         asset.last_verified_at,asset.version::text,asset.updated_at
       FROM catalog.assets asset
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(${publicEvidenceJson('evidence')} ORDER BY evidence.captured_at DESC, evidence.evidence_id DESC)
           AS evidence_summaries
         FROM catalog.evidence evidence
         WHERE evidence.object_type = 'asset'
           AND evidence.object_id = asset.asset_id
           AND evidence.visibility = 'public'
           AND evidence.validity_status = 'valid'
           AND evidence.freshness_status <> 'expired'
       ) asset_evidence ON true
       WHERE asset.project_id = $1
         AND asset.visibility = 'public'
         AND asset.availability_status <> 'removed'
         AND ($2::timestamptz IS NULL OR (asset.updated_at, asset.asset_id) < ($2::timestamptz, $3::uuid))
       ORDER BY asset.updated_at DESC, asset.asset_id DESC
       LIMIT $4`,
      [input.projectId, input.afterUpdatedAt, input.afterAssetId, input.limit],
    )
    return Object.freeze(result.rows)
  }

  async getCategoryTaxonomy(categoryId: CategoryId): Promise<StoredCategoryTaxonomy | null> {
    const result = await this.pool.query<StoredCategoryTaxonomy>(
      `SELECT category.category_id,category.schema_version,category.name,category.description,
         category.display_order,category.dictionary_version,
         count(DISTINCT project.project_id)::int AS project_count,
         statement_timestamp() AS calculated_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'topic_id',topic.topic_id,
             'category_id',topic.category_id,
             'canonical_slug',topic.canonical_slug,
             'name',topic.name,
             'description',topic.description,
             'config_json',topic.config_json,
             'filter_snapshot_json',topic.filter_snapshot_json,
             'display_order',topic.display_order,
             'dictionary_version',topic.dictionary_version,
             'project_count',(
               SELECT count(*)::int
               FROM catalog.projects topic_project
               JOIN catalog.project_versions topic_version
                 ON topic_version.version_id=topic_project.current_version_id
               WHERE topic_project.review_status IN ('published_platform','published_author')
                 AND topic_project.category_id=topic.category_id
                 AND (topic_version.snapshot_json->'category_data')
                   @> COALESCE(topic.filter_snapshot_json->'category_fields','{}'::jsonb)
             ),
             'calculated_at',statement_timestamp(),
             'alias_resolved',false,
             'alias_chain_length',0
           ) ORDER BY topic.display_order,topic.topic_id)
           FROM taxonomy.topics topic
           WHERE topic.category_id=category.category_id AND topic.status='active'
         ),'[]'::jsonb) AS topics
       FROM taxonomy.categories category
       LEFT JOIN catalog.projects project
         ON project.category_id=category.category_id
        AND project.review_status IN ('published_platform','published_author')
       WHERE category.category_id=$1 AND category.status='active'
       GROUP BY category.category_id,category.schema_version,category.name,category.description,
         category.display_order,category.dictionary_version`,
      [categoryId],
    )
    return result.rows[0] ?? null
  }

  async getTopic(slug: string): Promise<StoredTopic | null> {
    const result = await this.pool.query<StoredTopic>(
      `WITH requested AS (
         SELECT topic.*,false AS alias_resolved,0::int AS alias_chain_length
         FROM taxonomy.topics topic WHERE topic.canonical_slug=$1
         UNION ALL
         SELECT topic.*,true AS alias_resolved,1::int AS alias_chain_length
         FROM taxonomy.topic_aliases alias
         JOIN taxonomy.topics topic ON topic.topic_id=alias.target_topic_id
         WHERE alias.alias_slug=$1 AND alias.status='active'
       )
       SELECT requested.topic_id,requested.category_id,requested.canonical_slug,
         requested.name,requested.description,requested.config_json,
         requested.filter_snapshot_json,requested.display_order,requested.dictionary_version,
         (
           SELECT count(*)::int
           FROM catalog.projects project
           JOIN catalog.project_versions version ON version.version_id=project.current_version_id
           WHERE project.category_id=requested.category_id
             AND project.review_status IN ('published_platform','published_author')
             AND (version.snapshot_json->'category_data')
               @> COALESCE(requested.filter_snapshot_json->'category_fields','{}'::jsonb)
         ) AS project_count,statement_timestamp() AS calculated_at,
         requested.alias_resolved,requested.alias_chain_length
       FROM requested
       WHERE requested.status='active'
       LIMIT 1`,
      [slug],
    )
    return result.rows[0] ?? null
  }
}
