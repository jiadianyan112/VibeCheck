import assert from 'node:assert/strict'

import pg from 'pg'

import {
  linkPermissionProfiles,
  validateLinkPermissionProfileDeployment,
} from '../link-permission-profile.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const pool = new Pool({ connectionString: databaseUrl })

async function run(): Promise<void> {
  await validateLinkPermissionProfileDeployment(pool)
  const verified = await pool.query<{
    readonly profile_id: string
    readonly config_hash: string
    readonly computed_hash: string
    readonly field_count: number
  }>(
    `SELECT profile_id,config_hash,
       catalog.compute_link_permission_profile_hash(
         profile_id,profile_family,profile_version,capabilities_json,field_path_ceiling_json
       ) AS computed_hash,
       jsonb_array_length(field_path_ceiling_json) AS field_count
     FROM catalog.link_permission_profiles ORDER BY profile_id`,
  )
  assert.equal(verified.rows.length, 2)
  for (const row of verified.rows) {
    const expected = linkPermissionProfiles[row.profile_id as keyof typeof linkPermissionProfiles]
    assert.ok(expected)
    assert.equal(row.config_hash, expected.config_hash)
    assert.equal(row.computed_hash, expected.config_hash)
    assert.equal(row.field_count, 43)
  }
  await assert.rejects(
    () => pool.query(
      `UPDATE catalog.link_permission_profiles
       SET capabilities_json='["project_update.create"]'::jsonb
       WHERE profile_id='OWNER_V1' AND profile_version=1`,
    ),
    /IMMUTABLE/,
  )
}

try {
  await run()
  process.stdout.write('link_permission_profiles_fixture_ok profiles=2 fields=43 immutable=ok\n')
} finally {
  await pool.end()
}
