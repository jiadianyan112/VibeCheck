import { createHash } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import { buildSearchDocument } from '../search-document.js'
import type { CategoryId, CategorySchemaVersion, ProjectSnapshot } from '../types.js'
import { parseProjectSnapshot } from '../validation.js'

const fixtureVersion = 'catalog.synthetic.v1'
const fixtureOperationId = 'catalog_fixture_load_v1'
const fixtureTimestamp = '2026-08-01T00:00:00.000Z'

interface SyntheticProject {
  readonly projectId: string
  readonly versionId: string
  readonly sourceDecisionId: string
  readonly transactionId: string
  readonly creatorId: string
  readonly creatorProfileVersionId: string
  readonly creatorProfileDraftId: string
  readonly authorRelationId: string
  readonly verificationId: string
  readonly canonicalUrl: string
  readonly snapshot: ProjectSnapshot
}

interface SyntheticEvent {
  readonly eventId: string
  readonly projectId: string
  readonly versionId: string
  readonly eventType: 'first_published'
  readonly eventTime: string
  readonly sourceObjectId: string
  readonly summary: string
}

interface SyntheticAsset {
  readonly assetId: string
  readonly projectId: string
  readonly safeWebUrl: string
  readonly name: string
  readonly description: string
}

interface SyntheticEvidence {
  readonly evidenceId: string
  readonly objectType: 'project' | 'event' | 'asset' | 'relation'
  readonly objectId: string
  readonly projectId: string
  readonly eventId: string | null
  readonly fieldPath: string | null
  readonly decisionId: string
  readonly summary: string
}

interface SyntheticRelation {
  readonly relationId: string
  readonly subjectProjectId: string
  readonly objectProjectId: string
  readonly assetId: string
  readonly sourceDecisionId: string
}

function snapshot(
  raw: unknown,
  categoryId: CategoryId,
  schemaVersion: CategorySchemaVersion,
): ProjectSnapshot {
  return parseProjectSnapshot(raw, categoryId, schemaVersion)
}

const learningSnapshot = snapshot({
  project_core: {
    current_name: 'Recall Garden',
    public_url: 'https://recall-garden.example.test',
    repository_url: 'https://github.com/example/recall-garden',
    original_platform: 'Web',
    cover_media_reference_ids: ['synthetic-cover-learning-1'],
    one_line_definition: '把学习材料转换为可追踪的间隔练习',
    ai_coding_tools: {
      knowledge_state: 'known_values',
      values: ['Codex'],
      source_type: 'platform_verified_fact',
      observed_at: fixtureTimestamp,
    },
    tech_stack: ['TypeScript', 'PostgreSQL'],
    deployment_platform: 'Render',
    access_status: 'normal',
    maintenance_signal: 'repository_updated',
    status_note: null,
  },
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  category_data: {
    target_users: ['self_directed_learners'],
    core_problem: '把长篇材料转成可重复练习并保留学习进度',
    use_scenarios: ['daily_review'],
    main_inputs: ['notes', 'pdf'],
    main_outputs: ['quiz', 'review_queue'],
    core_flow: [
      { order: 1, name: '导入材料' },
      { order: 2, name: '生成练习' },
      { order: 3, name: '间隔复习' },
    ],
    content_processing: ['chunking', 'question_generation'],
    practice_formats: ['multiple_choice', 'short_answer'],
    feedback_methods: ['answer_explanation'],
    learning_records: ['accuracy', 'review_history'],
    differentiation: '以可核验知识点和复习队列组织练习',
    core_features: ['material_import', 'spaced_repetition'],
    secondary_features: ['share_link'],
    login_requirement: 'partial',
    sharing_capability: 'link',
  },
}, 'ai_learning_quiz', 'learning.v1')

