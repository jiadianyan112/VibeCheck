import type { LearningSchemaV1, PortfolioSchemaV1, ProjectSnapshot } from './types.js'

export interface CatalogSearchDocument {
  readonly structured: Readonly<Record<string, unknown>>
  readonly searchText: string
  readonly rankingFeatures: Readonly<Record<string, number>>
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function uniqueText(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    if (raw === null || raw === undefined) continue
    const value = normalize(raw)
    if (value.length === 0) continue
    const key = value.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function learningSearchValues(data: LearningSchemaV1): string[] {
  return [
    ...data.target_users,
    data.core_problem,
    ...data.use_scenarios,
    ...data.main_inputs,
    ...data.main_outputs,
    ...data.core_flow.map(({ name }) => name),
    ...data.content_processing,
    ...data.practice_formats,
    ...data.feedback_methods,
    ...data.learning_records,
    data.differentiation ?? '',
    ...data.core_features,
    ...data.secondary_features,
  ]
}

function portfolioSearchValues(data: PortfolioSchemaV1): string[] {
  return [
    data.site_type,
    ...data.creator_roles,
    ...data.primary_goals,
    data.page_model,
    data.navigation_pattern ?? '',
    ...data.homepage_sequence,
    ...data.core_modules,
    data.project_showcase_format,
    data.case_study_depth,
    ...data.visual_styles,
    ...data.layout_patterns,
    data.color_character,
    data.theme_mode,
    data.interaction_level,
    ...data.interaction_patterns,
    data.responsive_support,
    data.blog_support,
  ]
}

export function buildSearchDocument(snapshot: ProjectSnapshot): CatalogSearchDocument {
  const core = snapshot.project_core
  const aiTools = core.ai_coding_tools.knowledge_state === 'known_values'
    ? core.ai_coding_tools.values
    : []
  const categoryValues = snapshot.category_id === 'ai_learning_quiz'
    ? learningSearchValues(snapshot.category_data)
    : portfolioSearchValues(snapshot.category_data)
  const values = uniqueText([
    core.current_name,
    core.one_line_definition,
    core.original_platform,
    ...aiTools,
    ...core.tech_stack,
    core.deployment_platform,
    ...categoryValues,
  ])

  return Object.freeze({
    structured: Object.freeze({
      category_id: snapshot.category_id,
      category_schema_version: snapshot.category_schema_version,
      project_core: core,
      category_data: snapshot.category_data,
    }),
    searchText: values.join('\n'),
    rankingFeatures: Object.freeze({
      known_ai_tool_count: aiTools.length,
      tech_stack_count: core.tech_stack.length,
      indexed_term_count: values.length,
    }),
  })
}
