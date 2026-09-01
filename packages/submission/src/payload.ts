import { submissionError } from './errors.js'

type JsonObject = Record<string, unknown>

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype'])

function assertJsonValue(value: unknown, depth: number): void {
  if (depth > 16) throw submissionError('DRAFT_PAYLOAD_DEPTH_EXCEEDED', 422)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw submissionError('DRAFT_PAYLOAD_INVALID', 422)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw submissionError('DRAFT_PAYLOAD_ARRAY_LIMIT_EXCEEDED', 422)
    for (const item of value) assertJsonValue(item, depth + 1)
    return
  }
  if (typeof value !== 'object') throw submissionError('DRAFT_PAYLOAD_INVALID', 422)
  const entries = Object.entries(value as JsonObject)
  if (entries.length > 100) throw submissionError('DRAFT_PAYLOAD_FIELD_LIMIT_EXCEEDED', 422)
  for (const [key, child] of entries) {
    if (!key || key.length > 128 || forbiddenKeys.has(key)) {
      throw submissionError('DRAFT_PAYLOAD_FIELD_INVALID', 422)
    }
    assertJsonValue(child, depth + 1)
  }
}

export function validateDraftPayload(value: unknown): Readonly<JsonObject> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw submissionError('DRAFT_PAYLOAD_INVALID', 422)
  }
  assertJsonValue(value, 0)
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > 512 * 1024) {
    throw submissionError('DRAFT_PAYLOAD_TOO_LARGE', 413)
  }
  return Object.freeze(structuredClone(value as JsonObject))
}

export function mergeDraftPayload(
  current: Readonly<JsonObject>,
  patch: Readonly<JsonObject>,
): Readonly<JsonObject> {
  const merge = (base: unknown, change: unknown): unknown => {
    if (change === null) return null
    if (Array.isArray(change) || typeof change !== 'object') return structuredClone(change)
    const source = base !== null && typeof base === 'object' && !Array.isArray(base)
      ? { ...(base as JsonObject) }
      : {}
    for (const [key, value] of Object.entries(change as JsonObject)) {
      const merged = merge(source[key], value)
      source[key] = merged
    }
    return source
  }
  return validateDraftPayload(merge(current, patch))
}

export function assertDraftIdentity(
  payload: Readonly<JsonObject>,
  expected: Readonly<{
    categoryId: string
    schemaVersion: string
    canonicalUrl: string
  }>,
): void {
  if (
    payload.category_id !== expected.categoryId ||
    payload.category_schema_version !== expected.schemaVersion
  ) throw submissionError('DRAFT_CATEGORY_IMMUTABLE', 422)
  const core = payload.project_core
  if (core === null || typeof core !== 'object' || Array.isArray(core)) {
    throw submissionError('DRAFT_PROJECT_CORE_INVALID', 422)
  }
  if ((core as JsonObject).public_url !== expected.canonicalUrl) {
    throw submissionError('DRAFT_PUBLIC_URL_IMMUTABLE', 422)
  }
  const categoryData = payload.category_data
  if (categoryData === null || typeof categoryData !== 'object' || Array.isArray(categoryData)) {
    throw submissionError('DRAFT_CATEGORY_DATA_INVALID', 422)
  }
}