const portfolioSnapshotOne = snapshot({
  project_core: {
    current_name: 'Northstar Portfolio',
    public_url: 'https://northstar-portfolio.example.test',
    repository_url: 'https://github.com/example/northstar-portfolio',
    original_platform: 'Web',
    cover_media_reference_ids: ['synthetic-cover-portfolio-1'],
    one_line_definition: '以案例叙事呈现产品设计与工程实践',
    ai_coding_tools: {
      knowledge_state: 'known_values',
      values: ['Codex'],
      source_type: 'verified_author_statement',
      observed_at: fixtureTimestamp,
    },
    tech_stack: ['React', 'TypeScript'],
    deployment_platform: 'Vercel',
    access_status: 'normal',
    maintenance_signal: 'page_updated',
    status_note: null,
  },
  category_id: 'personal_site_portfolio',
  category_schema_version: 'portfolio.v1',
  category_data: {
    site_type: 'portfolio',
    creator_roles: ['product_designer', 'frontend_engineer'],
    primary_goals: ['showcase_work', 'build_trust'],
    page_model: 'multi_page',
    navigation_pattern: 'top_nav',
    homepage_sequence: ['hero', 'project_showcase', 'about', 'contact'],
    core_modules: ['hero', 'project_showcase', 'case_study', 'about', 'contact'],
    project_showcase_format: 'case_study_list',
    case_study_depth: 'deep',
    visual_styles: ['editorial', 'minimal'],
    layout_patterns: ['asymmetric_grid', 'long_form'],
    color_character: 'neutral',
    theme_mode: 'switchable',
    interaction_level: 'moderate',
    interaction_patterns: ['scroll_reveal', 'project_transition'],
    responsive_support: 'confirmed',
    blog_support: 'static',
  },
}, 'personal_site_portfolio', 'portfolio.v1')

const portfolioSnapshotTwo = snapshot({
  project_core: {
    current_name: 'Field Notes Studio',
    public_url: 'https://field-notes-studio.example.test',
    repository_url: null,
    original_platform: 'Web',
    cover_media_reference_ids: ['synthetic-cover-portfolio-2'],
    one_line_definition: '用简洁项目档案呈现独立创作过程',
    ai_coding_tools: {
      knowledge_state: 'unknown',
      values: [],
      source_type: 'system_inference',
      observed_at: fixtureTimestamp,
    },
    tech_stack: ['Astro'],
    deployment_platform: 'Cloudflare Pages',
    access_status: 'normal',
    maintenance_signal: 'unknown',
    status_note: null,
  },
  category_id: 'personal_site_portfolio',
  category_schema_version: 'portfolio.v1',
  category_data: {
    site_type: 'hybrid',
    creator_roles: ['independent_creator'],
    primary_goals: ['showcase_work', 'publish_notes'],
    page_model: 'hybrid',
    navigation_pattern: 'section_anchor',
    homepage_sequence: ['hero', 'project_showcase', 'blog', 'contact'],
    core_modules: ['hero', 'project_showcase', 'blog', 'contact'],
    project_showcase_format: 'card_grid',
    case_study_depth: 'overview',
    visual_styles: ['minimal', 'typographic'],
    layout_patterns: ['modular_grid'],
    color_character: 'brand_led',
    theme_mode: 'light_only',
    interaction_level: 'light',
    interaction_patterns: ['hover_preview'],
    responsive_support: 'confirmed',
    blog_support: 'content_managed',
  },
}, 'personal_site_portfolio', 'portfolio.v1')

