import {
  categoryIds,
  projectAccessStatuses,
  type CategoryId,
  type ProjectAccessStatus,
} from '@vibecheck/catalog'

import { searchError } from './errors.js'
import type { SearchFilters, SearchMode, SearchSort } from './types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

const filterFields = Object.freeze({
  ai_learning_quiz: new Set(['target_users', 'use_scenarios', 'main_inputs', 'main_outputs']),
  personal_site_portfolio: new Set(['site_type', 'creator_roles', 'primary_goals', 'page_model', 'core_modules']),
})

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw searchError(code, 422)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const set = new Set(allowed)
  if (Object.keys(value).some((key) => !set.has(key))) throw searchError(code, 422)
}

function stringMap(
  value: unknown,
  categoryId: CategoryId | null,
  code: string,
): Readonly<Record<string, readonly string[]>> {
  if (value === undefined) return Object.freeze({})
  if (categoryId === null) throw searchError('SEARCH_FILTER_CATEGORY_REQUIRED', 422)
  const input = record(value, code)
  const allowed = filterFields[categoryId]
  const output: Record<string, readonly string[]> = {}
  for (const [key, rawValues] of Object.entries(input)) {
    if (!allowed.has(key) || !Array.isArray(rawValues) || rawValues.length < 1 || rawValues.length > 10) {
      throw searchError(code, 422)
    }
    const normalized = rawValues.map((item) => {
      if (typeof item !== 'string') throw searchError(code, 422)
      const text = item.normalize('NFKC').trim()
      if (text.length < 1 || text.length > 64) throw searchError(code, 422)
      return text
    })
    if (new Set(normalized).size !== normalized.length) throw searchError(code, 422)
    output[key] = Object.freeze([...normalized].sort())
  }
  return Object.freeze(Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b))))
}

export function parseCategoryId(value: unknown): CategoryId | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !categoryIds.includes(value as CategoryId)) {
    throw searchError('SEARCH_CATEGORY_INVALID', 422)
  }
  return value as CategoryId
}

export function parseSearchMode(value: unknown): SearchMode {
  if (value !== 'search' && value !== 'discover') throw searchError('SEARCH_MODE_INVALID', 422)
  return value
}

export function parseSearchSort(value: unknown): SearchSort {
  if (value !== 'relevance') throw searchError('SEARCH_SORT_INVALID', 422)
  return value
}

export function normalizeRawQuery(value: string): string {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (normalized.length < 1 || normalized.length > 500 || !/[\p{L}\p{N}]/u.test(normalized)) {
    throw searchError('SEARCH_QUERY_INVALID', 422)
  }
  return normalized
}

export function parseQueryId(value: string): string {
  if (!uuidPattern.test(value)) throw searchError('QUERY_ID_INVALID', 400)
  return value.toLowerCase()
}

export function parseLocale(value: string): string {
  const normalized = value.trim()
  if (!localePattern.test(normalized) || normalized.length > 35) throw searchError('SEARCH_LOCALE_INVALID', 422)
  return normalized
}

export function parseSearchFilters(value: unknown, categoryId: CategoryId | null): SearchFilters {
  if (value === null || value === undefined) {
    return Object.freeze({
      access_status: Object.freeze([]),
      has_available_asset: null,
      verified_since: null,
      category_fields: Object.freeze({}),
      exclude_category_fields: Object.freeze({}),
    })
  }
  const input = record(value, 'SEARCH_FILTERS_INVALID')
  exactKeys(input, [
    'access_status', 'has_available_asset', 'verified_since',
    'category_fields', 'exclude_category_fields',
  ], 'SEARCH_FILTERS_INVALID')
  let accessStatuses: ProjectAccessStatus[] = []
  if (input.access_status !== undefined) {
    if (!Array.isArray(input.access_status) || input.access_status.length > projectAccessStatuses.length) {
      throw searchError('SEARCH_FILTERS_INVALID', 422)
    }
    accessStatuses = input.access_status.map((item) => {
      if (typeof item !== 'string' || !projectAccessStatuses.includes(item as ProjectAccessStatus)) {
        throw searchError('SEARCH_FILTERS_INVALID', 422)
      }
      return item as ProjectAccessStatus
    })
    if (new Set(accessStatuses).size !== accessStatuses.length) throw searchError('SEARCH_FILTERS_INVALID', 422)
    accessStatuses.sort()
  }
  const asset = input.has_available_asset
  if (asset !== undefined && typeof asset !== 'boolean') throw searchError('SEARCH_FILTERS_INVALID', 422)
  let verifiedSince: string | null = null
  if (input.verified_since !== undefined) {
    if (typeof input.verified_since !== 'string') throw searchError('SEARCH_FILTERS_INVALID', 422)
    const parsed = new Date(input.verified_since)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input.verified_since) {
      throw searchError('SEARCH_FILTERS_INVALID', 422)
    }
    verifiedSince = parsed.toISOString()
  }
  return Object.freeze({
    access_status: Object.freeze(accessStatuses),
    has_available_asset: asset ?? null,
    verified_since: verifiedSince,
    category_fields: stringMap(input.category_fields, categoryId, 'SEARCH_CATEGORY_FILTER_INVALID'),
    exclude_category_fields: stringMap(
      input.exclude_category_fields, categoryId, 'SEARCH_CATEGORY_FILTER_INVALID',
    ),
  })
}

export function queryLengthBucket(length: number): '1_10' | '11_30' | '31_80' | '81_200' | '201_500' {
  if (length <= 10) return '1_10'
  if (length <= 30) return '11_30'
  if (length <= 80) return '31_80'
  if (length <= 200) return '81_200'
  return '201_500'
}
