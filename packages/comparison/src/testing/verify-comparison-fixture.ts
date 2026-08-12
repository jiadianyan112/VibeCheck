import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { syntheticCatalogFixture } from '@vibecheck/catalog/testing'
import type { ComparisonConfig } from '@vibecheck/config'
import { Pool } from 'pg'

import { ComparisonError } from '../errors.js'
import { PostgresComparisonStore } from '../postgres-store.js'
import { ComparisonService } from '../service.js'

if (process.env.NODE_ENV === 'production') throw new Error('COMPARISON_FIXTURE_PRODUCTION_FORBIDDEN')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({
  connectionString,
  ssl,
  application_name: 'vibecheck-comparison-fixture-verify',
  max: 3,
})

const config: ComparisonConfig = Object.freeze({
  enabled: true,
  subjectHashPepper: 'comparison-fixture-subject-pepper-at-least-32-characters',
  subjectCookieSecret: 'comparison-fixture-cookie-secret-at-least-32-characters',
  anonymousTtlSeconds: 604_800,
  maximumVisibleMsPerEvent: 60_000,
})
let clock = new Date('2026-08-12T08:00:00.000Z')
const service = new ComparisonService({
  store: new PostgresComparisonStore(pool),
  config,
  now: () => clock,
})

async function expectComparisonError(
  run: () => Promise<unknown>,
  code: string,
  status: number,
): Promise<ComparisonError> {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof ComparisonError)
    assert.equal(error.code, code)
    assert.equal(error.httpStatus, status)
    return error
  }
  assert.fail(`Expected ${code}`)
}

