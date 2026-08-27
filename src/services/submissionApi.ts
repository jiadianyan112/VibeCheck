import {
  createSubmissionDraftClient,
  createSubmissionUrlCheckClient,
  SubmissionDraftClientError,
  SubmissionUrlCheckClientError,
  type SubmissionDraft as ContractSubmissionDraft,
  type SubmissionDraftFieldErrorValue,
  type Submission as ContractSubmission,
  type SubmissionPreview as ContractSubmissionPreview,
  type SubmissionUrlCheck as ContractUrlCheck,
  type SubmissionUrlCheckFieldErrorValue,
} from '@vibecheck/contracts'
import type { AuthSessionDto } from './authService'
import type { LearningV1Snapshot } from '../features/submission/form'
import {
  projectId,
  submissionDraftId,
  type CategorySchemaVersion,
  type ProjectCategoryId,
  type SubmissionDraft,
  type SubmissionProjectFields,
  type UserId,
} from '../types'

export type SubmissionApiSession = Pick<AuthSessionDto, 'csrf_token'>

export interface SubmissionApiRequestOptions {
  readonly session: SubmissionApiSession | null
  readonly signal?: AbortSignal
  readonly clientRequestId?: string
  readonly operationId?: string
}

export interface UrlCheckItem {
  readonly key: 'format' | 'safety' | 'access' | 'duplicate' | 'category'
  readonly status: 'passed' | 'warning' | 'failed'
  readonly message: string
}

export interface UrlCheckDuplicateCandidate {
  readonly projectId: ReturnType<typeof projectId>
  readonly currentName: string
  readonly categoryId: ProjectCategoryId
}

export interface UrlCheckResult {
  readonly normalizedUrl: string
  readonly checks: readonly UrlCheckItem[]
  readonly duplicateProjectId: ReturnType<typeof projectId> | null
  readonly duplicateCandidate?: UrlCheckDuplicateCandidate
  readonly canCreateDraft: boolean
  readonly checkId?: string
  readonly categoryId?: ProjectCategoryId
  readonly categorySchemaVersion?: CategorySchemaVersion
  readonly expiresAt?: string
}

/** The server DTO plus the non-authoritative field projection used by P11. */
export type RemoteSubmissionDraft = ContractSubmissionDraft & {
  readonly fields: Partial<SubmissionProjectFields>
  readonly originalExtraction: Partial<SubmissionProjectFields>
}

/** Preview projection plus stable UI names for the frozen server snapshot. */
export type RemoteSubmissionPreview = ContractSubmissionPreview & {
  readonly previewHash: ContractSubmissionPreview['preview_hash']
  readonly frozenSnapshot: ContractSubmissionPreview['payload_snapshot']
  readonly referenceSummary: Readonly<{
    readonly mediaReferenceIds: ContractSubmissionPreview['media_reference_ids']
    readonly evidenceDraftIds: ContractSubmissionPreview['evidence_draft_ids']
  }>
}

/** Submitted projection plus the server-issued review identifiers. */
export type RemoteSubmission = ContractSubmission & {
  readonly submissionId: ContractSubmission['submission_id']
  readonly reviewWorkItemId: ContractSubmission['review_work_item_id']
}

export type SubmissionApiErrorKind = 'aborted' | 'transport' | 'protocol' | 'http'

