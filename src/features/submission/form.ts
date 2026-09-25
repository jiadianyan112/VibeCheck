import {
  learningCategoryId,
  learningSchemaVersion,
  portfolioCategoryId,
  portfolioSchemaVersion,
  type SubmissionDraft,
  type SubmissionProjectFields,
} from '../../types'

export interface ExtractionResult {
  fields: Partial<SubmissionProjectFields>
  failedFields: Array<keyof SubmissionProjectFields>
}

export interface LearningV1SnapshotInput {
  readonly fields: Partial<SubmissionProjectFields>
  /** Media references are created and owned by the media service. */
  readonly coverMediaReferenceIds: readonly string[]
  readonly observedAt: string
}

export interface LearningV1Snapshot {
  readonly project_core: Readonly<{
    readonly current_name: string
    readonly public_url: string
    readonly repository_url: string | null
    readonly original_platform: string | null
    readonly cover_media_reference_ids: readonly string[]
    readonly one_line_definition: string
    readonly ai_coding_tools: Readonly<{
      readonly knowledge_state: 'known_values' | 'unknown'
      readonly values: readonly string[]
      readonly source_type: 'platform_verified_fact' | 'verified_author_statement' | 'trusted_external_source' | 'system_inference'
      readonly observed_at: string
    }>
    readonly tech_stack: readonly string[]
    readonly deployment_platform: string | null
    readonly access_status: 'normal' | 'login_required' | 'partial_abnormal' | 'link_unavailable' | 'suspected_migration' | 'paused' | 'ended' | 'unknown'
    readonly maintenance_signal: 'repository_updated' | 'page_updated' | 'author_updated' | 'no_public_change' | 'unknown'
    readonly status_note: string | null
  }>
  readonly category_id: typeof learningCategoryId
  readonly category_schema_version: typeof learningSchemaVersion
  readonly category_data: Readonly<{
    readonly target_users: readonly string[]
    readonly core_problem: string
    readonly use_scenarios: readonly string[]
    readonly main_inputs: readonly string[]
    readonly main_outputs: readonly string[]
    readonly core_flow: readonly Readonly<{ readonly order: number; readonly name: string }>[]
    readonly content_processing: readonly string[]
    readonly practice_formats: readonly string[]
    readonly feedback_methods: readonly string[]
    readonly learning_records: readonly string[]
    readonly differentiation: string | null
    readonly core_features: readonly string[]
    readonly secondary_features: readonly string[]
    readonly login_requirement: 'none' | 'partial' | 'required' | 'unknown'
    readonly sharing_capability: 'none' | 'link' | 'result' | 'question_bank' | 'collaboration' | 'unknown'
  }>
}

type PortfolioSiteType = NonNullable<SubmissionProjectFields['siteType']>
type PortfolioCreatorRole = NonNullable<SubmissionProjectFields['creatorRoles']>[number]
type PortfolioPrimaryGoal = NonNullable<SubmissionProjectFields['primaryGoals']>[number]
type PortfolioPageModel = NonNullable<SubmissionProjectFields['pageModel']>
type PortfolioNavigationPattern = NonNullable<SubmissionProjectFields['navigationPattern']>
type PortfolioCoreModule = NonNullable<SubmissionProjectFields['coreModules']>[number]
type PortfolioProjectShowcaseFormat = NonNullable<SubmissionProjectFields['projectShowcaseFormat']>
type PortfolioCaseStudyDepth = NonNullable<SubmissionProjectFields['caseStudyDepth']>
type PortfolioVisualStyle = NonNullable<SubmissionProjectFields['visualStyles']>[number]
type PortfolioLayoutPattern = NonNullable<SubmissionProjectFields['layoutPatterns']>[number]
type PortfolioColorCharacter = NonNullable<SubmissionProjectFields['colorCharacter']>
type PortfolioThemeMode = NonNullable<SubmissionProjectFields['themeMode']>
type PortfolioInteractionLevel = NonNullable<SubmissionProjectFields['interactionLevel']>
type PortfolioInteractionPattern = NonNullable<SubmissionProjectFields['interactionPatterns']>[number]
type PortfolioResponsiveSupport = NonNullable<SubmissionProjectFields['responsiveSupport']>
type PortfolioBlogSupport = NonNullable<SubmissionProjectFields['blogSupport']>

