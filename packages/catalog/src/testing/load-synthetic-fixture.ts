import { Pool } from 'pg'

import { loadSyntheticCatalogFixture } from './synthetic-fixture.js'

const environment = process.env.NODE_ENV ?? 'development'
if (!['development', 'test', 'production'].includes(environment)) throw new Error('CONFIG_NODE_ENV_INVALID')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({ connectionString, ssl, application_name: 'vibecheck-catalog-fixture', max: 1 })

try {
  const result = await loadSyntheticCatalogFixture(
    pool,
    environment as 'development' | 'test' | 'production',
  )
  console.info(JSON.stringify({ message: 'catalog_fixture_complete', ...result }))
} finally {
  await pool.end()
}
