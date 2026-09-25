import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

import { Pool } from 'pg'

import { PostgresAdminProjectImporter } from '../admin-importer.js'

const connectionString = process.env.DATABASE_URL?.trim()
const inputPath = process.env.CATALOG_IMPORT_FILE?.trim()
const sourceName = process.env.CATALOG_IMPORT_SOURCE?.trim()
const actorUserId = process.env.CATALOG_IMPORT_ACTOR_USER_ID?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
if (!inputPath) throw new Error('CATALOG_IMPORT_FILE_REQUIRED')
if (!sourceName) throw new Error('CATALOG_IMPORT_SOURCE_REQUIRED')
if (!actorUserId) throw new Error('CATALOG_IMPORT_ACTOR_USER_ID_REQUIRED')
const file = await stat(inputPath)
if (!file.isFile() || file.size < 2 || file.size > 5 * 1024 * 1024) {
  throw new Error('CATALOG_IMPORT_FILE_INVALID')
}
let input: unknown
try {
  input = JSON.parse(await readFile(inputPath, 'utf8'))
} catch {
  throw new Error('CATALOG_IMPORT_JSON_INVALID')
}
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({ connectionString, ssl, application_name: 'vibecheck-admin-project-import', max: 2 })

try {
  const result = await new PostgresAdminProjectImporter(pool).import({
    sourceName,
    actorUserId,
    requestId: randomUUID(),
    input,
  })
  console.info(JSON.stringify({ message: 'admin_project_import_complete', ...result }))
  if (result.rejected_count > 0) process.exitCode = 2
} finally {
  await pool.end()
}
