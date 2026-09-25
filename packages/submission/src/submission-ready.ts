import { CatalogError, parseProjectSnapshot, type ProjectSnapshot } from '@vibecheck/catalog'

import { submissionError } from './errors.js'
import { validateDraftPayload } from './payload.js'
import type { SubmissionCategoryId, SubmissionSchemaVersion } from './types.js'

export interface SubmissionReadySnapshot {
  readonly payloadSnapshot: Readonly<Record<string, unknown>>
  readonly projectSnapshot: ProjectSnapshot
  readonly mediaReferenceIds: readonly string[]
  readonly evidenceDraftIds: readonly string[]
  readonly previewHashInput: Readonly<Record<string, unknown>>
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function validateSubmissionReadySnapshot(input: Readonly<{
  payloadSnapshot: unknown
  categoryId: SubmissionCategoryId
  schemaVersion: SubmissionSchemaVersion
  canonicalUrl: string
  mediaReferenceIds: readonly string[]
  coverMediaReferenceIds: readonly string[]
  evidenceDraftIds: readonly string[]
  draftId: string
  draftVersion: number
  checkId: string
  checkInputHash: string
  checkedAt: string
  accessResult: 'accessible' | 'uncertain'
}>): SubmissionReadySnapshot {
  const rawPayload = validateDraftPayload(input.payloadSnapshot)
  // Drafts may contain only the four author-facing required fields. Persist
  // explicit unknowns, rather than invented category facts or default claims.
  const rawCore = rawPayload.project_core
  const rawCategory = rawPayload.category_data
  if (!rawCore || typeof rawCore !== 'object' || Array.isArray(rawCore) ||
      !rawCategory || typeof rawCategory !== 'object' || Array.isArray(rawCategory)) {
    throw submissionError('SUBMISSION_SCHEMA_INVALID', 422)
  }
  const categoryDefaults = input.categoryId === 'ai_learning_quiz' ? {
    target_users: [], core_problem: '', use_scenarios: [], main_inputs: [], main_outputs: [],
    core_flow: [], content_processing: [], practice_formats: [], feedback_methods: [],
    learning_records: [], differentiation: null, core_features: [], secondary_features: [],
    login_requirement: 'unknown', sharing_capability: 'unknown',
  } : {
    site_type: 'unknown', creator_roles: [], primary_goals: [], page_model: 'unknown',
    navigation_pattern: null, homepage_sequence: [], core_modules: [],
    project_showcase_format: 'unknown', case_study_depth: 'unknown', visual_styles: [],
    layout_patterns: [], color_character: 'unknown', theme_mode: 'unknown',
    interaction_level: 'unknown', interaction_patterns: [], responsive_support: 'unknown',
    blog_support: 'unknown',
  }
  const payloadSnapshot = validateDraftPayload({
    ...rawPayload,
    project_core: {
      repository_url: null, original_platform: null, cover_media_reference_ids: [],
      ai_coding_tools: { knowledge_state: 'unknown', values: [], source_type: 'system_inference', observed_at: input.checkedAt },
      tech_stack: [], deployment_platform: null, access_status: 'unknown', maintenance_signal: 'unknown', status_note: null,
      ...rawCore,
      ...(input.accessResult === 'uncertain' ? { access_status: 'unknown' } : {}),
    },
    category_data: { ...categoryDefaults, ...rawCategory },
  })
  let projectSnapshot: ProjectSnapshot
  try {
    projectSnapshot = parseProjectSnapshot(payloadSnapshot, input.categoryId, input.schemaVersion)
  } catch (error) {
    if (error instanceof CatalogError) {
      throw submissionError('SUBMISSION_SCHEMA_INVALID', 422, false, { validation_code: error.code })
    }
    throw error
  }
  if (projectSnapshot.project_core.public_url !== input.canonicalUrl) {
    throw submissionError('SUBMISSION_PUBLIC_URL_MISMATCH', 409)
  }
  if (input.mediaReferenceIds.length > 20) {
    throw submissionError('SUBMISSION_MEDIA_REQUIRED', 422)
  }
  if (
    projectSnapshot.project_core.cover_media_reference_ids.length !== input.coverMediaReferenceIds.length ||
    projectSnapshot.project_core.cover_media_reference_ids.some((id, index) => id !== input.coverMediaReferenceIds[index])
  ) throw submissionError('SUBMISSION_COVER_MEDIA_MISMATCH', 409)
  if (input.evidenceDraftIds.length > 50) {
    throw submissionError('SUBMISSION_EVIDENCE_REQUIRED', 422)
  }
  const previewHashInput = Object.freeze({
    draft_id: input.draftId,
    draft_version: input.draftVersion,
    check_id: input.checkId,
    check_input_hash: input.checkInputHash,
    payload_snapshot: projectSnapshot,
    media_reference_ids: Object.freeze([...input.mediaReferenceIds]),
    evidence_draft_ids: Object.freeze([...input.evidenceDraftIds]),
  })
  return Object.freeze({
    payloadSnapshot: projectSnapshot,
    projectSnapshot,
    mediaReferenceIds: Object.freeze([...input.mediaReferenceIds]),
    evidenceDraftIds: Object.freeze([...input.evidenceDraftIds]),
    previewHashInput,
  })
}