export interface SubmissionApiErrorOptions {
  readonly kind: SubmissionApiErrorKind
  readonly code: string
  readonly message: string
  readonly status: number | null
  readonly requestId: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly fieldErrors?: readonly (SubmissionDraftFieldErrorValue | SubmissionUrlCheckFieldErrorValue)[]
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

/** Stable error envelope for all four production submission operations. */
export class SubmissionApiError extends Error {
  readonly name = 'SubmissionApiError'
  readonly kind: SubmissionApiErrorKind
  readonly status: number | null
  readonly code: string
  readonly requestId: string | null
  readonly request_id: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly retry_after_ms: number | null
  readonly fieldErrors: readonly (SubmissionDraftFieldErrorValue | SubmissionUrlCheckFieldErrorValue)[]
  readonly field_errors: readonly (SubmissionDraftFieldErrorValue | SubmissionUrlCheckFieldErrorValue)[]
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(options: SubmissionApiErrorOptions) {
    super(options.message, { cause: options.cause })
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
    this.request_id = options.requestId
    this.retryable = options.retryable
    this.retryAfterMs = options.retryAfterMs
    this.retry_after_ms = options.retryAfterMs
    this.fieldErrors = options.fieldErrors ?? []
    this.field_errors = this.fieldErrors
    this.details = options.details
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

const editableFieldNames: Partial<Record<keyof SubmissionProjectFields, string>> = {
  currentName: 'current_name',
  screenshotUrl: 'screenshot_url',
  accessStatus: 'access_status',
  repositoryUrl: 'repository_url',
  oneLineDefinition: 'one_line_definition',
  targetUsers: 'target_users',
  coreProblem: 'core_problem',
  useScenarios: 'use_scenarios',
  mainInputs: 'main_inputs',
  mainOutputs: 'main_outputs',
  coreFlow: 'core_flow',
  practiceFormats: 'practice_formats',
  feedbackMethods: 'feedback_methods',
  differentiation: 'differentiation',
  loginRequirement: 'login_requirement',
  sharingCapability: 'sharing_capability',
  aiCodingTools: 'ai_coding_tools',
  siteType: 'site_type',
  creatorRoles: 'creator_roles',
  primaryGoals: 'primary_goals',
  pageModel: 'page_model',
  navigationPattern: 'navigation_pattern',
  coreModules: 'core_modules',
  projectShowcaseFormat: 'project_showcase_format',
  caseStudyDepth: 'case_study_depth',
  visualStyles: 'visual_styles',
  layoutPatterns: 'layout_patterns',
  colorCharacter: 'color_character',
  themeMode: 'theme_mode',
  interactionLevel: 'interaction_level',
  interactionPatterns: 'interaction_patterns',
  responsiveSupport: 'responsive_support',
  blogSupport: 'blog_support',
}

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function makeSubmissionClientRequestId(): string {
  return requestId()
}

export function normalizeSubmissionUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const parsed = new URL(withProtocol)
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
    throw new TypeError('Unsupported public URL')
  }
  return parsed.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageFor(status: number | null, code: string, kind: SubmissionApiErrorKind): string {
  if (kind === 'aborted') return '检查已取消，当前内容已保留。'
  if (status === 401 || status === 403) return '登录状态已失效，当前输入已保留，请重新登录后继续。'
  if (status === 409) return '服务端版本发生冲突，未覆盖你的输入。请加载最新版本后合并。'
  if (status === 410) return '远端草稿已过期，请重新检查公开地址。'
  if (status === 422) return '服务端校验未通过，请检查标记的字段。'
  if (kind === 'transport') return '网络连接不可用，当前内容已保留。'
  if (kind === 'protocol') return '服务端返回无法识别的结果，当前内容已保留。'
  if (code === 'URL_CHECK_REJECTED') return '当前地址未通过服务端检查。'
  return '请求未完成，当前内容已保留。'
}

function isAbortCause(error: unknown): boolean {
  const cause = isRecord(error) ? error.cause : undefined
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function mapError(error: unknown, signal?: AbortSignal): SubmissionApiError {
  const aborted = signal?.aborted === true || isAbortCause(error)
  if (error instanceof SubmissionUrlCheckClientError || error instanceof SubmissionDraftClientError) {
    const kind: SubmissionApiErrorKind = aborted
      ? 'aborted'
      : error.kind === 'transport' ? 'transport' : error.kind === 'protocol' ? 'protocol' : 'http'
    const status = kind === 'aborted' ? null : error.status
    return new SubmissionApiError({
      kind,
      code: kind === 'aborted' ? 'REQUEST_ABORTED' : error.code,
      message: messageFor(status, error.code, kind),
      status,
      requestId: error.requestId,
      retryable: kind === 'aborted' ? false : error.retryable,
      retryAfterMs: kind === 'aborted' ? null : error.retryAfterMs,
      fieldErrors: error.fieldErrors,
      details: error.details,
      cause: error,
    })
  }

  const kind: SubmissionApiErrorKind = aborted ? 'aborted' : 'transport'
  return new SubmissionApiError({
    kind,
    code: aborted ? 'REQUEST_ABORTED' : 'CLIENT_REQUEST_FAILED',
    message: messageFor(null, 'CLIENT_REQUEST_FAILED', kind),
    status: null,
    requestId: null,
    retryable: !aborted,
    retryAfterMs: null,
    cause: error,
  })
}

function clients(session: SubmissionApiSession | null, requestIdGenerator = makeSubmissionClientRequestId) {
  const getCsrfToken = () => session?.csrf_token ?? ''
  return {
    url: createSubmissionUrlCheckClient({ baseUrl: apiBase, getCsrfToken, requestIdGenerator }),
    draft: createSubmissionDraftClient({ baseUrl: apiBase, getCsrfToken, requestIdGenerator }),
  }
}

function checkMessage(key: UrlCheckItem['key'], status: UrlCheckItem['status'], source: ContractUrlCheck): string {
  if (key === 'format') return 'URL 格式有效。'
  if (key === 'safety') {
    if (source.risk_result === 'blocked') return source.risk_reasons[0] ?? '检测到外链风险，已阻止继续。'
    if (source.risk_result === 'uncertain') return '安全风险暂无法确认，可先保存草稿。'
    return '未发现明显安全风险。'
  }
  if (key === 'access') {
    if (source.access_result === 'unavailable') return '公开页面当前无法访问。'
    if (source.access_result === 'uncertain' || source.access_result === 'not_checked') return '暂时无法验证访问状态。'
    return '公开页面可以访问。'
  }
  if (key === 'category') {
    if (source.category_result === 'mismatched') return '暂不属于社区当前的收录范围。'
    if (source.category_result === 'unconfirmed') return '品类暂未确认，可先保存草稿。'
    return '品类匹配。'
  }
  if (source.duplicate_result === 'exact') return '发现已有作品档案。'
  if (source.duplicate_result === 'candidate') return '发现可能重复的作品档案。'
  return status === 'passed' ? '未发现重复档案。' : '查重结果暂未确认。'
}

function mapStatus(value: boolean | 'allowed' | 'blocked' | 'uncertain' | 'accessible' | 'unavailable' | 'not_checked' | 'matched' | 'mismatched' | 'unconfirmed' | 'none' | 'exact' | 'candidate'): UrlCheckItem['status'] {
  if (value === true || value === 'allowed' || value === 'accessible' || value === 'matched' || value === 'none') return 'passed'
  if (value === 'blocked' || value === 'unavailable' || value === 'mismatched') return 'failed'
  return 'warning'
}

function mapUrlCheck(source: ContractUrlCheck, rawUrl: string): UrlCheckResult {
  const normalizedUrl = source.canonical_url ?? normalizeSubmissionUrl(rawUrl)
  const duplicate = source.duplicate_candidates[0]
  const checks: UrlCheckItem[] = [
    { key: 'format', status: 'passed', message: checkMessage('format', 'passed', source) },
    { key: 'safety', status: mapStatus(source.risk_result), message: checkMessage('safety', mapStatus(source.risk_result), source) },
    { key: 'access', status: mapStatus(source.access_result), message: checkMessage('access', mapStatus(source.access_result), source) },
    { key: 'duplicate', status: mapStatus(source.duplicate_result), message: checkMessage('duplicate', mapStatus(source.duplicate_result), source) },
    { key: 'category', status: mapStatus(source.category_result), message: checkMessage('category', mapStatus(source.category_result), source) },
  ]
  return {
    normalizedUrl,
    checks,
    duplicateProjectId: duplicate ? projectId(duplicate.project_id) : null,
    ...(duplicate ? { duplicateCandidate: { projectId: projectId(duplicate.project_id), currentName: duplicate.current_name, categoryId: duplicate.category_id } } : {}),
    canCreateDraft: source.can_create_draft,
    checkId: source.check_id,
    categoryId: source.category_id,
    categorySchemaVersion: source.category_schema_version,
    expiresAt: source.expires_at,
  }
}

function setIfDefined(target: Partial<SubmissionProjectFields>, field: keyof SubmissionProjectFields, value: unknown) {
  if (value !== undefined) target[field] = value as never
}

const snakeFields: Record<string, keyof SubmissionProjectFields> = Object.fromEntries(
  Object.entries(editableFieldNames).map(([key, value]) => [value, key]),
) as Record<string, keyof SubmissionProjectFields>

function readFlow(value: unknown): SubmissionProjectFields['coreFlow'] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const name = typeof item.name === 'string' ? item.name : typeof item.label === 'string' ? item.label : null
    if (!name) return []
    const order = typeof item.order === 'number' ? item.order : index + 1
    return [{ id: `remote-flow-${order}`, order, label: name, description: typeof item.description === 'string' ? item.description : '' }]
  })
}

