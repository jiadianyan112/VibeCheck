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
}>): SubmissionReadySnapshot {
  const payloadSnapshot = validateDraftPayload(input.payloadSnapshot)
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
  if (input.mediaReferenceIds.length < 1 || input.mediaReferenceIds.length > 20) {
    throw submissionError('SUBMISSION_MEDIA_REQUIRED', 422)
  }
  if (input.coverMediaReferenceIds.length < 1) {
    throw submissionError('SUBMISSION_COVER_MEDIA_REQUIRED', 422)
  }
  if (
    projectSnapshot.project_core.cover_media_reference_ids.length !== input.coverMediaReferenceIds.length ||
    projectSnapshot.project_core.cover_media_reference_ids.some((id, index) => id !== input.coverMediaReferenceIds[index])
  ) throw submissionError('SUBMISSION_COVER_MEDIA_MISMATCH', 409)
  if (input.evidenceDraftIds.length < 1 || input.evidenceDraftIds.length > 50) {
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
