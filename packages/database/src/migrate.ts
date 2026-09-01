import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadServiceConfig } from '@vibecheck/config'
import { runMigrations } from './migration-runner.js'
import { createDatabasePool } from './pool.js'

const config = loadServiceConfig({ serviceName: 'vibecheck-migration' })
if (config.databaseUrl === null) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = createDatabasePool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  applicationName: config.serviceName,
  maxConnections: 1,
})

try {
  const defaultDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../db/migrations',
  )
  const directory = resolve(process.env.MIGRATIONS_DIR ?? defaultDirectory)
  const result = await runMigrations(pool, directory)
  process.stdout.write(
    `migrations_ok applied=${result.applied.length} existing=${result.alreadyApplied.length}\n`,
  )
} finally {
  await pool.end()
}
