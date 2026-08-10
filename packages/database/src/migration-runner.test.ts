import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { discoverMigrations } from './migration-runner.js'

describe('discoverMigrations', () => {
  it('returns ordered migrations with stable sha256 checksums', async () => {
    const migrations = await discoverMigrations(resolve('../../db/migrations'))
    assert.deepEqual(
      migrations.map((migration) => migration.name),
      [
        '000001_extensions_and_schemas.sql',
        '000002_platform_foundation.sql',
        '000003_identity_access.sql',
      ],
    )
    for (const migration of migrations) {
      assert.match(migration.checksumSha256, /^[a-f0-9]{64}$/)
      assert.ok(migration.sql.length > 100)
    }
  })
})