export interface PortfolioV1SnapshotInput {
  readonly fields: Partial<SubmissionProjectFields>
  /** Media references are created and owned by the media service. */
  readonly coverMediaReferenceIds: readonly string[]
  readonly observedAt: string
  /** The latest server payload is retained while form-owned values are overlaid. */
  readonly payloadSnapshot?: Readonly<Record<string, unknown>>
}

export interface PortfolioV1Snapshot {
  readonly project_core: Readonly<{
    readonly current_name: string
    readonly public_url: string
    readonly repository_url: string | null
    readonly original_platform: string | null
    readonly cover_media_reference_ids: readonly string[]
    readonly one_line_definition: string
    readonly ai_coding_tools: LearningV1Snapshot['project_core']['ai_coding_tools']
    readonly tech_stack: readonly string[]
    readonly deployment_platform: string | null
    readonly access_status: LearningV1Snapshot['project_core']['access_status']
    readonly maintenance_signal: LearningV1Snapshot['project_core']['maintenance_signal']
    readonly status_note: string | null
  }>
  readonly category_id: typeof portfolioCategoryId
  readonly category_schema_version: typeof portfolioSchemaVersion
  readonly category_data: Readonly<{
    readonly site_type: PortfolioSiteType
    readonly creator_roles: readonly PortfolioCreatorRole[]
    readonly primary_goals: readonly PortfolioPrimaryGoal[]
    readonly page_model: PortfolioPageModel
    readonly navigation_pattern: PortfolioNavigationPattern | null
    readonly homepage_sequence: readonly PortfolioCoreModule[]
    readonly core_modules: readonly string[]
    readonly project_showcase_format: PortfolioProjectShowcaseFormat
    readonly case_study_depth: PortfolioCaseStudyDepth
    readonly visual_styles: readonly PortfolioVisualStyle[]
    readonly layout_patterns: readonly PortfolioLayoutPattern[]
    readonly color_character: PortfolioColorCharacter
    readonly theme_mode: PortfolioThemeMode
    readonly interaction_level: PortfolioInteractionLevel
    readonly interaction_patterns: readonly PortfolioInteractionPattern[]
    readonly responsive_support: PortfolioResponsiveSupport
    readonly blog_support: PortfolioBlogSupport
    readonly cms_support?: 'none' | 'headless' | 'built_in' | 'unknown'
    readonly cms_platform?: string | null
    readonly multilingual_support?: 'none' | 'manual' | 'automatic' | 'unknown'
    readonly contact_methods?: readonly string[]
    readonly resume_download?: 'available' | 'not_available' | 'unknown'
    readonly ai_features?: readonly string[]
  }>
}

export const submissionFormSteps = ['prefill', 'definition', 'solution', 'development'] as const
export type SubmissionFormStep = (typeof submissionFormSteps)[number]

export const submissionFormStepLabels: Record<SubmissionFormStep, string> = {
  prefill: '1 基础信息',
  definition: '2 产品定义',
  solution: '3 方案与功能',
  development: '4 开发与资产',
}

const learningRequiredFields: Array<keyof SubmissionProjectFields> = [
  'currentName',
  'publicUrl',
  'oneLineDefinition',
  'accessStatus',
  'targetUsers',
  'coreProblem',
  'useScenarios',
  'mainInputs',
  'mainOutputs',
  'coreFlow',
]

const portfolioRequiredFields: Array<keyof SubmissionProjectFields> = [
  'currentName', 'publicUrl', 'oneLineDefinition', 'creatorRoles', 'primaryGoals', 'coreModules',
]

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return value !== null && value !== undefined
}

