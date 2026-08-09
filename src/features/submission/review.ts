import {
  lifecycleEventId,
  projectId,
  type FieldFact,
  type LifecycleEvent,
  type Project,
  type ReviewStatus,
  type SubmissionDraft,
  type SubmissionProjectFields,
} from '../../types'

export type SubmissionReviewScenario =
  | 'default'
  | 'review_changes_requested'
  | 'review_approved'
  | 'review_rejected'

export const submissionReviewStatusLabels: Partial<Record<ReviewStatus, string>> = {
  draft: '草稿',
  pending_review: '待审核',
  changes_requested: '需修改',
  approved: '已通过',
  rejected: '已拒绝',
  restricted: '争议复核中',
  withdrawn: '已撤回',
}

export const reviewFieldSteps: Partial<Record<keyof SubmissionProjectFields, string>> = {
  currentName: 'prefill',
  publicUrl: 'prefill',
  screenshotUrl: 'prefill',
  accessStatus: 'prefill',
  repositoryUrl: 'prefill',
  oneLineDefinition: 'prefill',
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
}

const reviewMessagesByStatus: Partial<Record<ReviewStatus, Record<string, string>>> = {
  changes_requested: {
    oneLineDefinition: '请补充作品如何帮助目标用户，避免只写功能名称。',
    repositoryUrl: '如有公开仓库，请补充可访问地址；没有可保留为空。',
  },
  rejected: {
    submission: '公开页面内容与首期学习、题库产品范围不符，当前版本无法收录。',
  },
}

