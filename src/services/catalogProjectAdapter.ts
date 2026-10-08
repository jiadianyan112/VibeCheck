import type {
  ProjectCardProjection,
  ProjectProjection,
} from '@vibecheck/catalog'

import {
  accessStatuses,
  aiCodingTools,
  authorLinkStatuses,
  blogSupports,
  caseStudyDepths,
  colorCharacters,
  completenessLevels,
  coreModules,
  creatorRoles,
  contentProcessingTypes,
  feedbackMethods,
  interactionLevels,
  interactionPatterns,
  inputTypes,
  layoutPatterns,
  learningCategoryId,
  learningRecordTypes,
  loginRequirements,
  maintenanceSignals,
  navigationPatterns,
  outputTypes,
  pageModels,
  portfolioCategoryId,
  practiceFormats,
  projectCategoryIds,
  projectId,
  projectShowcaseFormats,
  recordSources,
  resumeDownloadStatuses,
  responsiveSupports,
  sharingCapabilities,
  siteTypes,
  targetUsers,
  themeModes,
  useScenarios,
  type AccessStatus,
  type AiCodingTool,
  type AuthorLinkStatus,
  type CompletenessLevel,
  type ContentProcessingType,
  type CreatorId,
  type FieldFact,
  type FeedbackMethod,
  type FlowNode,
  type InputType,
  type LearningRecordType,
  type LoginRequirement,
  type MaintenanceSignal,
  type OutputType,
  type PortfolioSchemaV1,
  type PracticeFormat,
  type Project,
  type ProjectCategoryId,
  type RecordSource,
  type ReviewStatus,
  type SharingCapability,
  type TargetUser,
  type UseScenario,
  lifecycleEventId as makeLifecycleEventId,
  versionId as makeVersionId,
} from '../types'
import { knownFact, unknownFact } from '../mocks/factories'
import { readPublicationDetails } from '../features/submission/publicationDetails'

/**
 * The catalog is a JSON boundary.  The published projection types describe
 * the valid response, while these input aliases also allow callers to pass a
 * partially decoded response and let the adapter retain unknown values.
 */
export type CatalogProjectCardJson = Partial<ProjectCardProjection>
export type CatalogProjectJson = Partial<ProjectProjection>

type JsonObject = Readonly<Record<string, unknown>>
type FactOptions = Parameters<typeof knownFact>[1]

const categoryGroups: Record<ProjectCategoryId, string> = {
  [learningCategoryId]: 'AI 学习与题库',
  [portfolioCategoryId]: '个人主页与作品集',
}

const unknownMessage = (field: string) => `目录未提供可验证的${field}信息。`

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function valueAt(source: unknown, key: string): unknown {
  return object(source)?.[key]
}