function requiredText(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields, maximum: number): string {
  const value = fields[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Learning snapshot requires ${String(field)}`)
  }
  const normalized = value.trim()
  if (normalized.length > maximum) throw new TypeError(`Learning snapshot exceeds ${String(field)} limit`)
  return normalized
}

function stringList(value: unknown, field: keyof SubmissionProjectFields, required: boolean, maximumItems: number, maximumItemLength: number): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Learning snapshot requires ${String(field)}`)
  }
  const items = value as unknown[]
  const strings = items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if ((required && strings.length === 0) || strings.length !== items.length) {
    throw new TypeError(`Learning snapshot requires ${String(field)}`)
  }
  const normalized = strings.map((item) => item.trim())
  if (normalized.length > maximumItems || normalized.some((item) => item.length > maximumItemLength) || new Set(normalized).size !== normalized.length) {
    throw new TypeError(`Learning snapshot exceeds ${String(field)} limit`)
  }
  return normalized
}

function requiredList(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields, maximumItems: number): readonly string[] {
  return stringList(fields[field], field, true, maximumItems, 64)
}

function optionalList(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields, maximumItems: number): readonly string[] {
  const value = fields[field]
  return Array.isArray(value) ? stringList(value, field, false, maximumItems, 64) : []
}

function optionalNullableText(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields, maximum: number): string | null {
  const value = fields[field]
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const normalized = value.trim()
  if (normalized.length > maximum) throw new TypeError(`Learning snapshot exceeds ${String(field)} limit`)
  return normalized
}

function canonicalAccessStatus(value: SubmissionProjectFields['accessStatus'] | undefined): LearningV1Snapshot['project_core']['access_status'] {
  if (value === 'normal' || value === 'login_required' || value === 'partial_abnormal' || value === 'link_unavailable' || value === 'suspected_migration' || value === 'paused' || value === 'ended') return value
  return 'unknown'
}

function canonicalAiCodingTools(
  values: SubmissionProjectFields['aiCodingTools'] | undefined,
  observedAt: string,
): LearningV1Snapshot['project_core']['ai_coding_tools'] {
  const knownValues = [...new Set((values ?? []).filter((value) => value !== 'unknown'))]
  return knownValues.length > 0
    ? { knowledge_state: 'known_values', values: knownValues, source_type: 'verified_author_statement', observed_at: observedAt }
    : { knowledge_state: 'unknown', values: [], source_type: 'system_inference', observed_at: observedAt }
}

const portfolioSiteTypeValues = ['personal_homepage', 'portfolio', 'online_resume', 'academic_homepage', 'hybrid'] as const
const portfolioPageModelValues = ['single_page', 'multi_page', 'hybrid'] as const
const portfolioNavigationPatternValues = ['top_nav', 'side_nav', 'section_anchor', 'minimal_overlay', 'no_persistent_nav', 'other'] as const
const portfolioProjectShowcaseFormatValues = ['card_grid', 'gallery', 'timeline', 'case_study_list', 'repository_list', 'full_bleed', 'mixed', 'none'] as const
const portfolioCaseStudyDepthValues = ['none', 'summary', 'overview', 'deep'] as const
const portfolioColorCharacterValues = ['monochrome', 'neutral', 'brand_led', 'vivid', 'gradient_dominant', 'mixed'] as const
const portfolioThemeModeValues = ['light_only', 'dark_only', 'switchable', 'system_adaptive'] as const
const portfolioInteractionLevelValues = ['static', 'light', 'moderate', 'high'] as const
const portfolioResponsiveSupportValues = ['confirmed', 'partial', 'not_supported', 'unknown'] as const
const portfolioBlogSupportValues = ['none', 'static', 'content_managed', 'unknown'] as const
const portfolioOptionalCategoryKeys = [
  'cms_support', 'cms_platform', 'multilingual_support', 'contact_methods', 'resume_download', 'ai_features',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function portfolioText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const normalized = value.trim()
  if (normalized.length > maximum) throw new TypeError(`Portfolio snapshot exceeds text limit of ${maximum}`)
  return normalized
}