function stableSuffix(draft: SubmissionDraft) {
  return String(draft.id).replace(/^draft-/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
}

export function applySubmissionReview(
  draft: SubmissionDraft,
  status: Extract<ReviewStatus, 'pending_review' | 'changes_requested' | 'approved' | 'rejected'>,
  now = '2026-07-31T10:30:00+08:00',
): SubmissionDraft {
  const suffix = stableSuffix(draft)
  const approved = status === 'approved'
  const isRevision = draft.status === 'changes_requested'
  return {
    ...draft,
    status,
    step: 'preview',
    submittedFields: isRevision ? structuredClone(draft.fields) : (draft.submittedFields ?? structuredClone(draft.fields)),
    submittedAssetIds: isRevision ? [...draft.assetIds] : (draft.submittedFields ? draft.submittedAssetIds : [...draft.assetIds]),
    reviewMessages: reviewMessagesByStatus[status] ?? {},
    publishedProjectId: approved ? (draft.publishedProjectId ?? projectId(`project-submission-${suffix}`)) : draft.publishedProjectId,
    publishedEventId: approved ? (draft.publishedEventId ?? lifecycleEventId(`event-submission-${suffix}-first-published`)) : draft.publishedEventId,
    submittedAt: draft.submittedAt ?? now,
    withdrawnAt: null,
    updatedAt: now,
  }
}

export function withdrawSubmission(draft: SubmissionDraft, now = '2026-07-31T10:40:00+08:00'): SubmissionDraft {
  return { ...draft, status: 'withdrawn', withdrawnAt: now, updatedAt: now }
}

export function resumeSubmission(draft: SubmissionDraft, now = '2026-07-31T10:45:00+08:00'): SubmissionDraft {
  return {
    ...draft,
    status: 'draft',
    step: 'preview',
    reviewMessages: {},
    submittedFields: null,
    submittedAssetIds: [],
    submittedAt: null,
    withdrawnAt: null,
    updatedAt: now,
  }
}

function known<T>(value: T, at: string): FieldFact<T> {
  return { state: 'known', value, evidenceIds: [], freshness: 'valid', lastVerifiedAt: at, disputeStatus: 'none', confidence: null }
}

function unknown<T>(reason: string, at: string): FieldFact<T> {
  return { state: 'unknown', reason, evidenceIds: [], freshness: 'valid', lastVerifiedAt: at, disputeStatus: 'none', confidence: null }
}

function submittedFact<T>(value: T | undefined, label: string, at: string): FieldFact<T> {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return unknown(`${label}尚未由公开页面或作者确认，可在发布后补充。`, at)
  return known(value, at)
}

export function publishedProjectFromSubmission(draft: SubmissionDraft): Project | null {
  if (draft.status !== 'approved' || !draft.publishedProjectId || !draft.publishedEventId || !draft.submittedFields || !draft.submittedAt) return null
  const fields = draft.submittedFields
  const at = draft.submittedAt
  const screenshot = fields.screenshotUrl
  const isPortfolio = fields.categoryId === 'personal_site_portfolio'
  const legacyReason = '该字段属于 AI 学习与题库 Schema，不适用于个人主页与作品集。'
  return {
    id: draft.publishedProjectId,
    currentName: known(fields.currentName ?? '名称待补充', at),
    historicalNames: [],
    publicUrl: known(fields.publicUrl ?? '', at),
    historicalUrls: [],
    repositoryUrl: known(fields.repositoryUrl ?? null, at),
    originalPlatform: unknown('提交版本未说明原始发布平台', at),
    firstSeenAt: at,
    createdAt: at,
    coverMedia: [{ id: `${draft.publishedProjectId}-cover`, kind: screenshot ? 'image' : 'placeholder', url: screenshot ?? null, alt: `${fields.currentName ?? '已发布作品'}封面` }],
    categoryId: isPortfolio ? 'personal_site_portfolio' : 'ai_learning_quiz',
    categorySchemaVersion: isPortfolio ? 'portfolio.v1' : 'learning.v1',
    categoryGroup: isPortfolio ? '用户发布' : 'AI 学习与题库',
    summary: known(fields.oneLineDefinition ?? '', at),
    categoryData: isPortfolio ? {
      siteType: submittedFact(fields.siteType, '网站类型', at),
      creatorRoles: submittedFact(fields.creatorRoles, '作者身份', at),
      primaryGoals: submittedFact(fields.primaryGoals, '建站目的', at),
      pageModel: submittedFact(fields.pageModel, '页面结构', at),
      navigationPattern: submittedFact(fields.navigationPattern, '导航方式', at),
      homepageSequence: submittedFact(fields.coreModules, '首页顺序', at),
      coreModules: submittedFact(fields.coreModules, '核心模块', at),
      projectShowcaseFormat: submittedFact(fields.projectShowcaseFormat, '项目展示形式', at),
      caseStudyDepth: submittedFact(fields.caseStudyDepth, 'Case Study 深度', at),
      visualStyles: submittedFact(fields.visualStyles, '视觉风格', at),
      layoutPatterns: submittedFact(fields.layoutPatterns, '布局方式', at),
      colorCharacter: submittedFact(fields.colorCharacter, '色彩特征', at),
      themeMode: submittedFact(fields.themeMode, '主题模式', at),
      interactionLevel: submittedFact(fields.interactionLevel, '交互等级', at),
      interactionPatterns: submittedFact(fields.interactionPatterns, '动画方式', at),
      responsiveSupport: submittedFact(fields.responsiveSupport, '响应式状态', at),
      blogSupport: submittedFact(fields.blogSupport, '博客能力', at),
    } : null,
    oneLineDefinition: known(fields.oneLineDefinition ?? '', at),
    targetUsers: isPortfolio ? unknown(legacyReason, at) : known(fields.targetUsers ?? [], at),
    coreProblem: isPortfolio ? unknown(legacyReason, at) : known(fields.coreProblem ?? '', at),
    useScenarios: isPortfolio ? unknown(legacyReason, at) : known(fields.useScenarios ?? [], at),
    mainInputs: isPortfolio ? unknown(legacyReason, at) : known(fields.mainInputs ?? [], at),
    mainOutputs: isPortfolio ? unknown(legacyReason, at) : known(fields.mainOutputs ?? [], at),
    coreFlow: isPortfolio ? unknown(legacyReason, at) : known(fields.coreFlow ?? [], at),
    contentProcessing: unknown('提交版本未提供内容处理方式', at),
    practiceFormats: known(fields.practiceFormats ?? [], at),
    feedbackMethods: known(fields.feedbackMethods ?? [], at),
    learningRecords: unknown('提交版本未提供学习记录能力', at),
    differentiation: fields.differentiation ? known(fields.differentiation, at) : unknown('提交版本未提供差异化说明', at),
    coreFeatures: unknown('提交版本未单独列出核心功能', at),
    secondaryFeatures: unknown('提交版本未提供次要功能', at),
    loginRequirement: unknown('提交版本未说明登录要求', at),
    sharingCapability: unknown('提交版本未说明分享能力', at),
    aiCodingTools: known(fields.aiCodingTools ?? [], at),
    modelsUsed: unknown('提交版本未说明模型', at),
    techStack: unknown('提交版本未说明技术栈', at),
    deploymentPlatform: unknown('提交版本未说明部署平台', at),
    developmentCycle: unknown('提交版本未说明开发周期', at),
    keyDependencies: unknown('提交版本未说明关键依赖', at),
    accessStatus: known(fields.accessStatus ?? 'unknown', at),
    httpCheckStatus: fields.accessStatus === 'normal' || fields.accessStatus === 'login_required' ? 'normal' : 'unknown',
    lastVerifiedAt: at,
    maintenanceSignal: 'unknown',
    statusNote: known(null, at),
    versionIds: [],
    eventIds: [draft.publishedEventId],
    assetIds: draft.submittedAssetIds,
    relationIds: [],
    creatorIds: [],
    recordSource: 'user_submission',
    authorLinkStatus: 'unlinked',
    completenessLevel: 'complete',
    freshnessStatus: 'valid',
    interactionSummary: { favoriteCount: 0, likeCount: 0, commentCount: 0, followerCount: 0 },
    reviewStatus: 'approved',
  }
}

export function publishedEventFromSubmission(draft: SubmissionDraft): LifecycleEvent | null {
  const project = publishedProjectFromSubmission(draft)
  if (!project || !draft.publishedEventId || !draft.submittedAt) return null
  const name = project.currentName.state === 'known' ? project.currentName.value : '新作品'
  return {
    id: draft.publishedEventId,
    projectId: project.id,
    type: 'first_published',
    happenedAt: draft.submittedAt,
    isEstimatedDate: false,
    summary: `${name}通过审核并首次发布。`,
    sourceType: 'platform_verified_fact',
    evidenceIds: [],
    changes: [],
    disputeStatus: 'none',
  }
}
