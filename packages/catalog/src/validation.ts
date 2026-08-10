import { catalogError } from './errors.js'
import type {
  CategoryId,
  CategorySchemaVersion,
  KnowledgeState,
  LearningSchemaV1,
  PortfolioSchemaV1,
  ProjectCoreSnapshot,
  ProjectSnapshot,
} from './types.js'

type JsonObject = Record<string, unknown>

function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw catalogError(code, 500)
  return value as JsonObject
}

function exact(value: JsonObject, allowed: readonly string[], code: string): void {
  const allowedSet = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedSet.has(key))) throw catalogError(code, 500)
}

function text(value: unknown, minimum: number, maximum: number, code: string): string {
  if (typeof value !== 'string') throw catalogError(code, 500)
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) throw catalogError(code, 500)
  return normalized
}

function nullableText(value: unknown, maximum: number, code: string): string | null {
  return value === null ? null : text(value, 1, maximum, code)
}

function oneOf<T extends string>(value: unknown, values: readonly T[], code: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw catalogError(code, 500)
  return value as T
}

function strings(value: unknown, minimum: number, maximum: number, itemMaximum: number, code: string): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw catalogError(code, 500)
  const parsed = value.map((item) => text(item, 1, itemMaximum, code))
  if (new Set(parsed).size !== parsed.length) throw catalogError(code, 500)
  return parsed
}

function knowledgeState(value: unknown): KnowledgeState<string> {
  const record = object(value, 'CATALOG_SNAPSHOT_INVALID')
  exact(record, ['knowledge_state', 'values', 'source_type', 'observed_at'], 'CATALOG_SNAPSHOT_INVALID')
  const state = oneOf(record.knowledge_state, ['known_values', 'known_empty', 'unknown'], 'CATALOG_SNAPSHOT_INVALID')
  const values = strings(record.values, state === 'known_values' ? 1 : 0, state === 'known_values' ? 8 : 0, 50, 'CATALOG_SNAPSHOT_INVALID')
  const observedAt = text(record.observed_at, 20, 40, 'CATALOG_SNAPSHOT_INVALID')
  if (Number.isNaN(Date.parse(observedAt))) throw catalogError('CATALOG_SNAPSHOT_INVALID', 500)
  return Object.freeze({
    knowledge_state: state,
    values: Object.freeze(values),
    source_type: oneOf(record.source_type, ['platform_verified_fact', 'verified_author_statement', 'trusted_external_source', 'system_inference'], 'CATALOG_SNAPSHOT_INVALID'),
    observed_at: observedAt,
  })
}

function projectCore(value: unknown): ProjectCoreSnapshot {
  const record = object(value, 'CATALOG_SNAPSHOT_INVALID')
  exact(record, [
    'current_name', 'public_url', 'repository_url', 'original_platform',
    'cover_media_reference_ids', 'one_line_definition', 'ai_coding_tools',
    'tech_stack', 'deployment_platform', 'maintenance_signal', 'status_note',
  ], 'CATALOG_SNAPSHOT_INVALID')
  return Object.freeze({
    current_name: text(record.current_name, 1, 80, 'CATALOG_SNAPSHOT_INVALID'),
    public_url: text(record.public_url, 1, 2_048, 'CATALOG_SNAPSHOT_INVALID'),
    repository_url: nullableText(record.repository_url, 2_048, 'CATALOG_SNAPSHOT_INVALID'),
    original_platform: nullableText(record.original_platform, 120, 'CATALOG_SNAPSHOT_INVALID'),
    cover_media_reference_ids: Object.freeze(strings(record.cover_media_reference_ids, 1, 20, 64, 'CATALOG_SNAPSHOT_INVALID')),
    one_line_definition: text(record.one_line_definition, 1, 80, 'CATALOG_SNAPSHOT_INVALID'),
    ai_coding_tools: knowledgeState(record.ai_coding_tools),
    tech_stack: Object.freeze(strings(record.tech_stack, 0, 30, 50, 'CATALOG_SNAPSHOT_INVALID')),
    deployment_platform: nullableText(record.deployment_platform, 120, 'CATALOG_SNAPSHOT_INVALID'),
    maintenance_signal: oneOf(record.maintenance_signal, ['repository_updated', 'page_updated', 'author_updated', 'no_public_change', 'unknown'], 'CATALOG_SNAPSHOT_INVALID'),
    status_note: nullableText(record.status_note, 500, 'CATALOG_SNAPSHOT_INVALID'),
  })
}