function firstDefined(...values: readonly unknown[]): unknown {
  return values.find((value) => value !== undefined)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function lastVerifiedAt(card: JsonObject): string | null {
  return text(firstDefined(
    valueAt(card, 'last_verified_at'),
    valueAt(valueAt(card, 'project_core'), 'last_verified_at'),
  ))
}

function factOptions(card: JsonObject, projectKey: string, field: string): FactOptions {
  return {
    evidenceKey: `catalog-${projectKey}-${field}`,
    lastVerifiedAt: lastVerifiedAt(card),
  }
}

function known<T>(value: T, card: JsonObject, projectKey: string, field: string): FieldFact<T> {
  return knownFact(value, factOptions(card, projectKey, field))
}

function unknown<T>(card: JsonObject, projectKey: string, field: string): FieldFact<T> {
  return unknownFact(unknownMessage(field), factOptions(card, projectKey, field))
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  return typeof value === 'string' && values.includes(value as T) ? value as T : null
}

function enumFact<T extends string>(
  value: unknown,
  values: readonly T[],
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<T> {
  const parsed = enumValue(value, values)
  return parsed === null ? unknown<T>(card, projectKey, field) : known(parsed, card, projectKey, field)
}

function enumArrayFact<T extends string>(
  value: unknown,
  values: readonly T[],
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<T[]> {
  if (!Array.isArray(value)) return unknown<T[]>(card, projectKey, field)
  const parsed = value
    .map((item) => enumValue(item, values))
    .filter((item): item is T => item !== null)
  return known(parsed, card, projectKey, field)
}

function stringArrayFact(
  value: unknown,
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<string[]> {
  return Array.isArray(value)
    ? known(strings(value), card, projectKey, field)
    : unknown<string[]>(card, projectKey, field)
}

function stringFact(
  value: unknown,
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<string> {
  const parsed = text(value)
  return parsed === null ? unknown<string>(card, projectKey, field) : known(parsed, card, projectKey, field)
}

function nullableStringFact(
  value: unknown,
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<string | null> {
  if (value === null) return known(null, card, projectKey, field)
  const parsed = text(value)
  return parsed === null ? unknown<string | null>(card, projectKey, field) : known(parsed, card, projectKey, field)
}

function knowledgeFact(
  value: unknown,
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<AiCodingTool[]> {
  const record = object(value)
  if (record?.knowledge_state === 'known_values' || record?.knowledge_state === 'known_empty') {
    if (record.knowledge_state === 'known_empty' && !Array.isArray(record.values)) {
      return known([], card, projectKey, field)
    }
    return enumArrayFact(record.values, aiCodingTools, card, projectKey, field)
  }
  return unknown<AiCodingTool[]>(card, projectKey, field)
}

function knowledgeStringArrayFact(
  value: unknown,
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<string[]> {
  const record = object(value)
  if (record?.knowledge_state === 'known_values' || record?.knowledge_state === 'known_empty') {
    if (record.knowledge_state === 'known_empty' && !Array.isArray(record.values)) {
      return known([], card, projectKey, field)
    }
    return stringArrayFact(record.values, card, projectKey, field)
  }
  return unknown<string[]>(card, projectKey, field)
}

function mapFlow(
  value: unknown,
  card: JsonObject,
  projectKey: string,
  field: string,
): FieldFact<FlowNode[]> {
  if (!Array.isArray(value)) return unknown<FlowNode[]>(card, projectKey, field)
  const flow = value.map((step, index): FlowNode | null => {
    const record = object(step)
    const label = text(record?.name) ?? text(record?.label)
    if (!label) return null
    return {
      id: `${projectKey}-${field}-${index + 1}`,
      order: number(record?.order, index + 1),
      label,
      description: text(record?.description) ?? label,
    }
  }).filter((step): step is FlowNode => step !== null)
  return known(flow, card, projectKey, field)
}

function mapCoverMedia(value: unknown, name: string): Project['coverMedia'] {
  return strings(value).map((id, index) => ({
    id,
    kind: 'placeholder' as const,
    url: null,
    alt: `${name || '作品'}封面${index + 1}`,
  }))
}

function creatorIds(value: unknown): CreatorId[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(valueAt(item, 'creator_id')))
    .filter((item): item is string => item !== null)
    .map((id) => id as CreatorId)
}

function mapDeveloper(value: unknown): Project['developer'] {
  const record = object(value)
  const displayName = text(record?.display_name)
  if (!record || !displayName) return null
  const verificationStatus = enumValue(record.verification_status, ['unverified', 'verified', 'disputed'] as const)
  return { kind: enumValue(record.kind, ['individual', 'team'] as const), displayName,
    avatarUrl: text(record.avatar_url), websiteUrl: text(record.website_url), creatorId: text(record.creator_id),
    verificationStatus: verificationStatus ?? 'unverified' }
}

function idArray(value: unknown): string[] {
  return strings(value)
}

function projectCategory(value: unknown): ProjectCategoryId {
  return enumValue(value, projectCategoryIds) ?? learningCategoryId
}

function recordSource(value: unknown): RecordSource {
  return enumValue(value, recordSources) ?? 'public_discovery'
}

function authorLinkStatus(value: unknown): AuthorLinkStatus {
  return enumValue(value, authorLinkStatuses) ?? 'unlinked'
}

function completenessLevel(value: unknown): CompletenessLevel {
  return enumValue(value, completenessLevels) ?? 'partial'
}

function freshnessStatus(value: unknown): 'valid' | 'expiring' | 'expired' {
  return enumValue(value, ['valid', 'expiring', 'expired'] as const) ?? 'expired'
}

function reviewStatus(value: unknown): ReviewStatus {
  return enumValue(value, [
    'draft', 'pending_review', 'changes_requested', 'approved', 'rejected', 'withdrawn',
    'published_platform', 'published_author', 'update_pending', 'restricted', 'archived', 'deleted',
  ] as const) ?? 'published_platform'
}

function accessStatus(value: unknown): AccessStatus {
  return enumValue(value, accessStatuses) ?? 'unknown'
}

function maintenanceSignal(value: unknown): MaintenanceSignal {
  return enumValue(value, maintenanceSignals) ?? 'unknown'
}

function versionIds(value: unknown) {
  const id = text(value)
  return id ? [makeVersionId(id)] : []
}

function eventIds(value: unknown): Project['eventIds'] {
  const id = text(valueAt(value, 'event_id'))
  return id ? [makeLifecycleEventId(id)] : []
}

function relationIds(value: unknown): Project['relationIds'] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(valueAt(item, 'relation_id')))
    .filter((id): id is string => id !== null)
    .map((id) => id as Project['relationIds'][number])
}

function unknownLearningFields(card: JsonObject, projectKey: string): Pick<
  Project,
  | 'targetUsers'
  | 'coreProblem'
  | 'useScenarios'
  | 'mainInputs'
  | 'mainOutputs'
  | 'coreFlow'
  | 'contentProcessing'
  | 'practiceFormats'
  | 'feedbackMethods'
  | 'learningRecords'
  | 'differentiation'
  | 'coreFeatures'
  | 'secondaryFeatures'
  | 'loginRequirement'
  | 'sharingCapability'
> {
  return {
    targetUsers: unknown<TargetUser[]>(card, projectKey, '目标用户'),
    coreProblem: unknown<string>(card, projectKey, '核心问题'),
    useScenarios: unknown<UseScenario[]>(card, projectKey, '使用场景'),
    mainInputs: unknown<InputType[]>(card, projectKey, '主要输入'),
    mainOutputs: unknown<OutputType[]>(card, projectKey, '主要输出'),
    coreFlow: unknown<FlowNode[]>(card, projectKey, '核心流程'),
    contentProcessing: unknown<ContentProcessingType[]>(card, projectKey, '内容处理'),
    practiceFormats: unknown<PracticeFormat[]>(card, projectKey, '练习形式'),
    feedbackMethods: unknown<FeedbackMethod[]>(card, projectKey, '反馈方式'),
    learningRecords: unknown<LearningRecordType[]>(card, projectKey, '学习记录'),
    differentiation: unknown<string>(card, projectKey, '差异化信息'),
    coreFeatures: unknown<string[]>(card, projectKey, '核心功能'),
    secondaryFeatures: unknown<string[]>(card, projectKey, '次要功能'),
    loginRequirement: unknown<LoginRequirement>(card, projectKey, '登录要求'),
    sharingCapability: unknown<SharingCapability>(card, projectKey, '分享能力'),
  }
}

function mapLearningFields(
  categoryData: JsonObject | null,
  card: JsonObject,
  projectKey: string,
): Pick<Project, keyof ReturnType<typeof unknownLearningFields>> {
  if (!categoryData) return unknownLearningFields(card, projectKey)
  return {
    targetUsers: enumArrayFact(valueAt(categoryData, 'target_users'), targetUsers, card, projectKey, '目标用户'),
    coreProblem: stringFact(valueAt(categoryData, 'core_problem'), card, projectKey, '核心问题'),
    useScenarios: enumArrayFact(valueAt(categoryData, 'use_scenarios'), useScenarios, card, projectKey, '使用场景'),
    mainInputs: enumArrayFact(valueAt(categoryData, 'main_inputs'), inputTypes, card, projectKey, '主要输入'),
    mainOutputs: enumArrayFact(valueAt(categoryData, 'main_outputs'), outputTypes, card, projectKey, '主要输出'),
    coreFlow: mapFlow(valueAt(categoryData, 'core_flow'), card, projectKey, '核心流程'),
    contentProcessing: enumArrayFact(valueAt(categoryData, 'content_processing'), contentProcessingTypes, card, projectKey, '内容处理'),
    practiceFormats: enumArrayFact(valueAt(categoryData, 'practice_formats'), practiceFormats, card, projectKey, '练习形式'),
    feedbackMethods: enumArrayFact(valueAt(categoryData, 'feedback_methods'), feedbackMethods, card, projectKey, '反馈方式'),
    learningRecords: enumArrayFact(valueAt(categoryData, 'learning_records'), learningRecordTypes, card, projectKey, '学习记录'),
    differentiation: stringFact(valueAt(categoryData, 'differentiation'), card, projectKey, '差异化信息'),
    coreFeatures: stringArrayFact(valueAt(categoryData, 'core_features'), card, projectKey, '核心功能'),
    secondaryFeatures: stringArrayFact(valueAt(categoryData, 'secondary_features'), card, projectKey, '次要功能'),
    loginRequirement: enumFact(valueAt(categoryData, 'login_requirement'), loginRequirements, card, projectKey, '登录要求'),
    sharingCapability: enumFact(valueAt(categoryData, 'sharing_capability'), sharingCapabilities, card, projectKey, '分享能力'),
  }
}

function mapPortfolioSchema(
  categoryData: JsonObject | null,
  card: JsonObject,
  projectKey: string,
): PortfolioSchemaV1 | null {
  if (!categoryData) return null
  return {
    siteType: enumFact(valueAt(categoryData, 'site_type'), siteTypes, card, projectKey, '网站类型'),
    creatorRoles: enumArrayFact(valueAt(categoryData, 'creator_roles'), creatorRoles, card, projectKey, '创作者角色'),
    primaryGoals: enumArrayFact(valueAt(categoryData, 'primary_goals'), [
      'showcase_projects', 'professional_presence', 'job_search', 'client_acquisition',
      'personal_brand', 'academic_profile', 'content_hub', 'other',
    ] as const, card, projectKey, '主要目标'),
    pageModel: enumFact(valueAt(categoryData, 'page_model'), pageModels, card, projectKey, '页面结构'),
    navigationPattern: enumFact(valueAt(categoryData, 'navigation_pattern'), navigationPatterns, card, projectKey, '导航方式'),
    homepageSequence: enumArrayFact(valueAt(categoryData, 'homepage_sequence'), coreModules, card, projectKey, '首页顺序'),
    coreModules: enumArrayFact(valueAt(categoryData, 'core_modules'), coreModules, card, projectKey, '核心模块'),
    projectShowcaseFormat: enumFact(valueAt(categoryData, 'project_showcase_format'), projectShowcaseFormats, card, projectKey, '作品展示形式'),
    caseStudyDepth: enumFact(valueAt(categoryData, 'case_study_depth'), caseStudyDepths, card, projectKey, '案例深度'),
    visualStyles: enumArrayFact(valueAt(categoryData, 'visual_styles'), [
      'minimal', 'editorial', 'brutalist', 'playful', 'retro', 'corporate', 'experimental',
      'illustrative', 'photographic', 'typographic', 'other',
    ] as const, card, projectKey, '视觉风格'),
    layoutPatterns: enumArrayFact(valueAt(categoryData, 'layout_patterns'), layoutPatterns, card, projectKey, '布局模式'),
    colorCharacter: enumFact(valueAt(categoryData, 'color_character'), colorCharacters, card, projectKey, '色彩特征'),
    themeMode: enumFact(valueAt(categoryData, 'theme_mode'), themeModes, card, projectKey, '主题模式'),
    interactionLevel: enumFact(valueAt(categoryData, 'interaction_level'), interactionLevels, card, projectKey, '交互等级'),
    interactionPatterns: enumArrayFact(valueAt(categoryData, 'interaction_patterns'), interactionPatterns, card, projectKey, '交互方式'),
    responsiveSupport: enumFact(valueAt(categoryData, 'responsive_support'), responsiveSupports, card, projectKey, '响应式支持'),
    blogSupport: enumFact(valueAt(categoryData, 'blog_support'), blogSupports, card, projectKey, '博客能力'),
    cmsSupport: enumFact(valueAt(categoryData, 'cms_support'), ['none', 'headless', 'built_in'] as const, card, projectKey, '内容管理方式'),
    cmsPlatform: nullableStringFact(valueAt(categoryData, 'cms_platform'), card, projectKey, '内容管理平台'),
    multilingualSupport: enumFact(valueAt(categoryData, 'multilingual_support'), ['none', 'manual', 'automatic'] as const, card, projectKey, '多语言支持'),
    resumeDownload: enumFact(valueAt(categoryData, 'resume_download'), resumeDownloadStatuses, card, projectKey, '简历下载'),
    aiFeatures: stringArrayFact(valueAt(categoryData, 'ai_features'), card, projectKey, 'AI 功能'),
  }
}

function categoryData(card: JsonObject): JsonObject | null {
  return object(valueAt(card, 'category_data'))
}

function toProject(input: unknown): Project {
  const card = object(input) ?? {}
  const core = object(valueAt(card, 'project_core')) ?? {}
  const key = text(valueAt(card, 'project_id')) ?? 'unknown-project'
  const categoryId = projectCategory(valueAt(card, 'category_id'))
  const categorySchemaVersion: Project['categorySchemaVersion'] = categoryId === portfolioCategoryId ? 'portfolio.v1' : 'learning.v1'
  const name = text(firstDefined(valueAt(card, 'current_name'), valueAt(core, 'current_name')))
  const definition = text(firstDefined(valueAt(card, 'one_line_definition'), valueAt(core, 'one_line_definition')))
  const verifiedAt = lastVerifiedAt(card)
  const publicUrl = firstDefined(valueAt(core, 'public_url'), valueAt(card, 'public_url'))
  const repositoryUrl = firstDefined(valueAt(core, 'repository_url'), valueAt(card, 'repository_url'))
  const originalPlatform = firstDefined(valueAt(core, 'original_platform'), valueAt(card, 'original_platform'))
  const category = categoryData(card)
  const projectName = name ?? '未命名作品'
  const learning = mapLearningFields(categoryId === learningCategoryId ? category : null, card, key)
  const portfolio = categoryId === portfolioCategoryId ? mapPortfolioSchema(category, card, key) : null
  const coreKnowledgeTools = firstDefined(valueAt(core, 'ai_coding_tools'), valueAt(card, 'ai_coding_tools'))
  const coreTechStack = firstDefined(valueAt(core, 'tech_stack'), valueAt(card, 'tech_stack'))
  const creatorSummaries = valueAt(card, 'creator_summaries')
  const coreEvent = valueAt(card, 'latest_event_summary')
  const recordSourceValue = firstDefined(valueAt(card, 'record_source'), valueAt(core, 'record_source'))
  const reviewStatusValue = valueAt(card, 'review_status')
  const projectCore = {
    developer: mapDeveloper(valueAt(card, 'developer')),
    publicationDetails: readPublicationDetails(valueAt(core, 'publication_details')),
    id: projectId(key),
    currentName: name === null ? unknown<string>(card, key, '作品名称') : known(name, card, key, '作品名称'),
    historicalNames: [],
    publicUrl: stringFact(publicUrl, card, key, '公开地址'),
    historicalUrls: [],
    repositoryUrl: nullableStringFact(repositoryUrl, card, key, '代码仓库'),
    originalPlatform: nullableStringFact(originalPlatform, card, key, '原始平台'),
    firstSeenAt: text(valueAt(card, 'first_seen_at')) ?? verifiedAt ?? '',
    createdAt: text(valueAt(card, 'created_at')) ?? text(valueAt(card, 'first_seen_at')) ?? verifiedAt ?? '',
    coverMedia: mapCoverMedia(
      firstDefined(valueAt(card, 'cover_media_reference_ids'), valueAt(core, 'cover_media_reference_ids')),
      projectName,
    ),
    categoryId,
    categorySchemaVersion,
    categoryData: portfolio,
    categoryGroup: categoryGroups[categoryId],
    summary: definition === null ? unknown<string>(card, key, '一句话定义') : known(definition, card, key, '一句话定义'),
    aiCodingTools: knowledgeFact(coreKnowledgeTools, card, key, 'AI 编程工具'),
    modelsUsed: unknown<string[]>(card, key, '模型'),
    techStack: object(coreTechStack) ? knowledgeStringArrayFact(coreTechStack, card, key, '技术栈') : stringArrayFact(coreTechStack, card, key, '技术栈'),
    deploymentPlatform: nullableStringFact(valueAt(core, 'deployment_platform'), card, key, '部署平台'),
    developmentCycle: unknown<string | null>(card, key, '开发周期'),
    keyDependencies: unknown<string[]>(card, key, '关键依赖'),
    accessStatus: known(
      accessStatus(firstDefined(valueAt(card, 'access_status'), valueAt(core, 'access_status'))),
      card,
      key,
      '访问状态',
    ),
    httpCheckStatus: 'unknown' as const,
    lastVerifiedAt: verifiedAt ?? '',
    maintenanceSignal: maintenanceSignal(valueAt(core, 'maintenance_signal')),
    statusNote: nullableStringFact(valueAt(core, 'status_note'), card, key, '状态说明'),
    versionIds: versionIds(valueAt(card, 'version_id')),
    eventIds: eventIds(coreEvent),
    assetIds: idArray(valueAt(card, 'asset_ids')) as Project['assetIds'],
    relationIds: relationIds(valueAt(card, 'relations')),
    creatorIds: creatorIds(creatorSummaries),
    recordSource: recordSource(recordSourceValue),
    authorLinkStatus: authorLinkStatus(firstDefined(valueAt(card, 'author_link_status'), valueAt(core, 'author_link_status'))),
    completenessLevel: completenessLevel(firstDefined(valueAt(card, 'completeness_level'), valueAt(core, 'completeness_level'))),
    freshnessStatus: freshnessStatus(firstDefined(valueAt(card, 'freshness_status'), valueAt(core, 'freshness_status'))),
    interactionSummary: {
      favoriteCount: number(valueAt(valueAt(card, 'interaction_summary'), 'favorite_count')),
      likeCount: number(valueAt(valueAt(card, 'interaction_summary'), 'like_count')),
      commentCount: number(valueAt(valueAt(card, 'interaction_summary'), 'visible_comment_count')),
      followerCount: number(valueAt(valueAt(card, 'interaction_summary'), 'follower_count')),
    },
    reviewStatus: reviewStatus(reviewStatusValue),
  }

  return {
    ...projectCore,
    oneLineDefinition: projectCore.summary,
    ...learning,
    ...(categoryId === portfolioCategoryId ? unknownLearningFields(card, key) : {}),
  }
}

/** Maps a catalog list-card response into the frontend project model. */
export function mapCatalogCard(input: CatalogProjectCardJson): Project {
  return toProject(input)
}

/** Maps a catalog detail response into the frontend project model. */
export function mapCatalogProject(input: CatalogProjectJson): Project {
  return toProject(input)
}
