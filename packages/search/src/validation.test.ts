import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SearchError } from './errors.js'
import { normalizeRawQuery, parseSearchFilters } from './validation.js'

test('raw search text is normalized and bounded without accepting punctuation-only input', () => {
  assert.equal(normalizeRawQuery('  Northstar   Portfolio  '), 'Northstar Portfolio')
  assert.throws(
    () => normalizeRawQuery('!!!'),
    (error: unknown) => error instanceof SearchError && error.code === 'SEARCH_QUERY_INVALID',
  )
  assert.throws(() => normalizeRawQuery('a'.repeat(501)), SearchError)
})

test('category filters enforce frozen per-category whitelists and deterministic values', () => {
  const filters = parseSearchFilters({
    access_status: ['normal'],
    category_fields: { creator_roles: ['frontend_engineer', 'product_designer'] },
    exclude_category_fields: { site_type: ['academic_homepage'] },
  }, 'personal_site_portfolio')
  assert.deepEqual(filters.category_fields, {
    creator_roles: ['frontend_engineer', 'product_designer'],
  })
  assert.throws(
    () => parseSearchFilters({ category_fields: { target_users: ['student'] } }, 'personal_site_portfolio'),
    (error: unknown) => error instanceof SearchError && error.code === 'SEARCH_CATEGORY_FILTER_INVALID',
  )
  assert.throws(
    () => parseSearchFilters({ category_fields: { target_users: ['student'] } }, null),
    (error: unknown) => error instanceof SearchError && error.code === 'SEARCH_FILTER_CATEGORY_REQUIRED',
  )
})