function learning(value: unknown): LearningSchemaV1 {
  const record = object(value, 'LEARNING_SCHEMA_INVALID')
  exact(record, [
    'target_users', 'core_problem', 'use_scenarios', 'main_inputs', 'main_outputs',
    'core_flow', 'content_processing', 'practice_formats', 'feedback_methods',
    'learning_records', 'differentiation', 'core_features', 'secondary_features',
    'login_requirement', 'sharing_capability',
  ], 'LEARNING_SCHEMA_INVALID')
  if (!Array.isArray(record.core_flow) || record.core_flow.length < 1 || record.core_flow.length > 10) {
    throw catalogError('LEARNING_SCHEMA_INVALID', 500)
  }
  const flow = record.core_flow.map((item, index) => {
    const step = object(item, 'LEARNING_SCHEMA_INVALID')
    exact(step, ['order', 'name'], 'LEARNING_SCHEMA_INVALID')
    if (step.order !== index + 1) throw catalogError('LEARNING_SCHEMA_INVALID', 500)
    return Object.freeze({ order: index + 1, name: text(step.name, 1, 80, 'LEARNING_SCHEMA_INVALID') })
  })
  return Object.freeze({
    target_users: Object.freeze(strings(record.target_users, 1, 3, 64, 'LEARNING_SCHEMA_INVALID')),
    core_problem: text(record.core_problem, 1, 500, 'LEARNING_SCHEMA_INVALID'),
    use_scenarios: Object.freeze(strings(record.use_scenarios, 1, 5, 64, 'LEARNING_SCHEMA_INVALID')),
    main_inputs: Object.freeze(strings(record.main_inputs, 1, 5, 64, 'LEARNING_SCHEMA_INVALID')),
    main_outputs: Object.freeze(strings(record.main_outputs, 1, 5, 64, 'LEARNING_SCHEMA_INVALID')),
    core_flow: Object.freeze(flow),
    content_processing: Object.freeze(strings(record.content_processing, 0, 10, 64, 'LEARNING_SCHEMA_INVALID')),
    practice_formats: Object.freeze(strings(record.practice_formats, 0, 9, 64, 'LEARNING_SCHEMA_INVALID')),
    feedback_methods: Object.freeze(strings(record.feedback_methods, 0, 7, 64, 'LEARNING_SCHEMA_INVALID')),
    learning_records: Object.freeze(strings(record.learning_records, 0, 10, 64, 'LEARNING_SCHEMA_INVALID')),
    differentiation: nullableText(record.differentiation, 1_000, 'LEARNING_SCHEMA_INVALID'),
    core_features: Object.freeze(strings(record.core_features, 0, 20, 80, 'LEARNING_SCHEMA_INVALID')),
    secondary_features: Object.freeze(strings(record.secondary_features, 0, 30, 80, 'LEARNING_SCHEMA_INVALID')),
    login_requirement: oneOf(record.login_requirement, ['none', 'partial', 'required', 'unknown'], 'LEARNING_SCHEMA_INVALID'),
    sharing_capability: oneOf(record.sharing_capability, ['none', 'link', 'result', 'question_bank', 'collaboration', 'unknown'], 'LEARNING_SCHEMA_INVALID'),
  })
}

