import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'

const migrationNamePattern = /^\d{6}_[a-z0-9_]+\.sql$/
const migrationLockKey = 864_203_071

export interface MigrationFile {
  readonly name: string
  readonly sql: string
  readonly checksumSha256: string
}

export interface MigrationResult {
  readonly applied: readonly string[]
  readonly alreadyApplied: readonly string[]
}

export async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter((name) => migrationNamePattern.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))

  const migrations: MigrationFile[] = []
  for (const name of names) {
    const sql = await readFile(join(directory, name), 'utf8')
    migrations.push(
      Object.freeze({
        name,
        sql,
        checksumSha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
      }),
    )
  }
  return migrations
}

async function ensureMigrationLedger(client: PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS ops')
  await client.query(`
    CREATE TABLE IF NOT EXISTS ops.schema_migrations (
      migration_name varchar(255) PRIMARY KEY,
      checksum_sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

export async function runMigrations(
  pool: Pool,
  directory: string,
): Promise<MigrationResult> {
  const migrations = await discoverMigrations(directory)
  const applied: string[] = []
  const alreadyApplied: string[] = []
  const client = await pool.connect()

  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockKey])
    await ensureMigrationLedger(client)

    for (const migration of migrations) {
      const existing = await client.query<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM ops.schema_migrations WHERE migration_name = $1',
        [migration.name],
      )

      if (existing.rowCount === 1) {
        if (existing.rows[0]?.checksum_sha256 !== migration.checksumSha256) {
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.name}`)
        }
        alreadyApplied.push(migration.name)
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          `INSERT INTO ops.schema_migrations (migration_name, checksum_sha256)
           VALUES ($1, $2)`,
          [migration.name, migration.checksumSha256],
        )
        await client.query('COMMIT')
        applied.push(migration.name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey]).catch(() => undefined)
    client.release()
  }

  return Object.freeze({
    applied: Object.freeze(applied),
    alreadyApplied: Object.freeze(alreadyApplied),
  })
}