try {
  const schemaDimensions = await pool.query<{
    category_id: string
    dimension_count: number
  }>(
    `SELECT category_id,(
       SELECT count(*)::int FROM jsonb_object_keys(comparison_dimension_map)
     ) AS dimension_count
     FROM taxonomy.category_schema_versions
     WHERE (category_id,schema_version) IN (
       ('ai_learning_quiz','learning.v1'),
       ('personal_site_portfolio','portfolio.v1')
     )
     ORDER BY category_id`,
  )
  assert.equal(schemaDimensions.rows.length, 2)
  assert.ok(schemaDimensions.rows.every(({ dimension_count }) => dimension_count >= 4))

  const portfolioIds = syntheticCatalogFixture.projects
    .filter(({ snapshot }) => snapshot.category_id === 'personal_site_portfolio')
    .map(({ projectId }) => projectId)
  const learningId = syntheticCatalogFixture.projects.find(
    ({ snapshot }) => snapshot.category_id === 'ai_learning_quiz',
  )?.projectId
  assert.equal(portfolioIds.length, 2)
  assert.ok(learningId)

  const comparisonId = randomUUID()
  const anonymousSubject = { kind: 'anonymous' as const, id: randomUUID() }
  const firstRequestId = randomUUID()
  const firstCommand = {
    comparisonId,
    orderedProjectIds: portfolioIds,
    expectedVersion: 0,
    clientRequestId: firstRequestId,
    subject: anonymousSubject,
  }
  const created = await service.putComparison(firstCommand)
  assert.equal(created.mutation_result, 'created')
  assert.equal(created.comparison_version, 1)
  assert.equal(created.category_id, 'personal_site_portfolio')
  assert.equal(created.valid_count, 2)
  assert.equal(created.invalid_count, 0)
  assert.deepEqual(created.ordered_project_ids, portfolioIds)
  assert.ok(created.dimension_groups.length >= 4)
  assert.equal(created.visible_duration_ms, 0)
  assert.equal(created.completed_at, null)
  assert.equal(created.expires_at, '2026-08-19T08:00:00.000Z')

  const replay = await service.putComparison(firstCommand)
  assert.deepEqual(replay, created)
  const exactReceipt = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM comparison.comparison_mutation_receipts WHERE client_request_id=$1`,
    [firstRequestId],
  )
  assert.equal(exactReceipt.rows[0]?.count, 1)

  const noChange = await service.putComparison({
    ...firstCommand,
    expectedVersion: 1,
    clientRequestId: randomUUID(),
  })
  assert.equal(noChange.mutation_result, 'no_change')
  assert.equal(noChange.comparison_version, 1)

  const reorderedIds = Object.freeze([...portfolioIds].reverse())
  const reordered = await service.putComparison({
    comparisonId,
    orderedProjectIds: reorderedIds,
    expectedVersion: 1,
    clientRequestId: randomUUID(),
    subject: anonymousSubject,
  })
  assert.equal(reordered.mutation_result, 'changed')
  assert.equal(reordered.comparison_version, 2)
  assert.deepEqual(reordered.ordered_project_ids, reorderedIds)
  assert.deepEqual(reordered.dimension_groups_viewed, [])
  assert.equal(reordered.visible_duration_ms, 0)

  const stale = await expectComparisonError(() => service.putComparison({
    comparisonId,
    orderedProjectIds: portfolioIds,
    expectedVersion: 1,
    clientRequestId: randomUUID(),
    subject: anonymousSubject,
  }), 'COMPARISON_VERSION_CONFLICT', 409)
  assert.deepEqual(stale.details, {
    current_comparison_version: 2,
    current_ordered_project_ids: reorderedIds,
  })

  await expectComparisonError(() => service.putComparison({
    comparisonId,
    orderedProjectIds: [reorderedIds[0]!, learningId],
    expectedVersion: 2,
    clientRequestId: randomUUID(),
    subject: anonymousSubject,
  }), 'COMPARISON_CATEGORY_MISMATCH', 422)
  assert.equal((await service.getComparison(comparisonId, anonymousSubject)).comparison_version, 2)

  const sixProjectIds = Array.from({ length: 6 }, () => randomUUID())
  const overflow = await expectComparisonError(() => service.putComparison({
    comparisonId,
    orderedProjectIds: sixProjectIds,
    expectedVersion: 2,
    clientRequestId: randomUUID(),
    subject: anonymousSubject,
  }), 'COMPARISON_ITEM_LIMIT_EXCEEDED', 409)
  assert.deepEqual(overflow.details, { maximum_count: 5, requested_count: 6 })
  await expectComparisonError(
    () => service.getComparison(comparisonId, { kind: 'anonymous', id: randomUUID() }),
    'COMPARISON_FORBIDDEN',
    403,
  )

  let finalProgress = null
  const progressEventIds: string[] = []
  for (const [index, dimensionGroup] of reordered.dimension_groups.slice(0, 4).entries()) {
    const eventId = randomUUID()
    progressEventIds.push(eventId)
    finalProgress = await service.recordDimensionProgress({
      eventId,
      comparisonId,
      comparisonVersion: 2,
      dimensionGroup,
      visibleMs: 7_500,
      viewSequence: 1,
      occurredAt: clock.toISOString(),
      subject: anonymousSubject,
    })
    assert.equal(finalProgress.completed_now, index === 3)
  }
  assert.ok(finalProgress)
  assert.equal(finalProgress.visible_duration_ms, 30_000)
  assert.equal(finalProgress.dimension_groups_viewed.length, 4)
  assert.equal(finalProgress.completed_now, true)
  assert.ok(finalProgress.completed_at)

  const duplicateProgress = await service.recordDimensionProgress({
    eventId: progressEventIds[3]!,
    comparisonId,
    comparisonVersion: 2,
    dimensionGroup: reordered.dimension_groups[3]!,
    visibleMs: 7_500,
    viewSequence: 1,
    occurredAt: clock.toISOString(),
    subject: anonymousSubject,
  })
  assert.equal(duplicateProgress.deduplicated, true)
  assert.equal(duplicateProgress.completed_now, false)
  assert.equal(duplicateProgress.visible_duration_ms, 30_000)

  const completionOutbox = await pool.query<{
    count: number
    payload_json: Record<string, unknown>
  }>(
    `SELECT count(*)::int AS count,(array_agg(payload_json))[1] AS payload_json
     FROM ops.outbox_events
     WHERE aggregate_type='comparison' AND aggregate_id=$1
       AND event_name='comparison_completed'`,
    [comparisonId],
  )
  assert.equal(completionOutbox.rows[0]?.count, 1)
  assert.equal(completionOutbox.rows[0]?.payload_json.comparison_version, 2)
  assert.equal(completionOutbox.rows[0]?.payload_json.visible_duration_ms, 30_000)

  clock = new Date('2026-08-12T08:01:00.000Z')
  const versionThree = await service.putComparison({
    comparisonId,
    orderedProjectIds: portfolioIds,
    expectedVersion: 2,
    clientRequestId: randomUUID(),
    subject: anonymousSubject,
  })
  assert.equal(versionThree.comparison_version, 3)
  assert.deepEqual(versionThree.dimension_groups_viewed, [])
  assert.equal(versionThree.visible_duration_ms, 0)
  assert.equal(versionThree.completed_at, null)
  const history = await pool.query<{
    comparison_version: number
    completed_at: Date | null
    progress_count: number
  }>(
    `SELECT version.comparison_version,version.completed_at,
       count(progress.dimension_group)::int AS progress_count
     FROM comparison.comparison_versions version
     LEFT JOIN comparison.comparison_dimension_progress progress
       ON progress.comparison_id=version.comparison_id
      AND progress.comparison_version=version.comparison_version
     WHERE version.comparison_id=$1 AND version.comparison_version IN (2,3)
     GROUP BY version.comparison_version,version.completed_at
     ORDER BY version.comparison_version`,
    [comparisonId],
  )
  assert.ok(history.rows[0]?.completed_at)
  assert.equal(history.rows[0]?.progress_count, 4)
  assert.equal(history.rows[1]?.completed_at, null)
  assert.equal(history.rows[1]?.progress_count, 0)

  const tombstoneProjectId = portfolioIds[0]!
  const originalProjectState = await pool.query<{
    review_status: string
    origin_publication_status: string | null
  }>(
    `SELECT review_status,origin_publication_status
     FROM catalog.projects WHERE project_id=$1`,
    [tombstoneProjectId],
  )
  try {
    await pool.query(
      `UPDATE catalog.projects
       SET origin_publication_status=review_status,review_status='restricted'
       WHERE project_id=$1`,
      [tombstoneProjectId],
    )
    const tombstoned = await service.getComparison(comparisonId, anonymousSubject)
    const invalidItem = tombstoned.items.find(({ project_id }) => project_id === tombstoneProjectId)
    assert.equal(invalidItem?.validity_status, 'invalid')
    assert.equal(invalidItem?.invalid_reason, 'PROJECT_RESTRICTED')
    assert.equal(invalidItem?.project, null)
    assert.equal(tombstoned.invalid_count, 1)
  } finally {
    await pool.query(
      `UPDATE catalog.projects
       SET review_status=$2,origin_publication_status=$3
       WHERE project_id=$1`,
      [
        tombstoneProjectId,
        originalProjectState.rows[0]!.review_status,
        originalProjectState.rows[0]!.origin_publication_status,
      ],
    )
  }

  const cleared = await service.putComparison({
    comparisonId,
    orderedProjectIds: [],
    expectedVersion: 3,
    clientRequestId: randomUUID(),
    subject: anonymousSubject,
  })
  assert.equal(cleared.comparison_version, 4)
  assert.deepEqual(cleared.ordered_project_ids, [])
  assert.equal(cleared.valid_count, 0)

  const userId = randomUUID()
  await pool.query('INSERT INTO iam.users (user_id) VALUES ($1)', [userId])
  const userComparisonId = randomUUID()
  const userSubject = { kind: 'user' as const, id: userId }
  const userComparison = await service.putComparison({
    comparisonId: userComparisonId,
    orderedProjectIds: portfolioIds,
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: userSubject,
  })
  assert.equal(userComparison.expires_at, null)
  const save = () => service.setSaved({
    comparisonId: userComparisonId,
    comparisonVersion: 1,
    state: true,
    subject: userSubject,
    requestId: `request_${randomUUID()}`,
  })
  const saved = await save()
  assert.ok(saved.saved_at)
  const savedAgain = await save()
  assert.equal(savedAgain.saved_at, saved.saved_at)
  const unsave = () => service.setSaved({
    comparisonId: userComparisonId,
    comparisonVersion: 1,
    state: false,
    subject: userSubject,
    requestId: `request_${randomUUID()}`,
  })
  assert.equal((await unsave()).saved_at, null)
  assert.equal((await unsave()).saved_at, null)
  const saveAudits = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit.security_events
     WHERE event_type='comparison_saved_state_changed'
       AND target_id_hash=digest($1::text,'sha256')`,
    [userComparisonId],
  )
  assert.equal(saveAudits.rows[0]?.count, 2)

  await assert.rejects(
    pool.query(
      `UPDATE comparison.comparison_items SET position=position
       WHERE comparison_id=$1 AND comparison_version=2 AND project_id=$2`,
      [comparisonId, portfolioIds[0]],
    ),
    /IMMUTABLE_COMPARISON_FACT/,
  )
  await assert.rejects(
    pool.query(
      `UPDATE comparison.comparison_versions SET item_count=item_count+1
       WHERE comparison_id=$1 AND comparison_version=3`,
      [comparisonId],
    ),
    /IMMUTABLE_COMPARISON_VERSION/,
  )
  await assert.rejects(
    pool.query(
      `UPDATE comparison.comparison_mutation_receipts SET response_json=response_json
       WHERE client_request_id=$1`,
      [firstRequestId],
    ),
    /IMMUTABLE_COMPARISON_FACT/,
  )

  console.info(JSON.stringify({
    message: 'comparison_fixture_verified',
    comparison_version_count: 4,
    completion_event_count: completionOutbox.rows[0]?.count,
    save_audit_count: saveAudits.rows[0]?.count,
  }))
} finally {
  await pool.end()
}
