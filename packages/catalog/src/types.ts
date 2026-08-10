export const categoryIds = ['ai_learning_quiz', 'personal_site_portfolio'] as const
export type CategoryId = (typeof categoryIds)[number]

export const schemaVersions = ['learning.v1', 'portfolio.v1'] as const
export type CategorySchemaVersion = (typeof schemaVersions)[number]

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
  readonly event_type: string
  readonly event_time: string
  readonly time_precision: 'exact' | 'day' | 'month' | 'year' | 'estimated'
  readonly event_summary: string
}

export interface ProjectCardProjection {
  readonly project_id: string
  readonly version_id: string
  readonly current_name: string
  readonly category_id: CategoryId
  readonly category_schema_version: CategorySchemaVersion
  readonly one_line_definition: string
  readonly cover_media_reference_ids: readonly string[]
  readonly access_status: string
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
}

export interface ProjectListProjection {
  readonly items: readonly ProjectCardProjection[]
  readonly next_cursor: string | null
  readonly result_version: string
}

export interface EventProjection {
  readonly event_id: string
  readonly project_id: string
  readonly version_id: string | null
  readonly event_type: string
  readonly event_time: string
  readonly time_precision: 'exact' | 'day' | 'month' | 'year' | 'estimated'
  readonly event_summary: string
  readonly evidence_id: string | null
}

export interface AssetProjection {
  readonly asset_id: string
  readonly project_id: string
  readonly asset_type: string
  readonly name: string
  readonly description: string
  readonly canonical_url: string
  readonly availability_status: string
  readonly license: string | null
  readonly price: Readonly<Record<string, unknown>>
  readonly evidence_id: string | null
  readonly last_verified_at: string | null
  readonly version: number
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