const projects: readonly SyntheticProject[] = Object.freeze([
  {
    projectId: '10000000-0000-4000-8000-000000000001',
    versionId: '11000000-0000-4000-8000-000000000001',
    sourceDecisionId: '12000000-0000-4000-8000-000000000001',
    transactionId: '13000000-0000-4000-8000-000000000001',
    creatorId: '16000000-0000-4000-8000-000000000001',
    creatorProfileVersionId: '17000000-0000-4000-8000-000000000001',
    creatorProfileDraftId: '18000000-0000-4000-8000-000000000001',
    authorRelationId: '19000000-0000-4000-8000-000000000001',
    verificationId: '1a000000-0000-4000-8000-000000000001',
    canonicalUrl: 'https://recall-garden.example.test',
    snapshot: learningSnapshot,
  },
  {
    projectId: '10000000-0000-4000-8000-000000000002',
    versionId: '11000000-0000-4000-8000-000000000002',
    sourceDecisionId: '12000000-0000-4000-8000-000000000002',
    transactionId: '13000000-0000-4000-8000-000000000002',
    creatorId: '16000000-0000-4000-8000-000000000002',
    creatorProfileVersionId: '17000000-0000-4000-8000-000000000002',
    creatorProfileDraftId: '18000000-0000-4000-8000-000000000002',
    authorRelationId: '19000000-0000-4000-8000-000000000002',
    verificationId: '1a000000-0000-4000-8000-000000000002',
    canonicalUrl: 'https://northstar-portfolio.example.test',
    snapshot: portfolioSnapshotOne,
  },
  {
    projectId: '10000000-0000-4000-8000-000000000003',
    versionId: '11000000-0000-4000-8000-000000000003',
    sourceDecisionId: '12000000-0000-4000-8000-000000000003',
    transactionId: '13000000-0000-4000-8000-000000000003',
    creatorId: '16000000-0000-4000-8000-000000000003',
    creatorProfileVersionId: '17000000-0000-4000-8000-000000000003',
    creatorProfileDraftId: '18000000-0000-4000-8000-000000000003',
    authorRelationId: '19000000-0000-4000-8000-000000000003',
    verificationId: '1a000000-0000-4000-8000-000000000003',
    canonicalUrl: 'https://field-notes-studio.example.test',
    snapshot: portfolioSnapshotTwo,
  },
])

const events: readonly SyntheticEvent[] = Object.freeze(projects.map((project, index) => ({
  eventId: `14000000-0000-4000-8000-00000000000${index + 1}`,
  projectId: project.projectId,
  versionId: project.versionId,
  eventType: 'first_published' as const,
  eventTime: `2026-07-${String(index + 1).padStart(2, '0')}`,
  sourceObjectId: `15000000-0000-4000-8000-00000000000${index + 1}`,
  summary: `${project.snapshot.project_core.current_name} 首次公开记录`,
})))

const assets: readonly SyntheticAsset[] = Object.freeze([
  {
    assetId: '1d000000-0000-4000-8000-000000000001',
    projectId: projects[0]!.projectId,
    safeWebUrl: 'https://github.com/example/recall-garden',
    name: 'Recall Garden source',
    description: '用于学习流程参考的合成公开源码入口',
  },
  {
    assetId: '1d000000-0000-4000-8000-000000000002',
    projectId: projects[1]!.projectId,
    safeWebUrl: 'https://github.com/example/northstar-portfolio',
    name: 'Northstar case-study layout',
    description: '用于作品案例布局参考的合成模板入口',
  },
])

const relation: SyntheticRelation = Object.freeze({
  relationId: '1e000000-0000-4000-8000-000000000001',
  subjectProjectId: projects[2]!.projectId,
  objectProjectId: projects[1]!.projectId,
  assetId: assets[1]!.assetId,
  sourceDecisionId: '1f000000-0000-4000-8000-000000000001',
})

const evidence: readonly SyntheticEvidence[] = Object.freeze([
  ...projects.map((project, index) => ({
    evidenceId: `1b000000-0000-4000-8000-00000000000${index + 1}`,
    objectType: 'project' as const,
    objectId: project.projectId,
    projectId: project.projectId,
    eventId: null,
    fieldPath: 'project_core.one_line_definition',
    decisionId: `1c000000-0000-4000-8000-00000000000${index + 1}`,
    summary: '合成测试夹具中的公开定义证据',
  })),
  {
    evidenceId: '1b000000-0000-4000-8000-000000000004',
    objectType: 'event',
    objectId: events[0]!.eventId,
    projectId: projects[0]!.projectId,
    eventId: events[0]!.eventId,
    fieldPath: null,
    decisionId: '1c000000-0000-4000-8000-000000000004',
    summary: '合成测试夹具中的首次发布观察',
  },
  {
    evidenceId: '1b000000-0000-4000-8000-000000000005',
    objectType: 'asset',
    objectId: assets[1]!.assetId,
    projectId: projects[1]!.projectId,
    eventId: null,
    fieldPath: null,
    decisionId: '1c000000-0000-4000-8000-000000000005',
    summary: '合成测试夹具中的可复用资产观察',
  },
  {
    evidenceId: '1b000000-0000-4000-8000-000000000006',
    objectType: 'relation',
    objectId: relation.relationId,
    projectId: relation.subjectProjectId,
    eventId: null,
    fieldPath: null,
    decisionId: '1c000000-0000-4000-8000-000000000006',
    summary: '合成测试夹具中的作品复用关系声明',
  },
])

