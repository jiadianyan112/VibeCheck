import type { ExtractionResult } from '../../services'
import type { SubmissionDraft, SubmissionProjectFields, SubmitterRelation } from '../../types'

export const submissionFormSteps = ['prefill', 'definition', 'solution', 'development'] as const
export type SubmissionFormStep = (typeof submissionFormSteps)[number]

export const submissionFormStepLabels: Record<SubmissionFormStep, string> = {
  prefill: '1 基础信息',
  definition: '2 产品定义',
  solution: '3 方案与功能',
  development: '4 开发与资产',
}

export const submitterRelationLabels: Record<SubmitterRelation, string> = {
  owner: '所有者',
  team_member: '团队成员',
  third_party: '第三方推荐者',
}

const submitterRelations = new Set<SubmitterRelation>(['owner', 'team_member', 'third_party'])

const learningRequiredFields: Array<keyof SubmissionProjectFields> = [
  'currentName',
  'publicUrl',
  'submitterRelation',
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
  'currentName',
  'publicUrl',
  'submitterRelation',
  'oneLineDefinition',
  'creatorRoles',
  'primaryGoals',
  'coreModules',
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
  prefill: ['currentName', 'publicUrl', 'submitterRelation', 'oneLineDefinition', 'accessStatus'],
  definition: ['targetUsers', 'coreProblem', 'useScenarios'],
  solution: ['mainInputs', 'mainOutputs', 'coreFlow'],
  development: [],
}

const portfolioStepRequiredFields: Record<SubmissionFormStep, Array<keyof SubmissionProjectFields>> = {
  prefill: ['currentName', 'publicUrl', 'submitterRelation', 'oneLineDefinition'],
  definition: ['creatorRoles', 'primaryGoals'],
  solution: ['coreModules'],
  development: [],
}

const fieldErrorLabels: Partial<Record<keyof SubmissionProjectFields, string>> = {
  currentName: '请确认作品名称。',
  publicUrl: '请提供有效的公开访问地址。',
  submitterRelation: '请选择提交者关系。',
  oneLineDefinition: '请填写一句话定义。',
  accessStatus: '请确认基础访问状态。',
  targetUsers: '至少选择一个目标用户。',
  coreProblem: '请填写要解决的核心问题。',
  useScenarios: '至少选择一个使用场景。',
  mainInputs: '至少选择一种主要输入。',
  mainOutputs: '至少选择一种主要输出。',
  coreFlow: '至少填写一个核心流程步骤。',
  creatorRoles: '至少选择一种作者身份。',
  primaryGoals: '至少选择一个建站目的。',
  coreModules: '至少选择一个核心模块。',
}

const fieldSteps: Record<string, SubmissionFormStep> = {
  categoryId: 'prefill',
  currentName: 'prefill',
  publicUrl: 'prefill',
  submitterRelation: 'prefill',
  screenshotUrl: 'prefill',
  accessStatus: 'prefill',
  repositoryUrl: 'prefill',
  oneLineDefinition: 'prefill',
  organizationName: 'prefill',
  detailedDescription: 'definition',
  logoUrl: 'prefill',
  galleryUrls: 'definition',
  videoUrl: 'definition',
  targetUsers: 'definition',
  coreProblem: 'definition',
  useScenarios: 'definition',
  mainInputs: 'solution',
  mainOutputs: 'solution',
  coreFlow: 'solution',
  practiceFormats: 'solution',
  feedbackMethods: 'solution',
  differentiation: 'solution',
  aiCodingTools: 'development',
  acknowledgements: 'development',
  siteType: 'definition',
  creatorRoles: 'definition',
  primaryGoals: 'definition',
  pageModel: 'definition',
  navigationPattern: 'definition',
  coreModules: 'solution',
  projectShowcaseFormat: 'solution',
  caseStudyDepth: 'solution',
  visualStyles: 'definition',
  layoutPatterns: 'definition',
  colorCharacter: 'definition',
  themeMode: 'definition',
  interactionLevel: 'definition',
  interactionPatterns: 'definition',
  responsiveSupport: 'definition',
  blogSupport: 'definition',
}

/** Resolve a validation key to the form step that can edit it. */
export function submissionFieldStep(field: string): SubmissionFormStep {
  return fieldSteps[field] ?? 'prefill'
}

function validHttpUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      parsed.hostname.includes('.') &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

function validBilibiliUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    const hostname = parsed.hostname.toLowerCase()
    return (
      parsed.protocol === 'https:' &&
      (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com') || hostname === 'b23.tv' || hostname.endsWith('.b23.tv')) &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

function optionalUrlError(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  return validHttpUrl(value) ? undefined : `${label}必须是无凭据的 HTTP 或 HTTPS URL。`
}

function acknowledgementsError(value: unknown) {
  if (value === null || value === undefined) return undefined
  if (!Array.isArray(value)) return '致谢信息格式不正确。'
  for (const item of value) {
    if (!item || typeof item !== 'object') return '每条致谢都必须包含名称、说明和可选 URL。'
    const acknowledgement = item as Partial<{ name: unknown; url: unknown; note: unknown }>
    if (typeof acknowledgement.name !== 'string' || !acknowledgement.name.trim()) return '每条致谢都必须填写名称。'
    if (typeof acknowledgement.note !== 'string' || !acknowledgement.note.trim()) return '每条致谢都必须填写说明。'
    if (acknowledgement.url !== undefined && acknowledgement.url !== null && String(acknowledgement.url).trim() && !validHttpUrl(acknowledgement.url)) {
      return '致谢 URL 必须是无凭据的 HTTP 或 HTTPS URL。'
    }
  }
  return undefined
}

function formatError(field: keyof SubmissionProjectFields, value: unknown) {
  if (field === 'submitterRelation') {
    return value !== undefined && value !== null && submitterRelations.has(value as SubmitterRelation)
      ? undefined
      : '请选择有效的提交者关系。'
  }
  if (field === 'publicUrl') return validHttpUrl(value) ? undefined : fieldErrorLabels.publicUrl
  if (field === 'screenshotUrl') return optionalUrlError(value, '封面地址')
  if (field === 'repositoryUrl') return optionalUrlError(value, '代码仓库地址')
  if (field === 'logoUrl') return optionalUrlError(value, 'Logo 地址')
  if (field === 'galleryUrls') {
    if (value === undefined || value === null) return undefined
    if (!Array.isArray(value)) return '图集地址格式不正确。'
    return value.every((item) => validHttpUrl(item)) ? undefined : '图集中的每个地址都必须是无凭据的 HTTP 或 HTTPS URL。'
  }
  if (field === 'videoUrl') {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return undefined
    return validBilibiliUrl(value) ? undefined : '视频地址必须是 bilibili.com 或 b23.tv 的 HTTPS 链接。'
  }
  if (field === 'acknowledgements') return acknowledgementsError(value)
  return undefined
}

function requiredError(field: keyof SubmissionProjectFields, value: unknown) {
  if (field === 'submitterRelation') {
    return typeof value === 'string' && submitterRelations.has(value as SubmitterRelation)
      ? undefined
      : fieldErrorLabels[field]
  }
  return hasValue(value) ? undefined : fieldErrorLabels[field] ?? '请完成此字段。'
}

function validateField(draft: SubmissionDraft, field: keyof SubmissionProjectFields, required: boolean) {
  const value = draft.fields[field]
  if (required) {
    const missing = requiredError(field, value)
    if (missing) return missing
  } else if (field === 'submitterRelation' && hasValue(value) && !submitterRelations.has(value as SubmitterRelation)) {
    return '请选择有效的提交者关系。'
  }
  return formatError(field, value)
}

function requiredFieldsFor(draft: SubmissionDraft) {
  return draft.fields.categoryId === 'personal_site_portfolio' ? portfolioRequiredFields : learningRequiredFields
}

function fieldsForStep(draft: SubmissionDraft, step: SubmissionFormStep) {
  const required = draft.fields.categoryId === 'personal_site_portfolio' ? portfolioStepRequiredFields : stepRequiredFields
  const fields = new Set<keyof SubmissionProjectFields>(required[step])
  for (const field of Object.keys(fieldSteps)) {
    if (submissionFieldStep(field) === step) fields.add(field as keyof SubmissionProjectFields)
  }
  return fields
}

function addressBlockError(draft: SubmissionDraft) {
  if (draft.urlCheckPassed === false) return '公开地址检查未通过，请重新检查后再提交。'
  if (draft.validationErrors.publicUrl?.toLowerCase().includes('timeout') || draft.validationErrors.publicUrl?.includes('超时')) return '公开地址检查超时，请重试通过后再提交。'
  return undefined
}

export function validateSubmissionStep(draft: SubmissionDraft, step: SubmissionFormStep) {
  const required = new Set(requiredFieldsFor(draft))
  const errors: Record<string, string> = {}
  for (const field of fieldsForStep(draft, step)) {
    const error = validateField(draft, field, required.has(field))
    if (error) errors[field] = error
  }
  if (step === 'prefill') {
    const addressError = addressBlockError(draft)
    if (addressError) errors.publicUrl = addressError
    if (draft.duplicateProjectId) errors.duplicateProjectId = '社区中已有同一作品档案，不能创建新的发布记录。'
  }
  return errors
}

export function validateSubmission(draft: SubmissionDraft): Record<string, string> {
  const required = new Set(requiredFieldsFor(draft))
  const errors: Record<string, string> = {}
  for (const field of Object.keys(fieldSteps) as Array<keyof SubmissionProjectFields>) {
    const error = validateField(draft, field, required.has(field))
    if (error) errors[field] = error
  }
  const addressError = addressBlockError(draft)
  if (addressError) errors.publicUrl = addressError
  if (draft.duplicateProjectId) errors.duplicateProjectId = '社区中已有同一作品档案，不能创建新的发布记录。'
  return errors
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

  const extractedFields = { ...extraction.fields }
  if (
    (draft.urlCheckPassed === false || draft.fields.accessStatus === 'unknown' || draft.originalExtraction.accessStatus === 'unknown') &&
    extractedFields.accessStatus === 'normal'
  ) {
    delete extractedFields.accessStatus
  }
  const extractionErrors = Object.fromEntries(
    extraction.failedFields.map((field) => [field, '自动提取未完成，可手动填写或跳过非关键字段。']),
  )
  const preservesUrlFailure = draft.urlCheckPassed === false || Boolean(draft.validationErrors.publicUrl?.toLowerCase().includes('timeout')) || Boolean(draft.validationErrors.publicUrl?.includes('超时'))
  const preservedUrlError: Record<string, string> = preservesUrlFailure && draft.validationErrors.publicUrl
    ? { publicUrl: draft.validationErrors.publicUrl }
    : {}
  return {
    ...draft,
    fields: { ...extractedFields, ...draft.fields },
    originalExtraction: { ...draft.originalExtraction, ...extractedFields },
    validationErrors: { ...extractionErrors, ...preservedUrlError },
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
