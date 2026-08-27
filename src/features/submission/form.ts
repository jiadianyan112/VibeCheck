import {
  learningCategoryId,
  learningSchemaVersion,
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
      readonly knowledge_state: 'known_values' | 'known_empty' | 'unknown'
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

function requiredText(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields): string {
  const value = fields[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Learning snapshot requires ${String(field)}`)
  }
  return value.trim()
}

function stringList(value: unknown, field: keyof SubmissionProjectFields, required: boolean): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Learning snapshot requires ${String(field)}`)
  }
  const items = value as unknown[]
  const strings = items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if ((required && strings.length === 0) || strings.length !== items.length) {
    throw new TypeError(`Learning snapshot requires ${String(field)}`)
  }
  return strings.map((item) => item.trim())
}

function requiredList(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields): readonly string[] {
  return stringList(fields[field], field, true)
}

function optionalList(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields): readonly string[] {
  const value = fields[field]
  return Array.isArray(value) ? stringList(value, field, false) : []
}

function optionalNullableText(fields: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields): string | null {
  const value = fields[field]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
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

/** Build the exact server-owned learning.v1 payload shape used by preview/submit. */
export function buildLearningV1Snapshot(input: LearningV1SnapshotInput): LearningV1Snapshot {
  const { fields } = input
  const flow = fields.coreFlow
  if (!Array.isArray(flow) || flow.length === 0 || flow.some((node) => typeof node.label !== 'string' || node.label.trim().length === 0)) {
    throw new TypeError('Learning snapshot requires coreFlow')
  }

  return {
    project_core: {
      current_name: requiredText(fields, 'currentName'),
      public_url: requiredText(fields, 'publicUrl'),
      repository_url: optionalNullableText(fields, 'repositoryUrl'),
      original_platform: null,
      cover_media_reference_ids: [...input.coverMediaReferenceIds],
      one_line_definition: requiredText(fields, 'oneLineDefinition'),
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
      target_users: requiredList(fields, 'targetUsers'),
      core_problem: requiredText(fields, 'coreProblem'),
      use_scenarios: requiredList(fields, 'useScenarios'),
      main_inputs: requiredList(fields, 'mainInputs'),
      main_outputs: requiredList(fields, 'mainOutputs'),
      core_flow: flow.map((node, index) => ({ order: index + 1, name: node.label.trim() })),
      content_processing: [],
      practice_formats: optionalList(fields, 'practiceFormats'),
      feedback_methods: optionalList(fields, 'feedbackMethods'),
      learning_records: [],
      differentiation: optionalNullableText(fields, 'differentiation'),
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