const manifest = Object.freeze({ fixtureVersion, fixtureTimestamp, projects, events, assets, relation, evidence })
export const syntheticCatalogFixtureManifestHash = createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex')

export const syntheticCatalogFixture = Object.freeze({
  version: fixtureVersion,
  projects,
  events,
  assets,
  relation,
  evidence,
})

export interface SyntheticCatalogFixtureResult {
  readonly fixtureVersion: string
  readonly manifestHash: string
  readonly result: 'loaded' | 'deduplicated'
  readonly projectCount: number
  readonly eventCount: number
  readonly assetCount: number
}

async function insertProjects(client: PoolClient): Promise<void> {
  for (const project of projects) {
    const core = project.snapshot.project_core
    await client.query(
      `INSERT INTO catalog.projects (
         project_id,current_version_id,current_name,category_id,category_schema_version,
         canonical_public_url,canonical_url_hash,review_status,access_status,http_check_status,
         author_link_status,completeness_level,freshness_status,record_source,first_seen_at,
         last_verified_at,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::text,digest($6::text,'sha256'),'published_platform','normal','normal',
         'linked','complete','valid','platform_editor',$7,$7,$7,$7)
       ON CONFLICT (project_id) DO NOTHING`,
      [
        project.projectId,
        project.versionId,
        core.current_name,
        project.snapshot.category_id,
        project.snapshot.category_schema_version,
        project.canonicalUrl,
        fixtureTimestamp,
      ],
    )
    await client.query(
      `INSERT INTO catalog.project_versions (
         version_id,project_id,version_number,category_id,category_schema_version,snapshot_json,
         source_decision_type,source_decision_id,transaction_id,effective_at,created_at
       ) VALUES ($1,$2,1,$3,$4,$5::jsonb,'admin_fact',$6,$7,$8,$8)
       ON CONFLICT (version_id) DO NOTHING`,
      [
        project.versionId,
        project.projectId,
        project.snapshot.category_id,
        project.snapshot.category_schema_version,
        JSON.stringify(project.snapshot),
        project.sourceDecisionId,
        project.transactionId,
        fixtureTimestamp,
      ],
    )
    await client.query(
      `INSERT INTO catalog.creators (
         creator_id,current_profile_version_id,merge_status,created_at,updated_at
       ) VALUES ($1,$2,'canonical',$3,$3)
       ON CONFLICT (creator_id) DO NOTHING`,
      [project.creatorId, project.creatorProfileVersionId, fixtureTimestamp],
    )
    await client.query(
      `INSERT INTO catalog.creator_profile_versions (
         creator_profile_version_id,creator_id,source_creator_profile_draft_id,
         profile_snapshot_json,created_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (creator_profile_version_id) DO NOTHING`,
      [
        project.creatorProfileVersionId,
        project.creatorId,
        project.creatorProfileDraftId,
        JSON.stringify({
          display_name: `${core.current_name} Creator`,
          avatar_url: null,
          verification_status: 'verified',
          bio: 'Synthetic creator fixture for local and CI verification.',
          contacts: [],
        }),
        fixtureTimestamp,
      ],
    )
    await client.query(
      `INSERT INTO catalog.author_relations (
         author_relation_id,project_id,creator_id,status,author_role,field_permissions_json,
         source_verification_id,created_at,updated_at
       ) VALUES ($1,$2,$3,'active','creator','["project_core","category_data"]'::jsonb,$4,$5,$5)
       ON CONFLICT (author_relation_id) DO NOTHING`,
      [project.authorRelationId, project.projectId, project.creatorId, project.verificationId, fixtureTimestamp],
    )
    await client.query(
      `INSERT INTO catalog.project_interaction_counters (project_id,recalculated_at,source_watermark)
       VALUES ($1,$2,$3) ON CONFLICT (project_id) DO NOTHING`,
      [project.projectId, fixtureTimestamp, fixtureVersion],
    )
    const search = buildSearchDocument(project.snapshot)
    await client.query(
      `INSERT INTO search.project_documents (
         project_id,version_id,category_id,structured_json,search_text,ranking_features_json,indexed_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)
       ON CONFLICT (project_id) DO NOTHING`,
      [
        project.projectId,
        project.versionId,
        project.snapshot.category_id,
        JSON.stringify(search.structured),
        search.searchText,
        JSON.stringify(search.rankingFeatures),
        fixtureTimestamp,
      ],
    )
  }
}

