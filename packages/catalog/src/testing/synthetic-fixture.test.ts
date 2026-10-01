import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Pool } from 'pg'

import { buildSearchDocument } from '../search-document.js'
import {
  loadSyntheticCatalogFixture,
  syntheticCatalogFixture,
  syntheticCatalogFixtureManifestHash,
} from './synthetic-fixture.js'

describe('synthetic catalog fixture', () => {
  it('contains both frozen P0 schemas and deterministic search documents', () => {
    assert.equal(syntheticCatalogFixture.projects.length, 3)
    assert.deepEqual(
      new Set(syntheticCatalogFixture.projects.map(({ snapshot }) => snapshot.category_id)),
      new Set(['ai_learning_quiz', 'personal_site_portfolio']),
    )
    assert.match(syntheticCatalogFixtureManifestHash, /^[a-f0-9]{64}$/)
    const learning = buildSearchDocument(syntheticCatalogFixture.projects[0]!.snapshot)
    assert.match(learning.searchText, /间隔练习/)
    assert.match(learning.searchText, /Codex/)
    assert.doesNotMatch(learning.searchText, /example\.test/)
  })

  it('rejects production before opening a database connection', async () => {
    let connected = false
    const pool = {
      connect: async () => {
        connected = true
        throw new Error('UNEXPECTED_CONNECT')
      },
    } as unknown as Pick<Pool, 'connect'>
    await assert.rejects(
      loadSyntheticCatalogFixture(pool, 'production'),
      /CATALOG_FIXTURE_PRODUCTION_FORBIDDEN/,
    )
    assert.equal(connected, false)
  })
})