function readAiCodingTools(value: unknown): SubmissionProjectFields['aiCodingTools'] | undefined {
  if (!isRecord(value) || !Array.isArray(value.values)) return undefined
  const values = value.values.filter((item): item is string => typeof item === 'string')
  if (value.knowledge_state === 'unknown') return ['unknown']
  return values as SubmissionProjectFields['aiCodingTools']
}

function payloadFields(payload: Readonly<Record<string, unknown>>): Partial<SubmissionProjectFields> {
  const fields: Partial<SubmissionProjectFields> = {}
  const projectCore = isRecord(payload.project_core) ? payload.project_core : {}
  const categoryData = isRecord(projectCore.category_data) ? projectCore.category_data : isRecord(payload.category_data) ? payload.category_data : {}
  const sources = [projectCore, categoryData, payload]
  for (const source of sources) {
    for (const [wireName, field] of Object.entries(snakeFields)) {
      if (wireName === 'core_flow') {
        const flow = readFlow(source[wireName])
        if (flow !== undefined) setIfDefined(fields, field, flow)
      } else if (wireName === 'ai_coding_tools') {
        const tools = readAiCodingTools(source[wireName])
        if (tools !== undefined) setIfDefined(fields, field, tools)
      } else if (source[wireName] !== undefined) {
        setIfDefined(fields, field, source[wireName])
      }
    }
    if (typeof source.name === 'string') setIfDefined(fields, 'currentName', source.name)
    if (typeof source.current_name === 'string') setIfDefined(fields, 'currentName', source.current_name)
  }
  if (typeof projectCore.public_url === 'string') setIfDefined(fields, 'publicUrl', projectCore.public_url)
  return fields
}