function portfolioRequiredText(current: unknown, server: unknown, field: string, maximum: number): string {
  const value = current !== undefined ? current : server
  const normalized = portfolioText(value, maximum)
  if (normalized === null) throw new TypeError(`Portfolio snapshot requires ${field}`)
  return normalized
}

function portfolioNullableText(current: unknown, server: unknown, maximum: number): string | null {
  const value = current !== undefined ? current : server
  if (value === null || value === undefined) return null
  return portfolioText(value, maximum)
}

function portfolioEnum<T extends string>(
  current: unknown,
  server: unknown,
  values: readonly T[],
  fallback: T,
  field: string,
): T {
  const value = current !== undefined ? current : server
  if (typeof value === 'string' && values.includes(value as T)) return value as T
  if (current !== undefined) throw new TypeError(`Portfolio snapshot requires ${field}`)
  return fallback
}

function portfolioNullableEnum<T extends string>(
  current: unknown,
  server: unknown,
  values: readonly T[],
  field: string,
): T | null {
  const value = current !== undefined ? current : server
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && values.includes(value as T)) return value as T
  if (current !== undefined) throw new TypeError(`Portfolio snapshot requires ${field}`)
  return null
}

function portfolioList(
  current: unknown,
  server: unknown,
  minimum: number,
  maximum: number,
  fallback: readonly string[],
  field: string,
): readonly string[] {
  const value = current !== undefined ? current : server
  if (Array.isArray(value)) {
    const normalized = value.map((item) => typeof item === 'string' ? item.trim() : '')
    if (normalized.length >= minimum && normalized.length <= maximum &&
        normalized.every((item) => item.length > 0 && item.length <= 64) &&
        new Set(normalized).size === normalized.length) return normalized
  }
  if (current !== undefined) throw new TypeError(`Portfolio snapshot requires ${field}`)
  return [...fallback]
}