function portfolio(value: unknown): PortfolioSchemaV1 {
  const record = object(value, 'PORTFOLIO_SCHEMA_INVALID')
  exact(record, [
    'site_type', 'creator_roles', 'primary_goals', 'page_model', 'navigation_pattern',
    'homepage_sequence', 'core_modules', 'project_showcase_format', 'case_study_depth',
    'visual_styles', 'layout_patterns', 'color_character', 'theme_mode',
    'interaction_level', 'interaction_patterns', 'responsive_support', 'blog_support',
    'cms_support', 'cms_platform', 'multilingual_support', 'contact_methods',
    'resume_download', 'ai_features',
  ], 'PORTFOLIO_SCHEMA_INVALID')
  if (record.cms_support !== undefined) {
    oneOf(record.cms_support, ['none', 'headless', 'built_in', 'unknown'], 'PORTFOLIO_SCHEMA_INVALID')
  }
  if (record.cms_platform !== undefined) {
    nullableText(record.cms_platform, 120, 'PORTFOLIO_SCHEMA_INVALID')
  }
  if (record.multilingual_support !== undefined) {
    oneOf(record.multilingual_support, ['none', 'manual', 'automatic', 'unknown'], 'PORTFOLIO_SCHEMA_INVALID')
  }
  if (record.contact_methods !== undefined) {
    strings(record.contact_methods, 0, 20, 64, 'PORTFOLIO_SCHEMA_INVALID')
  }
  if (record.resume_download !== undefined) {
    oneOf(record.resume_download, ['available', 'not_available', 'unknown'], 'PORTFOLIO_SCHEMA_INVALID')
  }
  if (record.ai_features !== undefined) {
    strings(record.ai_features, 0, 20, 80, 'PORTFOLIO_SCHEMA_INVALID')
  }
  const coreModules = strings(record.core_modules, 2, 20, 64, 'PORTFOLIO_SCHEMA_INVALID')
  const homepageSequence = strings(record.homepage_sequence, 0, 30, 64, 'PORTFOLIO_SCHEMA_INVALID')
  if (homepageSequence.some((module) => !coreModules.includes(module))) throw catalogError('PORTFOLIO_SCHEMA_INVALID', 500)
  const interactionLevel = oneOf(record.interaction_level, ['static', 'light', 'moderate', 'high'], 'PORTFOLIO_SCHEMA_INVALID')
  const interactionPatterns = strings(record.interaction_patterns, 1, 8, 64, 'PORTFOLIO_SCHEMA_INVALID')
  if (interactionLevel === 'static' && interactionPatterns.some((pattern) => pattern !== 'none')) {
    throw catalogError('PORTFOLIO_SCHEMA_INVALID', 500)
  }
  const showcase = oneOf(record.project_showcase_format, ['card_grid', 'gallery', 'timeline', 'case_study_list', 'repository_list', 'full_bleed', 'mixed', 'none'], 'PORTFOLIO_SCHEMA_INVALID')
  const depth = oneOf(record.case_study_depth, ['none', 'summary', 'overview', 'deep'], 'PORTFOLIO_SCHEMA_INVALID')
  if (showcase === 'none' && depth !== 'none') throw catalogError('PORTFOLIO_SCHEMA_INVALID', 500)
  return Object.freeze({
    site_type: oneOf(record.site_type, ['personal_homepage', 'portfolio', 'online_resume', 'academic_homepage', 'hybrid'], 'PORTFOLIO_SCHEMA_INVALID'),
    creator_roles: Object.freeze(strings(record.creator_roles, 1, 8, 64, 'PORTFOLIO_SCHEMA_INVALID')),
    primary_goals: Object.freeze(strings(record.primary_goals, 1, 8, 64, 'PORTFOLIO_SCHEMA_INVALID')),
    page_model: oneOf(record.page_model, ['single_page', 'multi_page', 'hybrid'], 'PORTFOLIO_SCHEMA_INVALID'),
    navigation_pattern: record.navigation_pattern === null ? null : oneOf(record.navigation_pattern, ['top_nav', 'side_nav', 'section_anchor', 'minimal_overlay', 'no_persistent_nav', 'other'], 'PORTFOLIO_SCHEMA_INVALID'),
    homepage_sequence: Object.freeze(homepageSequence),
    core_modules: Object.freeze(coreModules),
    project_showcase_format: showcase,
    case_study_depth: depth,
    visual_styles: Object.freeze(strings(record.visual_styles, 1, 8, 64, 'PORTFOLIO_SCHEMA_INVALID')),
    layout_patterns: Object.freeze(strings(record.layout_patterns, 1, 8, 64, 'PORTFOLIO_SCHEMA_INVALID')),
    color_character: oneOf(record.color_character, ['monochrome', 'neutral', 'brand_led', 'vivid', 'gradient_dominant', 'mixed'], 'PORTFOLIO_SCHEMA_INVALID'),
    theme_mode: oneOf(record.theme_mode, ['light_only', 'dark_only', 'switchable', 'system_adaptive'], 'PORTFOLIO_SCHEMA_INVALID'),
    interaction_level: interactionLevel,
    interaction_patterns: Object.freeze(interactionPatterns),
    responsive_support: oneOf(record.responsive_support, ['confirmed', 'partial', 'not_supported', 'unknown'], 'PORTFOLIO_SCHEMA_INVALID'),
    blog_support: oneOf(record.blog_support, ['none', 'static', 'content_managed', 'unknown'], 'PORTFOLIO_SCHEMA_INVALID'),
  })
}

export function parseProjectSnapshot(
  value: unknown,
  expectedCategoryId: CategoryId,
  expectedSchemaVersion: CategorySchemaVersion,
): ProjectSnapshot {
  const record = object(value, 'CATALOG_SNAPSHOT_INVALID')
  exact(record, ['project_core', 'category_id', 'category_schema_version', 'category_data'], 'CATALOG_SNAPSHOT_INVALID')
  if (record.category_id !== expectedCategoryId || record.category_schema_version !== expectedSchemaVersion) {
    throw catalogError('CATALOG_SCHEMA_MISMATCH', 500)
  }
  const core = projectCore(record.project_core)
  if (core.current_name.length === 0) throw catalogError('CATALOG_SNAPSHOT_INVALID', 500)
  if (expectedCategoryId === 'ai_learning_quiz' && expectedSchemaVersion === 'learning.v1') {
    return Object.freeze({
      project_core: core,
      category_id: expectedCategoryId,
      category_schema_version: expectedSchemaVersion,
      category_data: learning(record.category_data),
    })
  }
  if (expectedCategoryId === 'personal_site_portfolio' && expectedSchemaVersion === 'portfolio.v1') {
    return Object.freeze({
      project_core: core,
      category_id: expectedCategoryId,
      category_schema_version: expectedSchemaVersion,
      category_data: portfolio(record.category_data),
    })
  }
  throw catalogError('CATALOG_SCHEMA_MISMATCH', 500)
}