function extractionFields(payload: Readonly<Record<string, unknown>>): Partial<SubmissionProjectFields> | null {
  const value = payload.original_extraction
  return isRecord(value) ? payloadFields(value) : null
}

function localStatus(status: ContractSubmissionDraft['status']): SubmissionDraft['status'] {
  if (status === 'submitted') return 'pending_review'
  if (status === 'closed') return 'withdrawn'
  if (status === 'expired') return 'archived'
  return 'draft'
}

/** Map a server projection without discarding unknown payload fields or local input. */
export function remoteDraftToLocalDraft(
  remote: RemoteSubmissionDraft,
  userId: UserId,
  previous?: SubmissionDraft,
  step: SubmissionDraft['step'] = previous?.step ?? 'prefill',
): SubmissionDraft {
  const serverFields = {
    ...payloadFields(remote.payload_snapshot),
    ...remote.fields,
    publicUrl: remote.fields.publicUrl ?? payloadFields(remote.payload_snapshot).publicUrl,
    categoryId: remote.category_id,
    categorySchemaVersion: remote.category_schema_version,
  }
  const fields: Partial<SubmissionProjectFields> = {
    ...serverFields,
    ...(previous?.fields ?? {}),
    publicUrl: serverFields.publicUrl,
    categoryId: remote.category_id,
    categorySchemaVersion: remote.category_schema_version,
  }
  const original = extractionFields(remote.payload_snapshot) ?? previous?.originalExtraction ?? serverFields
  return {
    id: submissionDraftId(remote.draft_id),
    userId,
    status: localStatus(remote.status),
    step,
    fields,
    originalExtraction: original,
    assetIds: previous?.assetIds ?? [],
    duplicateProjectId: previous?.duplicateProjectId ?? null,
    validationErrors: previous?.validationErrors ?? {},
    reviewMessages: previous?.reviewMessages ?? {},
    submittedFields: previous?.submittedFields ?? null,
    submittedAssetIds: previous?.submittedAssetIds ?? [],
    supplementalMaterial: previous?.supplementalMaterial ?? '',
    publishedProjectId: previous?.publishedProjectId ?? null,
    publishedEventId: previous?.publishedEventId ?? null,
    createdAt: remote.created_at,
    updatedAt: remote.updated_at,
    submittedAt: previous?.submittedAt ?? null,
    withdrawnAt: previous?.withdrawnAt ?? null,
    draftId: submissionDraftId(remote.draft_id),
    checkId: remote.check_id,
    version: remote.version,
    schemaVersion: remote.category_schema_version,
    savedAt: remote.saved_at,
    expiresAt: remote.expires_at,
    remoteStatus: remote.status,
    payloadSnapshot: remote.payload_snapshot,
  }
}

