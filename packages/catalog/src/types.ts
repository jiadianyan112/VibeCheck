export const categoryIds = ['ai_learning_quiz', 'personal_site_portfolio'] as const
export type CategoryId = (typeof categoryIds)[number]

export const schemaVersions = ['learning.v1', 'portfolio.v1'] as const
export type CategorySchemaVersion = (typeof schemaVersions)[number]

export const eventTypes = [
  'first_seen',
  'first_published',
  'version_updated',
  'domain_migrated',
  'product_pivoted',
  'link_abnormal',
  'recovered',
  'paused',
  'ended',
  'asset_added',
  'reused_by_project',
  'relation_added',
] as const
export type EventType = (typeof eventTypes)[number]

export type TimePrecision = 'day' | 'month' | 'year' | 'estimated'

export const projectAccessStatuses = [
  'normal', 'login_required', 'partial_abnormal', 'link_unavailable',
  'suspected_migration', 'paused', 'ended', 'unknown',
] as const
export type ProjectAccessStatus = (typeof projectAccessStatuses)[number]

export const categoryChangeTypes = [
  'project_added', 'case_study_added', 'blog_added', 'resume_updated',
  'visual_redesign', 'theme_changed', 'tech_stack_changed', 'source_opened', 'site_repositioned',
] as const
export type CategoryChangeType = (typeof categoryChangeTypes)[number]

export const assetTypes = [
  'source_code', 'starter', 'template', 'page_layout', 'ui_component', 'motion_interaction',
  'theme_design_system', 'resume_module', 'blog_cms_module', 'deployment_config', 'prompt', 'design_file',
] as const
export type AssetType = (typeof assetTypes)[number]

export const assetComponentRoles = [
  'hero', 'navigation', 'project_showcase', 'case_study', 'contact', 'footer',
  'resume', 'blog', 'theme', 'motion', 'other',
] as const
export type AssetComponentRole = (typeof assetComponentRoles)[number]

export const assetAvailabilityStatuses = [
  'available', 'login_required', 'paid', 'contact_required', 'link_abnormal', 'removed', 'unknown',
] as const
export type AssetAvailabilityStatus = (typeof assetAvailabilityStatuses)[number]

export const assetAcquisitionMethods = [
  'repository', 'clone', 'fork', 'use_template', 'direct_download', 'purchase', 'contact',
] as const
export type AssetAcquisitionMethod = (typeof assetAcquisitionMethods)[number]

export type KnowledgeState<T> = Readonly<{
  knowledge_state: 'known_values' | 'known_empty' | 'unknown'
  values: readonly T[]
  source_type: 'platform_verified_fact' | 'verified_author_statement' | 'trusted_external_source' | 'system_inference'
  observed_at: string
}>

export interface FlowStep {
  readonly order: number
  readonly name: string
}

export interface ProjectCoreSnapshot {
  readonly current_name: string
  readonly public_url: string
  readonly repository_url: string | null
  readonly original_platform: string | null
  readonly cover_media_reference_ids: readonly string[]
  readonly one_line_definition: string
  readonly ai_coding_tools: KnowledgeState<string>
  readonly tech_stack: readonly string[]
  readonly deployment_platform: string | null
  readonly access_status: ProjectAccessStatus
  readonly maintenance_signal: 'repository_updated' | 'page_updated' | 'author_updated' | 'no_public_change' | 'unknown'
  readonly status_note: string | null
}

export interface LearningSchemaV1 {
  readonly target_users: readonly string[]
  readonly core_problem: string
  readonly use_scenarios: readonly string[]
  readonly main_inputs: readonly string[]
  readonly main_outputs: readonly string[]
  readonly core_flow: readonly FlowStep[]
  readonly content_processing: readonly string[]
  readonly practice_formats: readonly string[]
  readonly feedback_methods: readonly string[]
  readonly learning_records: readonly string[]
  readonly differentiation: string | null
  readonly core_features: readonly string[]
  readonly secondary_features: readonly string[]
  readonly login_requirement: 'none' | 'partial' | 'required' | 'unknown'
  readonly sharing_capability: 'none' | 'link' | 'result' | 'question_bank' | 'collaboration' | 'unknown'
}

