import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import type { Pool, PoolClient } from 'pg'
import { discoverMigrations, runMigrations } from './migration-runner.js'

interface QueryCall {
  readonly text: string
  readonly values?: readonly unknown[]
}

function createFakePool(ledger: string | null): { readonly pool: Pool; readonly calls: QueryCall[] } {
  const calls: QueryCall[] = []
  const client = {
    query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values })
      if (text.includes("SELECT to_regclass('ops.schema_migrations') AS ledger")) {
        return { rows: [{ ledger }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined,
  } as unknown as PoolClient

  return {
    pool: { connect: async () => client } as unknown as Pool,
    calls,
  }
}

describe('discoverMigrations', () => {
  it('returns ordered migrations with stable sha256 checksums', async () => {
    const migrations = await discoverMigrations(resolve('../../db/migrations'))
    assert.deepEqual(
      migrations.map((migration) => migration.name),
      [
        '000001_extensions_and_schemas.sql',
        '000002_platform_foundation.sql',
        '000003_identity_access.sql',
        '000004_catalog_public_read.sql',
        '000005_search_keyword.sql',
        '000006_query_snapshot_lifecycle.sql',
        '000007_admin_project_import.sql',
        '000008_search_structured_fts.sql',
        '000009_asset_resolution_security.sql',
        '000010_comparison_core.sql',
        '000011_comparison_merge_conflicts.sql',
        '000012_pending_actions.sql',
        '000013_community_interactions.sql',
        '000014_community_comments.sql',
        '000015_analytics_client_ingest.sql',
        '000016_submission_entry_and_drafts.sql',
        '000017_review_work_item_leases.sql',
        '000018_media_and_evidence_drafts.sql',
        '000019_submission_preview_and_submit.sql',
        '000020_submission_withdrawal.sql',
        '000021_submission_revision_drafts.sql',
        '000022_admin_operation_security.sql',
        '000023_review_decisions.sql',
        '000024_submission_publication.sql',
        '000025_notifications.sql',
        '000026_submission_asset_security_gate.sql',
        '000027_link_permission_profiles.sql',
        '000028_creator_account_links.sql',
        '000029_project_update_drafts.sql',
        '000030_project_update_review_entry.sql',
        '000031_project_update_review_decisions.sql',
        '000032_project_update_application.sql',
        '000033_verification_request_drafts.sql',
        '000034_verification_material_control_plane.sql',
        '000035_verification_material_scan_polling.sql',
        '000036_author_verification_lifecycle.sql',
        '000037_ownership_dispute_lifecycle.sql',
        '000038_discovery_taxonomy_and_public_feed.sql',
        '000039_search_navigation_attribution.sql',
      '000040_retire_comparison_login_merge.sql',
      '000041_public_media_upload_control_plane.sql',
      '000042_email_password_auth.sql',
      '000043_submission_review_session_confirmation.sql',
      '000044_password_change_and_reset.sql',
      '000045_structured_experiences.sql',
      '000046_community_rate_limit_defaults.sql',
      '000047_project_follow_history.sql',
      '000048_developer_identity_v1.sql',
      '000049_developer_verification_boundary.sql',
      ],
    )
    for (const migration of migrations) {
      assert.match(migration.checksumSha256, /^[a-f0-9]{64}$/)
      assert.ok(migration.sql.length > 100)
    }
  })

  it('does not attempt CREATE when the existing ledger table is empty', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'vibecheck-migration-ledger-'))
    try {
      const { pool, calls } = createFakePool('ops.schema_migrations')

      const result = await runMigrations(pool, directory)

      assert.deepEqual(result, { applied: [], alreadyApplied: [] })
      assert.deepEqual(
        calls.map(({ text, values }) => ({ text, values })),
        [
          { text: 'SELECT pg_advisory_lock($1)', values: [864_203_071] },
          { text: "SELECT to_regclass('ops.schema_migrations') AS ledger", values: undefined },
          { text: 'SELECT pg_advisory_unlock($1)', values: [864_203_071] },
        ],
      )
      assert.equal(calls.some(({ text }) => /CREATE\s+(SCHEMA|TABLE)/i.test(text)), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('initializes the schema and ledger when the ledger table is absent', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'vibecheck-migration-ledger-'))
    try {
      const { pool, calls } = createFakePool(null)

      const result = await runMigrations(pool, directory)

      assert.deepEqual(result, { applied: [], alreadyApplied: [] })
      const queryTexts = calls.map(({ text }) => text)
      assert.deepEqual(queryTexts.slice(0, 3), [
        'SELECT pg_advisory_lock($1)',
        "SELECT to_regclass('ops.schema_migrations') AS ledger",
        'CREATE SCHEMA IF NOT EXISTS ops',
      ])
      assert.match(queryTexts[3] ?? '', /CREATE TABLE IF NOT EXISTS ops\.schema_migrations/)
      assert.match(queryTexts[3] ?? '', /migration_name varchar\(255\) PRIMARY KEY/)
      assert.equal(queryTexts.at(-1), 'SELECT pg_advisory_unlock($1)')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

})