function isPortfolioAiCodingTools(value: unknown): value is LearningV1Snapshot['project_core']['ai_coding_tools'] {
  if (!isRecord(value) || !Array.isArray(value.values) ||
      !value.values.every((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= 50) ||
      typeof value.observed_at !== 'string' || Number.isNaN(Date.parse(value.observed_at))) return false
  if (value.knowledge_state === 'unknown') return value.values.length === 0 &&
    (value.source_type === 'platform_verified_fact' || value.source_type === 'verified_author_statement' || value.source_type === 'trusted_external_source' || value.source_type === 'system_inference')
  return value.knowledge_state === 'known_values' && value.values.length > 0 && value.values.length <= 8 &&
    (value.source_type === 'platform_verified_fact' || value.source_type === 'verified_author_statement' || value.source_type === 'trusted_external_source' || value.source_type === 'system_inference')
}

function portfolioAccessStatus(value: unknown): LearningV1Snapshot['project_core']['access_status'] {
  return value === 'normal' || value === 'login_required' || value === 'partial_abnormal' || value === 'link_unavailable' || value === 'suspected_migration' || value === 'paused' || value === 'ended'
    ? value
    : 'unknown'
}

function portfolioMaintenanceSignal(value: unknown): LearningV1Snapshot['project_core']['maintenance_signal'] {
  return value === 'repository_updated' || value === 'page_updated' || value === 'author_updated' || value === 'no_public_change'
    ? value
    : 'unknown'
}

/** Build the complete portfolio.v1 payload while retaining server-owned fields. */
export function buildPortfolioV1Snapshot(input: PortfolioV1SnapshotInput): PortfolioV1Snapshot {
  const { fields } = input
  const payloadSnapshot = isRecord(input.payloadSnapshot) ? input.payloadSnapshot : {}
  const serverProjectCore = isRecord(payloadSnapshot.project_core) ? payloadSnapshot.project_core : {}
  const nestedCategoryData = isRecord(serverProjectCore.category_data) ? serverProjectCore.category_data : {}
  const serverCategoryData = {
    ...nestedCategoryData,
    ...(isRecord(payloadSnapshot.category_data) ? payloadSnapshot.category_data : {}),
  }

  const currentName = portfolioRequiredText(fields.currentName, serverProjectCore.current_name ?? serverCategoryData.current_name, 'currentName', 80)
  const publicUrl = portfolioRequiredText(fields.publicUrl, serverProjectCore.public_url, 'publicUrl', 2_048)
  const oneLineDefinition = portfolioRequiredText(fields.oneLineDefinition, serverProjectCore.one_line_definition ?? serverCategoryData.one_line_definition, 'oneLineDefinition', 80)
  const repositoryUrl = portfolioNullableText(fields.repositoryUrl, serverProjectCore.repository_url, 2_048)
  const originalPlatform = portfolioNullableText(undefined, serverProjectCore.original_platform, 120)
  const aiCodingTools = fields.aiCodingTools !== undefined
    ? canonicalAiCodingTools(fields.aiCodingTools, input.observedAt)
    : isPortfolioAiCodingTools(serverProjectCore.ai_coding_tools)
      ? { ...serverProjectCore.ai_coding_tools, values: [...serverProjectCore.ai_coding_tools.values] }
      : canonicalAiCodingTools(undefined, input.observedAt)
  const techStack = portfolioList(undefined, serverProjectCore.tech_stack, 0, 30, [], 'techStack')
  const deploymentPlatform = portfolioNullableText(undefined, serverProjectCore.deployment_platform, 120)
  const accessStatus = portfolioAccessStatus(fields.accessStatus ?? serverProjectCore.access_status)
  const maintenanceSignal = portfolioMaintenanceSignal(serverProjectCore.maintenance_signal)
  const statusNote = portfolioNullableText(undefined, serverProjectCore.status_note, 500)

  const siteType = portfolioEnum(fields.siteType, serverCategoryData.site_type, portfolioSiteTypeValues, 'portfolio', 'siteType')
  const creatorRoles = portfolioList(fields.creatorRoles, serverCategoryData.creator_roles, 1, 8, ['other'], 'creatorRoles') as readonly PortfolioCreatorRole[]
  const primaryGoals = portfolioList(fields.primaryGoals, serverCategoryData.primary_goals, 1, 8, ['other'], 'primaryGoals') as readonly PortfolioPrimaryGoal[]
  const pageModel = portfolioEnum(fields.pageModel, serverCategoryData.page_model, portfolioPageModelValues, 'single_page', 'pageModel')
  const navigationPattern = portfolioNullableEnum(fields.navigationPattern, serverCategoryData.navigation_pattern, portfolioNavigationPatternValues, 'navigationPattern')
  const coreModules = portfolioList(fields.coreModules, serverCategoryData.core_modules, 2, 20, ['hero', 'projects'], 'coreModules') as readonly PortfolioCoreModule[]
  const homepageSequence = portfolioList(undefined, serverCategoryData.homepage_sequence, 0, 30, [], 'homepageSequence')
    .filter((module) => coreModules.includes(module as PortfolioCoreModule)) as readonly PortfolioCoreModule[]
  const projectShowcaseFormat = portfolioEnum(fields.projectShowcaseFormat, serverCategoryData.project_showcase_format, portfolioProjectShowcaseFormatValues, 'none', 'projectShowcaseFormat')
  const requestedCaseStudyDepth = portfolioEnum(fields.caseStudyDepth, serverCategoryData.case_study_depth, portfolioCaseStudyDepthValues, 'none', 'caseStudyDepth')
  const caseStudyDepth = projectShowcaseFormat === 'none' ? 'none' : requestedCaseStudyDepth
  const visualStyles = portfolioList(fields.visualStyles, serverCategoryData.visual_styles, 1, 8, ['minimal'], 'visualStyles') as readonly PortfolioVisualStyle[]
  const layoutPatterns = portfolioList(fields.layoutPatterns, serverCategoryData.layout_patterns, 1, 8, ['editorial_grid'], 'layoutPatterns') as readonly PortfolioLayoutPattern[]
  const colorCharacter = portfolioEnum(fields.colorCharacter, serverCategoryData.color_character, portfolioColorCharacterValues, 'neutral', 'colorCharacter')
  const themeMode = portfolioEnum(fields.themeMode, serverCategoryData.theme_mode, portfolioThemeModeValues, 'light_only', 'themeMode')
  const interactionLevel = portfolioEnum(fields.interactionLevel, serverCategoryData.interaction_level, portfolioInteractionLevelValues, 'static', 'interactionLevel')
  const interactionPatterns = interactionLevel === 'static'
    ? ['none'] as readonly PortfolioInteractionPattern[]
    : portfolioList(fields.interactionPatterns, serverCategoryData.interaction_patterns, 1, 8, ['none'], 'interactionPatterns') as readonly PortfolioInteractionPattern[]
  const responsiveSupport = portfolioEnum(fields.responsiveSupport, serverCategoryData.responsive_support, portfolioResponsiveSupportValues, 'unknown', 'responsiveSupport')
  const blogSupport = portfolioEnum(fields.blogSupport, serverCategoryData.blog_support, portfolioBlogSupportValues, 'unknown', 'blogSupport')

  const categoryData: Record<string, unknown> = {
    site_type: siteType,
    creator_roles: [...creatorRoles],
    primary_goals: [...primaryGoals],
    page_model: pageModel,
    navigation_pattern: navigationPattern,
    homepage_sequence: [...homepageSequence],
    core_modules: [...coreModules],
    project_showcase_format: projectShowcaseFormat,
    case_study_depth: caseStudyDepth,
    visual_styles: [...visualStyles],
    layout_patterns: [...layoutPatterns],
    color_character: colorCharacter,
    theme_mode: themeMode,
    interaction_level: interactionLevel,
    interaction_patterns: [...interactionPatterns],
    responsive_support: responsiveSupport,
    blog_support: blogSupport,
  }
  for (const key of portfolioOptionalCategoryKeys) {
    if (serverCategoryData[key] !== undefined) categoryData[key] = serverCategoryData[key]
  }

  return {
    project_core: {
      current_name: currentName,
      public_url: publicUrl,
      repository_url: repositoryUrl,
      original_platform: originalPlatform,
      cover_media_reference_ids: [...input.coverMediaReferenceIds],
      one_line_definition: oneLineDefinition,
      ai_coding_tools: aiCodingTools,
      tech_stack: [...techStack],
      deployment_platform: deploymentPlatform,
      access_status: accessStatus,
      maintenance_signal: maintenanceSignal,
      status_note: statusNote,
    },
    category_id: portfolioCategoryId,
    category_schema_version: portfolioSchemaVersion,
    category_data: categoryData,
  } as unknown as PortfolioV1Snapshot
}

/** Build the exact server-owned learning.v1 payload shape used by preview/submit. */
export function buildLearningV1Snapshot(input: LearningV1SnapshotInput): LearningV1Snapshot {
  const { fields } = input
  const flow = fields.coreFlow
  if (!Array.isArray(flow) || flow.length === 0 || flow.length > 10 || flow.some((node) => typeof node.label !== 'string' || node.label.trim().length === 0 || node.label.trim().length > 80)) {
    throw new TypeError('Learning snapshot requires coreFlow')
  }

  return {
    project_core: {
      current_name: requiredText(fields, 'currentName', 80),
      public_url: requiredText(fields, 'publicUrl', 2_048),
      repository_url: optionalNullableText(fields, 'repositoryUrl', 2_048),
      original_platform: null,
      cover_media_reference_ids: [...input.coverMediaReferenceIds],
      one_line_definition: requiredText(fields, 'oneLineDefinition', 80),
      ai_coding_tools: canonicalAiCodingTools(fields.aiCodingTools, input.observedAt),
      tech_stack: [],
      deployment_platform: null,
      access_status: canonicalAccessStatus(fields.accessStatus),
      maintenance_signal: 'unknown',
      status_note: null,
    },
    category_id: learningCategoryId,
    category_schema_version: learningSchemaVersion,
    category_data: {
      target_users: requiredList(fields, 'targetUsers', 3),
      core_problem: requiredText(fields, 'coreProblem', 500),
      use_scenarios: requiredList(fields, 'useScenarios', 5),
      main_inputs: requiredList(fields, 'mainInputs', 5),
      main_outputs: requiredList(fields, 'mainOutputs', 5),
      core_flow: flow.map((node, index) => ({ order: index + 1, name: node.label.trim() })),
      content_processing: [],
      practice_formats: optionalList(fields, 'practiceFormats', 9),
      feedback_methods: optionalList(fields, 'feedbackMethods', 7),
      learning_records: [],
      differentiation: optionalNullableText(fields, 'differentiation', 1_000),
      core_features: [],
      secondary_features: [],
      login_requirement: fields.loginRequirement ?? 'unknown',
      sharing_capability: fields.sharingCapability ?? 'unknown',
    },
  }
}

export function submissionCompleteness(draft: SubmissionDraft) {
  const requiredFields = draft.fields.categoryId === 'personal_site_portfolio' ? portfolioRequiredFields : learningRequiredFields
  const completed = requiredFields.filter((field) => hasValue(draft.fields[field])).length
  return { completed, total: requiredFields.length, percent: Math.round((completed / requiredFields.length) * 100) }
}

const stepRequiredFields: Record<SubmissionFormStep, Array<keyof SubmissionProjectFields>> = {
  prefill: ['currentName', 'oneLineDefinition', 'accessStatus'],
  definition: ['targetUsers', 'coreProblem', 'useScenarios'],
  solution: ['mainInputs', 'mainOutputs', 'coreFlow'],
  development: [],
}

const portfolioStepRequiredFields: Record<SubmissionFormStep, Array<keyof SubmissionProjectFields>> = {
  prefill: ['currentName', 'oneLineDefinition'],
  definition: ['creatorRoles', 'primaryGoals'],
  solution: ['coreModules'],
  development: [],
}

const fieldErrorLabels: Partial<Record<keyof SubmissionProjectFields, string>> = {
  currentName: '请确认作品名称。',
  oneLineDefinition: '请填写一句话定义。',
  accessStatus: '请确认基础访问状态。',
  targetUsers: '至少选择一个目标用户。',
  coreProblem: '请填写要解决的核心问题。',
  useScenarios: '至少选择一个使用场景。',
  mainInputs: '至少选择一种主要输入。',
  mainOutputs: '至少选择一种主要输出。',
  coreFlow: '至少填写一个核心流程步骤。',
  siteType: '请选择网站类型。', creatorRoles: '至少选择一种作者身份。', primaryGoals: '至少选择一个建站目的。', pageModel: '请选择页面结构。', navigationPattern: '请选择导航方式。', coreModules: '至少选择一个核心模块。', projectShowcaseFormat: '请选择项目展示形式。', caseStudyDepth: '请选择 Case Study 深度。', visualStyles: '至少选择一种视觉风格。', layoutPatterns: '至少选择一种布局方式。', colorCharacter: '请选择色彩特征。', themeMode: '请选择主题模式。', interactionLevel: '请选择交互等级。', interactionPatterns: '至少选择一种动画/交互方式。', responsiveSupport: '请选择响应式状态。', blogSupport: '请选择博客能力。',
}

export function validateSubmissionStep(draft: SubmissionDraft, step: SubmissionFormStep) {
  const required = draft.fields.categoryId === 'personal_site_portfolio' ? portfolioStepRequiredFields : stepRequiredFields
  return Object.fromEntries(
    required[step]
      .filter((field) => !hasValue(draft.fields[field]))
      .map((field) => [field, fieldErrorLabels[field] ?? '请完成此字段。']),
  )
}

export function applyExtraction(
  draft: SubmissionDraft,
  extraction: ExtractionResult,
  now = '2026-07-31T10:10:00+08:00',
): SubmissionDraft {
  const alreadyExtracted = Object.keys(draft.originalExtraction).some(
    (field) => field !== 'publicUrl' && field !== 'categoryId',
  )
  if (alreadyExtracted) return draft
  return {
    ...draft,
    step: 'prefill',
    fields: { ...extraction.fields, ...draft.fields },
    originalExtraction: { ...draft.originalExtraction, ...extraction.fields },
    validationErrors: Object.fromEntries(
      extraction.failedFields.map((field) => [field, '自动提取未完成，可手动填写或跳过非关键字段。']),
    ),
    updatedAt: now,
  }
}

export function updateDraftField<K extends keyof SubmissionProjectFields>(
  draft: SubmissionDraft,
  field: K,
  value: SubmissionProjectFields[K],
  now = '2026-07-31T10:15:00+08:00',
): SubmissionDraft {
  const { [field]: _removed, ...remainingErrors } = draft.validationErrors
  void _removed
  return {
    ...draft,
    fields: { ...draft.fields, [field]: value },
    validationErrors: remainingErrors,
    updatedAt: now,
  }
}

const serverFieldNames: Record<string, keyof SubmissionProjectFields> = {
  category_id: 'categoryId',
  category_schema_version: 'categorySchemaVersion',
  public_url: 'publicUrl',
  current_name: 'currentName',
  screenshot_url: 'screenshotUrl',
  access_status: 'accessStatus',
  repository_url: 'repositoryUrl',
  one_line_definition: 'oneLineDefinition',
  target_users: 'targetUsers',
  core_problem: 'coreProblem',
  use_scenarios: 'useScenarios',
  main_inputs: 'mainInputs',
  main_outputs: 'mainOutputs',
  core_flow: 'coreFlow',
  practice_formats: 'practiceFormats',
  feedback_methods: 'feedbackMethods',
  login_requirement: 'loginRequirement',
  sharing_capability: 'sharingCapability',
  ai_coding_tools: 'aiCodingTools',
  site_type: 'siteType',
  creator_roles: 'creatorRoles',
  primary_goals: 'primaryGoals',
  page_model: 'pageModel',
  navigation_pattern: 'navigationPattern',
  core_modules: 'coreModules',
  project_showcase_format: 'projectShowcaseFormat',
  case_study_depth: 'caseStudyDepth',
  visual_styles: 'visualStyles',
  layout_patterns: 'layoutPatterns',
  color_character: 'colorCharacter',
  theme_mode: 'themeMode',
  interaction_level: 'interactionLevel',
  interaction_patterns: 'interactionPatterns',
  responsive_support: 'responsiveSupport',
  blog_support: 'blogSupport',
}

function errorPathField(path: string) {
  const segments = path.split('/').filter(Boolean)
  const last = segments.at(-1)?.replace(/\[\d+\]$/, '') ?? path
  return serverFieldNames[last] ?? serverFieldNames[path] ?? null
}

export type SubmissionFieldErrorValue = string | { readonly path: string; readonly code: string }

/** Convert the contract's snake_case validation paths into form field errors. */
export function mapSubmissionFieldErrors(
  fieldErrors: readonly SubmissionFieldErrorValue[],
): Record<string, string> {
  return Object.fromEntries(
    fieldErrors.flatMap((fieldError) => {
      const path = typeof fieldError === 'string' ? fieldError : fieldError.path
      const code = typeof fieldError === 'string' ? 'invalid' : fieldError.code
      const field = errorPathField(path)
      return field ? [[field, `服务端校验未通过（${code}）。`]] : []
    }),
  )
}
