import assert from 'node:assert/strict'

import { Pool } from 'pg'

import { CatalogService } from '../service.js'
import { PostgresCatalogStore } from '../store.js'
import { syntheticCatalogFixture } from './synthetic-fixture.js'

if (process.env.NODE_ENV === 'production') throw new Error('CATALOG_FIXTURE_PRODUCTION_FORBIDDEN')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({ connectionString, ssl, application_name: 'vibecheck-catalog-fixture-verify', max: 2 })

try {
  const service = new CatalogService({
    store: new PostgresCatalogStore(pool),
    cursorSecret: 'catalog-synthetic-verification-secret-v1',
    now: () => new Date('2026-08-02T00:00:00.000Z'),
  })
  const list = await service.listProjects({ categoryId: null, limit: 24, cursor: null })
  assert.equal(list.items.length, syntheticCatalogFixture.projects.length)
  assert.deepEqual(new Set(list.items.map(({ category_id }) => category_id)), new Set([
    'ai_learning_quiz',
    'personal_site_portfolio',
  ]))

  const portfolioId = syntheticCatalogFixture.projects[1]!.projectId
  const detail = await service.getProject(portfolioId)
  assert.equal(detail.category_id, 'personal_site_portfolio')
  assert.ok(detail.evidence_summaries.length >= 1)
  assert.ok(detail.relations.length >= 1)

  const eventPage = await service.listProjectEvents({
    projectId: syntheticCatalogFixture.projects[0]!.projectId,
    eventTypes: [],
    includeSuperseded: false,
    cursor: null,
  })
  assert.equal(eventPage.items.length, 1)
  assert.ok(eventPage.items[0]!.evidence_summaries.length >= 1)

  const assetPage = await service.listProjectAssets({ projectId: portfolioId, cursor: null })
  assert.equal(assetPage.items.length, 1)
  assert.equal(assetPage.items[0]!.target_status, 'requires_resolve')
  assert.equal('safe_web_url' in assetPage.items[0]!, false)

  const searchCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM search.project_documents WHERE project_id = ANY($1::uuid[])',
    [syntheticCatalogFixture.projects.map(({ projectId }) => projectId)],
  )
  assert.equal(searchCount.rows[0]?.count, syntheticCatalogFixture.projects.length)
  console.info(JSON.stringify({
    message: 'catalog_fixture_verified',
    project_count: list.items.length,
    relation_count: detail.relations.length,
    search_document_count: searchCount.rows[0]?.count,
  }))
} finally {
  await pool.end()
}