export interface PortfolioSchemaV1 {
  readonly site_type: 'personal_homepage' | 'portfolio' | 'online_resume' | 'academic_homepage' | 'hybrid'
  readonly creator_roles: readonly string[]
  readonly primary_goals: readonly string[]
  readonly page_model: 'single_page' | 'multi_page' | 'hybrid'
  readonly navigation_pattern: 'top_nav' | 'side_nav' | 'section_anchor' | 'minimal_overlay' | 'no_persistent_nav' | 'other' | null
  readonly homepage_sequence: readonly string[]
  readonly core_modules: readonly string[]
  readonly project_showcase_format: 'card_grid' | 'gallery' | 'timeline' | 'case_study_list' | 'repository_list' | 'full_bleed' | 'mixed' | 'none'
  readonly case_study_depth: 'none' | 'summary' | 'overview' | 'deep'
  readonly visual_styles: readonly string[]
  readonly layout_patterns: readonly string[]
  readonly color_character: 'monochrome' | 'neutral' | 'brand_led' | 'vivid' | 'gradient_dominant' | 'mixed'
  readonly theme_mode: 'light_only' | 'dark_only' | 'switchable' | 'system_adaptive'
  readonly interaction_level: 'static' | 'light' | 'moderate' | 'high'
  readonly interaction_patterns: readonly string[]
  readonly responsive_support: 'confirmed' | 'partial' | 'not_supported' | 'unknown'
  readonly blog_support: 'none' | 'static' | 'content_managed' | 'unknown'
}

export type ProjectSnapshot =
  | Readonly<{
      project_core: ProjectCoreSnapshot
      category_id: 'ai_learning_quiz'
      category_schema_version: 'learning.v1'
      category_data: LearningSchemaV1
    }>
  | Readonly<{
      project_core: ProjectCoreSnapshot
      category_id: 'personal_site_portfolio'
      category_schema_version: 'portfolio.v1'
      category_data: PortfolioSchemaV1
    }>

export interface InteractionSummary {
  readonly favorite_count: number
  readonly like_count: number
  readonly follower_count: number
  readonly visible_comment_count: number
}

export interface CreatorSummary {
  readonly creator_id: string
  readonly display_name: string
  readonly avatar_url: string | null
  readonly verification_status: 'unverified' | 'verified' | 'disputed'
}

export interface LatestEventSummary {
  readonly event_id: string
  readonly event_type: EventType
  readonly event_time: string
  readonly time_precision: TimePrecision
  readonly event_summary: string
}

export interface EvidenceSummary {
  readonly evidence_id: string
  readonly field_path: string | null
  readonly evidence_type: 'platform_verified_fact' | 'verified_author_statement' | 'trusted_external_source' | 'system_inference'
  readonly source_channel: 'official_site' | 'repository' | 'release_note' | 'media_report' | 'author_statement' | 'platform_check'
  readonly source_summary: string
  readonly captured_at: string
  readonly verified_at: string | null
  readonly confidence: 'high' | 'medium' | 'low' | 'unknown'
  readonly freshness_status: 'valid' | 'expiring'
  readonly dispute_status: 'none' | 'in_review' | 'resolved' | 'insufficient_evidence'
}

export interface RelationPublicProjection {
  readonly relation_id: string
  readonly subject_project_id: string
  readonly subject_project_name: string
  readonly object_project_id: string
  readonly object_project_name: string
  readonly relation_type: 'inspired_by' | 'reference' | 'fork' | 'remix' | 'based_on_template' | 'uses_component' | 'source_derivative'
  readonly asset_id: string | null
  readonly statement_by: 'subject_author' | 'object_author' | 'platform' | 'system'
  readonly statement_summary: string
  readonly confirmation_status: 'unilateral_confirmed' | 'bilateral_confirmed' | 'platform_verified'
  readonly evidence_summaries: readonly EvidenceSummary[]
  readonly last_verified_at: string
  readonly read_version: number
}

export interface ProjectCardProjection {
  readonly project_id: string
  readonly version_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly category_schema_version: CategorySchemaVersion
  readonly one_line_definition: string
  readonly cover_media_reference_ids: readonly string[]
  readonly access_status: ProjectAccessStatus
  readonly review_status: 'published_platform' | 'published_author'
  readonly last_verified_at: string
  readonly creator_summaries: readonly CreatorSummary[]
  readonly ai_coding_tools: KnowledgeState<string>
  readonly interaction_summary: InteractionSummary
  readonly latest_event_summary: LatestEventSummary | null
  readonly read_version: number
}