const canonicalSnapshotKeys = ['project_core', 'category_id', 'category_schema_version', 'category_data'] as const
const projectCoreSnapshotKeys = [
  'current_name', 'public_url', 'repository_url', 'original_platform',
  'cover_media_reference_ids', 'one_line_definition', 'ai_coding_tools',
  'tech_stack', 'deployment_platform', 'access_status', 'maintenance_signal', 'status_note',
] as const
const learningSnapshotKeys = [
  'target_users', 'core_problem', 'use_scenarios', 'main_inputs', 'main_outputs',
  'core_flow', 'content_processing', 'practice_formats', 'feedback_methods',
  'learning_records', 'differentiation', 'core_features', 'secondary_features',
  'login_requirement', 'sharing_capability',
] as const
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringList(value: unknown, minimum: number, maximum: number, unique = true): value is readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || !value.every(isText)) return false
  return !unique || new Set(value).size === value.length
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value)
}

function isCanonicalAiCodingTools(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['knowledge_state', 'values', 'source_type', 'observed_at'])) return false
  const state = value.knowledge_state
  const valuesValid = state === 'known_values'
    ? isStringList(value.values, 1, 8)
    : state === 'unknown' ? isStringList(value.values, 0, 0) : false
  return (state === 'known_values' || state === 'unknown') &&
    valuesValid &&
    (value.source_type === 'platform_verified_fact' || value.source_type === 'verified_author_statement' || value.source_type === 'trusted_external_source' || value.source_type === 'system_inference') &&
    isText(value.observed_at) && !Number.isNaN(Date.parse(value.observed_at))
}

function isCanonicalLearningSnapshot(value: unknown): value is LearningV1Snapshot {
  if (!isRecord(value) || !hasExactKeys(value, canonicalSnapshotKeys) ||
      value.category_id !== 'ai_learning_quiz' || value.category_schema_version !== 'learning.v1') return false
  const projectCore = value.project_core
  if (!isRecord(projectCore) || !hasExactKeys(projectCore, projectCoreSnapshotKeys) ||
      !isText(projectCore.current_name) || !isText(projectCore.public_url) ||
      !isNullableText(projectCore.repository_url) || !isNullableText(projectCore.original_platform) ||
      !isStringList(projectCore.cover_media_reference_ids, 0, 20) ||
      !projectCore.cover_media_reference_ids.every((id) => canonicalUuidPattern.test(id)) ||
      !isText(projectCore.one_line_definition) || !isCanonicalAiCodingTools(projectCore.ai_coding_tools) ||
      !isStringList(projectCore.tech_stack, 0, 30) || !isNullableText(projectCore.deployment_platform) ||
      !['normal', 'login_required', 'partial_abnormal', 'link_unavailable', 'suspected_migration', 'paused', 'ended', 'unknown'].includes(projectCore.access_status as string) ||
      !['repository_updated', 'page_updated', 'author_updated', 'no_public_change', 'unknown'].includes(projectCore.maintenance_signal as string) ||
      !isNullableText(projectCore.status_note)) return false

  const categoryData = value.category_data
  if (!isRecord(categoryData) || !hasExactKeys(categoryData, learningSnapshotKeys) ||
      !isStringList(categoryData.target_users, 1, 3) || !isText(categoryData.core_problem) ||
      !isStringList(categoryData.use_scenarios, 1, 5) || !isStringList(categoryData.main_inputs, 1, 5) ||
      !isStringList(categoryData.main_outputs, 1, 5) || !Array.isArray(categoryData.core_flow) ||
      categoryData.core_flow.length < 1 || categoryData.core_flow.length > 10 ||
      !categoryData.core_flow.every((step, index) => isRecord(step) && hasExactKeys(step, ['order', 'name']) && step.order === index + 1 && isText(step.name)) ||
      !isStringList(categoryData.content_processing, 0, 10) || !isStringList(categoryData.practice_formats, 0, 9) ||
      !isStringList(categoryData.feedback_methods, 0, 7) || !isStringList(categoryData.learning_records, 0, 10) ||
      !isNullableText(categoryData.differentiation) || !isStringList(categoryData.core_features, 0, 20) ||
      !isStringList(categoryData.secondary_features, 0, 30) ||
      !['none', 'partial', 'required', 'unknown'].includes(categoryData.login_requirement as string) ||
      !['none', 'link', 'result', 'question_bank', 'collaboration', 'unknown'].includes(categoryData.sharing_capability as string)) return false
  return true
}

function requireCanonicalLearningSnapshot(value: unknown): LearningV1Snapshot {
  if (!isCanonicalLearningSnapshot(value)) throw new TypeError('Invalid canonical learning.v1 snapshot')
  return value
}

/** Validate and return the exact snapshot sent inside OP-DRAFT-PATCH. */
export function editableFieldsToPatch(snapshot: LearningV1Snapshot): Readonly<Record<string, unknown>> {
  return requireCanonicalLearningSnapshot(snapshot) as unknown as Readonly<Record<string, unknown>>
}

