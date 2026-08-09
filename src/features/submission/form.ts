import type { ExtractionResult } from '../../services'
import type { SubmissionDraft, SubmissionProjectFields } from '../../types'

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