export interface ProjectProjection extends ProjectCardProjection {
  readonly viewer_schema: 'public'
  readonly visibility: 'public'
  readonly project_core: ProjectCoreSnapshot
  readonly category_data: LearningSchemaV1 | PortfolioSchemaV1
  readonly first_seen_at: string
  readonly created_at: string
  readonly author_link_status: string
  readonly completeness_level: string
  readonly freshness_status: string
  readonly record_source: string
  readonly evidence_summaries: readonly EvidenceSummary[]
  readonly relations: readonly RelationPublicProjection[]
}

export interface ProjectListProjection {
  readonly items: readonly ProjectCardProjection[]
  readonly next_cursor: string | null
  readonly result_version: string
}

export interface ProjectSummary {
  readonly project_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly access_status: ProjectAccessStatus
}

export interface PublicFeedEventProjection {
  readonly event_id: string
  readonly project_id: string
  readonly version_id: string | null
  readonly event_type: EventType
  readonly category_change_type: CategoryChangeType | null
  readonly event_time: string
  readonly time_precision: TimePrecision
  readonly event_sort_at: string
  readonly event_sort_rule_version: 'event_sort.v1'
  readonly event_summary: string
  readonly source_actor: 'system' | 'platform_editor' | 'verified_author' | 'public_observation'
  readonly lifecycle_status: 'published' | 'superseded'
  readonly supersedes_event_id: string | null
  readonly evidence_summaries: readonly EvidenceSummary[]
  readonly evidence_dispute_summary: 'none' | 'has_in_review' | 'has_resolved' | 'has_insufficient_evidence'
  readonly project_summary: ProjectSummary
}

export interface EventPage {
  readonly items: readonly PublicFeedEventProjection[]
  readonly next_cursor: string | null
}

export interface ListPublicEventsInput {
  readonly categoryId: CategoryId | null
  readonly eventTypes: readonly EventType[]
  readonly cursor: string | null
}

export interface TopicProjection {
  readonly topic_id: string
  readonly category_id: CategoryId
  readonly canonical_slug: string
  readonly name: string
  readonly description: string
  readonly config: Readonly<Record<string, unknown>>
  readonly filter_snapshot: Readonly<Record<string, unknown>>
  readonly order: number
  readonly project_count: number
  readonly calculated_at: string
  readonly dictionary_version: number
  readonly alias_resolved: boolean
  readonly alias_chain_length: number
}

export interface CategoryTaxonomyProjection {
  readonly category_id: CategoryId
  readonly schema_version: CategorySchemaVersion
  readonly name: string
  readonly description: string
  readonly order: number
  readonly status: 'active'
  readonly dictionary_version: number
  readonly project_count: number
  readonly calculated_at: string
  readonly topics: readonly TopicProjection[]
  readonly etag: string
}

export interface AssetPublicProjection {
  readonly asset_id: string
  readonly project_id: string
  readonly asset_type: AssetType
  readonly component_role: AssetComponentRole | null
  readonly name: string
  readonly description: string
  readonly availability_status: AssetAvailabilityStatus
  readonly license_type: string
  readonly price_type: 'free' | 'paid' | 'contact' | 'unknown'
  readonly acquisition_method: AssetAcquisitionMethod
  readonly target_kind: 'safe_web_url' | 'contact_uri' | 'both'
  readonly target_status: 'requires_resolve'
  readonly evidence_summaries: readonly EvidenceSummary[]
  readonly last_verified_at: string
  readonly read_version: number
}

export interface AssetPage {
  readonly items: readonly AssetPublicProjection[]
  readonly next_cursor: string | null
}

export interface CreatorProjection extends CreatorSummary {
  readonly viewer_schema: 'public'
  readonly bio: string
  readonly contacts: readonly Readonly<Record<string, string>>[]
  readonly published_project_ids: readonly string[]
  readonly read_version: number
}

export interface ListProjectsInput {
  readonly categoryId: CategoryId | null
  readonly limit: number
  readonly cursor: string | null
}

export interface ListProjectEventsInput {
  readonly projectId: string
  readonly eventTypes: readonly EventType[]
  readonly includeSuperseded: boolean
  readonly cursor: string | null
}

export interface ListProjectAssetsInput {
  readonly projectId: string
  readonly cursor: string | null
}