async function insertEventsAndAssets(client: PoolClient): Promise<void> {
  for (const event of events) {
    await client.query(
      `INSERT INTO catalog.events (
         event_id,project_id,version_id,event_type,event_time,time_precision,event_sort_at,
         event_summary,source_actor,source_object_type,source_object_id,created_at
       ) VALUES ($1,$2,$3,$4,$5::text,'day',(($5::text)::date::timestamp AT TIME ZONE 'UTC'),$6,'platform_editor',
         'admin_operation',$7,$8)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.projectId, event.versionId, event.eventType, event.eventTime, event.summary, event.sourceObjectId, fixtureTimestamp],
    )
  }
  for (const asset of assets) {
    await client.query(
      `INSERT INTO catalog.assets (
         asset_id,project_id,asset_type,name,description,safe_web_url,target_hash,license_type,
         price_type,acquisition_method,availability_status,visibility,last_verified_at,created_at,updated_at
       ) VALUES ($1,$2,'source_code',$3,$4,$5::text,digest($5::text,'sha256'),'MIT','free','fork',
         'available','public',$6,$6,$6)
       ON CONFLICT (asset_id) DO NOTHING`,
      [asset.assetId, asset.projectId, asset.name, asset.description, asset.safeWebUrl, fixtureTimestamp],
    )
  }
  await client.query(
    `INSERT INTO catalog.relations (
       relation_id,subject_project_id,object_project_id,relation_type,asset_id,statement_by,
       statement_summary,confirmation_status,source_decision_id,last_verified_at,created_at,updated_at
     ) VALUES ($1,$2,$3,'uses_component',$4,'platform','合成测试夹具中的组件复用关系',
       'platform_verified',$5,$6,$6,$6)
     ON CONFLICT (relation_id) DO NOTHING`,
    [
      relation.relationId,
      relation.subjectProjectId,
      relation.objectProjectId,
      relation.assetId,
      relation.sourceDecisionId,
      fixtureTimestamp,
    ],
  )
}

async function insertEvidence(client: PoolClient): Promise<void> {
  for (const item of evidence) {
    await client.query(
      `INSERT INTO catalog.evidence (
         evidence_id,object_type,object_id,project_id,event_id,field_path,evidence_type,
         source_channel,source_url,source_summary,captured_at,verified_at,collected_by,
         confidence,visibility,validity_status,freshness_status,dispute_status,
         validity_decision_type,validity_decision_id,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'platform_verified_fact','platform_check',NULL,$7,$8,$8,
         'platform_editor','high','public','valid','valid','none','admin_fact_decision',$9,$8)
       ON CONFLICT (evidence_id) DO NOTHING`,
      [
        item.evidenceId,
        item.objectType,
        item.objectId,
        item.projectId,
        item.eventId,
        item.fieldPath,
        item.summary,
        fixtureTimestamp,
        item.decisionId,
      ],
    )
  }
}

async function assertFixtureState(client: PoolClient): Promise<void> {
  for (const project of projects) {
    const result = await client.query<{ matches: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM catalog.projects project
         JOIN catalog.project_versions version ON version.version_id = project.current_version_id
         JOIN search.project_documents document ON document.project_id = project.project_id
         WHERE project.project_id = $1
           AND project.current_version_id = $2
           AND project.current_name = $3
           AND project.category_id = $4
           AND project.category_schema_version = $5
           AND project.canonical_public_url = $6
           AND project.review_status = 'published_platform'
           AND version.snapshot_json = $7::jsonb
           AND document.version_id = $2
       ) AS matches`,
      [
        project.projectId,
        project.versionId,
        project.snapshot.project_core.current_name,
        project.snapshot.category_id,
        project.snapshot.category_schema_version,
        project.canonicalUrl,
        JSON.stringify(project.snapshot),
      ],
    )
    if (result.rows[0]?.matches !== true) throw new Error('CATALOG_FIXTURE_STATE_MISMATCH')
  }
  const counts = await client.query<{ event_count: number; asset_count: number; relation_count: number; evidence_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM catalog.events WHERE event_id = ANY($1::uuid[])) AS event_count,
       (SELECT count(*)::int FROM catalog.assets WHERE asset_id = ANY($2::uuid[])) AS asset_count,
       (SELECT count(*)::int FROM catalog.relations WHERE relation_id = $3) AS relation_count,
       (SELECT count(*)::int FROM catalog.evidence WHERE evidence_id = ANY($4::uuid[])) AS evidence_count`,
    [
      events.map(({ eventId }) => eventId),
      assets.map(({ assetId }) => assetId),
      relation.relationId,
      evidence.map(({ evidenceId }) => evidenceId),
    ],
  )
  const row = counts.rows[0]
  if (
    row?.event_count !== events.length || row.asset_count !== assets.length ||
    row.relation_count !== 1 || row.evidence_count !== evidence.length
  ) throw new Error('CATALOG_FIXTURE_STATE_MISMATCH')
}

export async function loadSyntheticCatalogFixture(
  pool: Pick<Pool, 'connect'>,
  environment: 'development' | 'test' | 'production',
): Promise<SyntheticCatalogFixtureResult> {
  if (environment === 'production') throw new Error('CATALOG_FIXTURE_PRODUCTION_FORBIDDEN')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog.synthetic.fixture', 0))")
    const audit = await client.query<{ after_hash: string }>(
      `SELECT after_hash FROM audit.audit_logs
       WHERE operation_id = $1 AND target_type = 'catalog_fixture' AND target_id = $2 AND result = 'success'
       ORDER BY created_at DESC LIMIT 1`,
      [fixtureOperationId, fixtureVersion],
    )
    if (audit.rows[0] !== undefined && audit.rows[0].after_hash !== syntheticCatalogFixtureManifestHash) {
      throw new Error('CATALOG_FIXTURE_VERSION_CONFLICT')
    }
    const result = audit.rows[0] === undefined ? 'loaded' : 'deduplicated'
    if (result === 'loaded') {
      await insertProjects(client)
      await insertEventsAndAssets(client)
      await insertEvidence(client)
    }
    await assertFixtureState(client)
    if (result === 'loaded') {
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_roles_json,target_type,target_id,after_hash,diff_json,
           reason_code,request_id,result,created_at
         ) VALUES ($1,'system','[]'::jsonb,'catalog_fixture',$2,$3,$4::jsonb,
           'synthetic_test_fixture','catalog-fixture-v1','success',$5)`,
        [
          fixtureOperationId,
          fixtureVersion,
          syntheticCatalogFixtureManifestHash,
          JSON.stringify({
            fixture_version: fixtureVersion,
            project_count: projects.length,
            event_count: events.length,
            asset_count: assets.length,
            evidence_count: evidence.length,
          }),
          fixtureTimestamp,
        ],
      )
    }
    await client.query('COMMIT')
    return Object.freeze({
      fixtureVersion,
      manifestHash: syntheticCatalogFixtureManifestHash,
      result,
      projectCount: projects.length,
      eventCount: events.length,
      assetCount: assets.length,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
