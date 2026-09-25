import assert from 'node:assert/strict'

import { Pool } from 'pg'

import { AssetResolutionService, AssetWebSafetyResolver } from '../asset-resolution.js'
import { PostgresAssetResolutionStore } from '../asset-resolution-store.js'
import { CatalogError } from '../errors.js'
import { syntheticCatalogFixture } from './synthetic-fixture.js'

const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
if (process.env.NODE_ENV === 'production') throw new Error('ASSET_RESOLUTION_FIXTURE_PRODUCTION_FORBIDDEN')
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({ connectionString, ssl, application_name: 'vibecheck-asset-resolution-verify', max: 2 })
const assetId = syntheticCatalogFixture.assets[0]!.assetId
const anonymousSubject = Object.freeze({
  kind: 'anonymous' as const,
  id: '4a000000-0000-4000-8000-000000000001',
})
const otherSubject = Object.freeze({
  kind: 'anonymous' as const,
  id: '4a000000-0000-4000-8000-000000000002',
})
const allowedAttemptId = '4b000000-0000-4000-8000-000000000001'
const blockedAttemptId = '4b000000-0000-4000-8000-000000000002'
let fixtureStage = 'initialize'

function workflowAnnotation(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

try {
  const store = new PostgresAssetResolutionStore(pool)
  const publicProbeCalls: string[] = []
  const allowedService = new AssetResolutionService({
    store,
    webResolver: new AssetWebSafetyResolver(
      { resolve: async () => Object.freeze([{ address: '8.8.8.8', family: 4 as const }]) },
      {
        probe: async ({ url }) => {
          publicProbeCalls.push(url)
          return Object.freeze({ statusCode: 200, location: null })
        },
      },
    ),
    now: () => new Date('2026-08-12T00:00:00.000Z'),
  })

  fixtureStage = 'resolve_public_target'
  const command = {
    assetId,
    attemptId: allowedAttemptId,
    targetKind: 'safe_web_url' as const,
    subject: anonymousSubject,
    requestId: 'ci-asset-resolve-allowed',
  }
  const allowed = await allowedService.resolve(command)
  assert.equal(allowed.result, 'allowed')
  assert.equal(allowed.target_domain, 'github.com')
  assert.equal(publicProbeCalls.length, 1)

  fixtureStage = 'replay_immutable_receipt'
  const replay = await allowedService.resolve({ ...command, requestId: 'ci-asset-resolve-replay' })
  assert.deepEqual(replay, allowed)
  assert.equal(publicProbeCalls.length, 1)

  fixtureStage = 'reject_cross_subject_attempt_reuse'
  await assert.rejects(
    () => allowedService.resolve({ ...command, subject: otherSubject, requestId: 'ci-asset-resolve-conflict' }),
    (error: unknown) => {
      assert.ok(error instanceof CatalogError)
      assert.equal(error.code, 'ASSET_ATTEMPT_CONFLICT')
      assert.equal(error.httpStatus, 409)
      return true
    },
  )

  fixtureStage = 'block_private_dns_without_probe'
  let privateProbeCalls = 0
  const blockedService = new AssetResolutionService({
    store,
    webResolver: new AssetWebSafetyResolver(
      { resolve: async () => Object.freeze([{ address: '169.254.169.254', family: 4 as const }]) },
      {
        probe: async () => {
          privateProbeCalls += 1
          return Object.freeze({ statusCode: 200, location: null })
        },
      },
    ),
    now: () => new Date('2026-08-12T00:00:01.000Z'),
  })
  const blocked = await blockedService.resolve({
    assetId,
    attemptId: blockedAttemptId,
    targetKind: 'safe_web_url',
    subject: anonymousSubject,
    requestId: 'ci-asset-resolve-blocked',
  })
  assert.equal(blocked.result, 'blocked')
  assert.equal(blocked.reason_code, 'ASSET_ADDRESS_BLOCKED')
  assert.equal(blocked.safe_web_url, null)
  assert.equal(privateProbeCalls, 0)

  fixtureStage = 'verify_persistence_and_redaction'
  const persisted = await pool.query<{
    receipt_count: number
    audit_count: number
    leaked_target_count: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM workflow.asset_resolution_receipts
        WHERE attempt_id=ANY($1::uuid[])) AS receipt_count,
       (SELECT count(*)::int FROM audit.security_events
        WHERE request_id=ANY($2::text[])) AS audit_count,
       (SELECT count(*)::int FROM audit.security_events
        WHERE request_id=ANY($2::text[])
          AND metadata_json::text ILIKE '%github.com%') AS leaked_target_count`,
    [
      [allowedAttemptId, blockedAttemptId],
      ['ci-asset-resolve-allowed', 'ci-asset-resolve-blocked'],
    ],
  )
  assert.equal(persisted.rows[0]?.receipt_count, 2)
  assert.equal(persisted.rows[0]?.audit_count, 2)
  assert.equal(persisted.rows[0]?.leaked_target_count, 0)

  fixtureStage = 'verify_receipt_immutability'
  await assert.rejects(
    () => pool.query(
      'UPDATE workflow.asset_resolution_receipts SET reason_code=$2 WHERE attempt_id=$1',
      [allowedAttemptId, 'MUTATION_FORBIDDEN'],
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, '55000')
      return true
    },
  )

  console.info(JSON.stringify({
    message: 'asset_resolution_verified',
    allowed_attempt_id: allowedAttemptId,
    blocked_attempt_id: blockedAttemptId,
    dangerous_probe_count: privateProbeCalls,
  }))
} catch (error) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`::error title=Asset resolution fixture failed::stage=${workflowAnnotation(fixtureStage)} ${workflowAnnotation(message)}`)
  }
  throw error
} finally {
  await pool.end()
}