export const submissionApi = {
  async check(input: { readonly rawUrl: string; readonly categoryId: ProjectCategoryId } & SubmissionApiRequestOptions): Promise<UrlCheckResult> {
    const clientRequestId = input.clientRequestId ?? makeSubmissionClientRequestId()
    try {
      const source = await clients(input.session, () => clientRequestId).url.check({ raw_url: input.rawUrl.trim(), category_hint: input.categoryId, client_request_id: clientRequestId }, { signal: input.signal })
      return mapUrlCheck(source, input.rawUrl)
    } catch (error) {
      throw mapError(error, input.signal)
    }
  },

  async create(input: { readonly checkId: string; readonly categoryId: ProjectCategoryId } & SubmissionApiRequestOptions): Promise<RemoteSubmissionDraft> {
    const clientRequestId = input.clientRequestId ?? makeSubmissionClientRequestId()
    try {
      const source = await clients(input.session, () => clientRequestId).draft.create({ check_id: input.checkId, category_id: input.categoryId, client_request_id: clientRequestId }, { signal: input.signal })
      return { ...source, fields: payloadFields(source.payload_snapshot), originalExtraction: extractionFields(source.payload_snapshot) ?? payloadFields(source.payload_snapshot) }
    } catch (error) {
      throw mapError(error, input.signal)
    }
  },

  async get(input: { readonly draftId: string } & SubmissionApiRequestOptions): Promise<RemoteSubmissionDraft> {
    try {
      const source = await clients(input.session).draft.get(input.draftId, { signal: input.signal })
      return { ...source, fields: payloadFields(source.payload_snapshot), originalExtraction: extractionFields(source.payload_snapshot) ?? payloadFields(source.payload_snapshot) }
    } catch (error) {
      throw mapError(error, input.signal)
    }
  },

  async patch(input: { readonly draftId: string; readonly expectedVersion: number; readonly snapshot?: LearningV1Snapshot; readonly fields?: Partial<SubmissionProjectFields> } & SubmissionApiRequestOptions): Promise<RemoteSubmissionDraft> {
    if (input.snapshot === undefined) throw new TypeError('canonical learning.v1 snapshot required')
    const patch = editableFieldsToPatch(input.snapshot)
    const operationId = input.operationId ?? makeSubmissionClientRequestId()
    try {
      const source = await clients(input.session, () => operationId).draft.patch(input.draftId, { expected_version: input.expectedVersion, patch, operation_id: operationId }, { signal: input.signal })
      return { ...source, fields: payloadFields(source.payload_snapshot), originalExtraction: extractionFields(source.payload_snapshot) ?? payloadFields(source.payload_snapshot) }
    } catch (error) {
      throw mapError(error, input.signal)
    }
  },

  async preview(input: { readonly draftId: string; readonly expectedVersion: number; readonly checkId: string } & SubmissionApiRequestOptions): Promise<RemoteSubmissionPreview> {
    const clientRequestId = input.clientRequestId ?? makeSubmissionClientRequestId()
    try {
      const source = await clients(input.session, () => clientRequestId).draft.preview(input.draftId, { expected_version: input.expectedVersion, check_id: input.checkId }, { signal: input.signal })
      return {
        ...source,
        previewHash: source.preview_hash,
        frozenSnapshot: source.payload_snapshot,
        referenceSummary: {
          mediaReferenceIds: source.media_reference_ids,
          evidenceDraftIds: source.evidence_draft_ids,
        },
      }
    } catch (error) {
      throw mapError(error, input.signal)
    }
  },

  async submit(input: { readonly draftId: string; readonly draftVersion: number; readonly checkId: string; readonly previewHash: string; readonly submissionKey: string } & SubmissionApiRequestOptions): Promise<RemoteSubmission> {
    const clientRequestId = input.clientRequestId ?? makeSubmissionClientRequestId()
    try {
      const source = await clients(input.session, () => clientRequestId).draft.submit({
        draft_id: input.draftId,
        draft_version: input.draftVersion,
        check_id: input.checkId,
        preview_hash: input.previewHash,
        submission_key: input.submissionKey,
      }, { signal: input.signal })
      return {
        ...source,
        submissionId: source.submission_id,
        reviewWorkItemId: source.review_work_item_id,
      }
    } catch (error) {
      throw mapError(error, input.signal)
    }
  },
}
