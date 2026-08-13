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

async function createPortfolioProjects(count: number): Promise<readonly string[]> {
  const source = await pool.query<{ snapshot_json: unknown }>(
    `SELECT version.snapshot_json
     FROM catalog.project_versions version
     JOIN catalog.projects project ON project.current_version_id=version.version_id
     WHERE project.category_id='personal_site_portfolio'
       AND project.review_status IN ('published_platform','published_author')
     LIMIT 1`,
  )
  assert.ok(source.rows[0])
  const client = await pool.connect()
  const ids: string[] = []
  try {
    await client.query('BEGIN')
    for (let index = 0; index < count; index += 1) {
      const projectId = randomUUID()
      const versionId = randomUUID()
      ids.push(projectId)
      // Catalog canonical URLs follow the stable URL contract: the origin root
      // has no trailing slash. Keeping the fixture canonical avoids creating a
      // project hash that the submission URL normalizer can never reproduce.
      const url = `https://merge-fixture-${projectId}.example`
      await client.query(
        `INSERT INTO catalog.projects (
           project_id,current_version_id,current_name,category_id,category_schema_version,
           canonical_public_url,canonical_url_hash,review_status,access_status,http_check_status,
           author_link_status,completeness_level,freshness_status,record_source,first_seen_at,
           last_verified_at,created_at,updated_at
         ) VALUES ($1,NULL,$2,'personal_site_portfolio','portfolio.v1',$3::text,
           digest($3::text,'sha256'),'published_platform','normal','normal','unlinked',
           'complete','valid','platform_editor',$4,$4,$4,$4)`,
        [projectId, `Merge fixture ${index + 1}`, url, clock],
      )
      await client.query(
        `INSERT INTO catalog.project_versions (
           version_id,project_id,version_number,category_id,category_schema_version,
           snapshot_json,source_decision_type,source_decision_id,transaction_id,
           effective_at,created_at
         ) VALUES ($1,$2,1,'personal_site_portfolio','portfolio.v1',$3,
           'admin_fact_decision',$4,$5,$6,$6)`,
        [versionId, projectId, source.rows[0].snapshot_json, randomUUID(), randomUUID(), clock],
      )
      await client.query(
        'UPDATE catalog.projects SET current_version_id=$2 WHERE project_id=$1',
        [projectId, versionId],
      )
    }
    await client.query('COMMIT')
    return Object.freeze(ids)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function createMergeIdentityLink(
  userId: string,
  anonymousSubjectId: string,
  authFlowId = randomUUID(),
): Promise<string> {
  const identityLinkId = randomUUID()
  await pool.query(
    `INSERT INTO iam.identity_links (
       identity_link_id,anonymous_subject_id,user_id,auth_flow_id,purpose,status,
       issued_at,expires_at
     ) VALUES ($1,$2,$3,$4,'comparison_merge','active',$5,$6)`,
    [identityLinkId, anonymousSubjectId, userId, authFlowId, clock, new Date(clock.getTime() + 300_000)],
  )
  return identityLinkId
}

async function createPendingReplayIdentityLink(
  userId: string,
  anonymousSubjectId: string,
  authFlowId: string,
): Promise<string> {
  const identityLinkId = randomUUID()
  await pool.query(
    `INSERT INTO iam.identity_links (
       identity_link_id,anonymous_subject_id,user_id,auth_flow_id,purpose,status,
       issued_at,expires_at
     ) VALUES ($1,$2,$3,$4,'pending_action_replay','active',$5,$6)`,
    [identityLinkId, anonymousSubjectId, userId, authFlowId, clock, new Date(clock.getTime() + 300_000)],
  )
  return identityLinkId
}

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

  const mismatchUserId = randomUUID()
  await pool.query('INSERT INTO iam.users (user_id) VALUES ($1)', [mismatchUserId])
  const mismatchUser = { kind: 'user' as const, id: mismatchUserId }
  const mismatchAccountComparisonId = randomUUID()
  await service.putComparison({
    comparisonId: mismatchAccountComparisonId,
    orderedProjectIds: [learningId],
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: mismatchUser,
  })
  const mismatchAnonymous = { kind: 'anonymous' as const, id: randomUUID() }
  const mismatchAnonymousComparisonId = randomUUID()
  await service.putComparison({
    comparisonId: mismatchAnonymousComparisonId,
    orderedProjectIds: [portfolioIds[0]!],
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: mismatchAnonymous,
  })
  const mismatchAuthFlowId = randomUUID()
  const mismatchLinkId = await createMergeIdentityLink(
    mismatchUserId,
    mismatchAnonymous.id,
    mismatchAuthFlowId,
  )
  const mismatchReplayLinkId = await createPendingReplayIdentityLink(
    mismatchUserId,
    mismatchAnonymous.id,
    mismatchAuthFlowId,
  )
  const mismatchOperationId = randomUUID()
  const accountPreserved = await service.prepareLoginMerge({
    userId: mismatchUserId,
    anonymousSubjectId: mismatchAnonymous.id,
    identityLinkId: mismatchLinkId,
    operationId: mismatchOperationId,
    pendingActionId: null,
  })
  assert.deepEqual(accountPreserved, {
    result: 'not_required',
    comparison_id: mismatchAccountComparisonId,
    comparison_version: 1,
    conflict_id: null,
    conflict_version: null,
    expires_at: null,
  })
  assert.deepEqual(
    (await service.getComparison(mismatchAccountComparisonId, mismatchUser)).ordered_project_ids,
    [learningId],
  )
  const mismatchState = await pool.query<{
    active_comparison_id: string
    account_comparison_count: number
    anonymous_status: string
    link_status: string
    skip_audit_count: number
  }>(
    `SELECT active.comparison_id AS active_comparison_id,
       (SELECT count(*)::int FROM comparison.comparisons WHERE owner_user_id=$1)
         AS account_comparison_count,
       anonymous.status AS anonymous_status,
       link.status AS link_status,
       (SELECT count(*)::int FROM audit.security_events
        WHERE event_type='comparison_login_merge_skipped'
          AND request_id=$4
          AND metadata_json->>'reason'='category_mismatch_account_preserved')
         AS skip_audit_count
     FROM comparison.active_comparisons active
     JOIN comparison.comparisons anonymous ON anonymous.comparison_id=$2
     JOIN iam.identity_links link ON link.identity_link_id=$3
     WHERE active.owner_user_id=$1`,
    [mismatchUserId, mismatchAnonymousComparisonId, mismatchLinkId, mismatchOperationId],
  )
  assert.equal(mismatchState.rows[0]?.active_comparison_id, mismatchAccountComparisonId)
  assert.equal(mismatchState.rows[0]?.account_comparison_count, 1)
  assert.equal(mismatchState.rows[0]?.anonymous_status, 'active')
  assert.equal(mismatchState.rows[0]?.link_status, 'consumed')
  assert.equal(mismatchState.rows[0]?.skip_audit_count, 1)
  assert.deepEqual(await service.prepareLoginMerge({
    userId: mismatchUserId,
    anonymousSubjectId: mismatchAnonymous.id,
    identityLinkId: mismatchLinkId,
    operationId: mismatchOperationId,
    pendingActionId: null,
  }), accountPreserved)
  await expectComparisonError(() => service.setSavedAfterLoginReplay({
    sourceComparisonId: mismatchAnonymousComparisonId,
    sourceComparisonVersion: 1,
    state: true,
    identityLinkId: mismatchReplayLinkId,
    subject: mismatchUser,
    requestId: randomUUID(),
  }), 'COMPARISON_REPLAY_TARGET_NOT_ADOPTED', 409)

  const mergeProjectIds = await createPortfolioProjects(6)
  const autoMergeUserId = randomUUID()
  await pool.query('INSERT INTO iam.users (user_id) VALUES ($1)', [autoMergeUserId])
  const autoMergeUser = { kind: 'user' as const, id: autoMergeUserId }
  const autoAccountComparisonId = randomUUID()
  await service.putComparison({
    comparisonId: autoAccountComparisonId,
    orderedProjectIds: mergeProjectIds.slice(0, 3),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: autoMergeUser,
  })
  const autoAnonymousSubject = { kind: 'anonymous' as const, id: randomUUID() }
  const autoAnonymousComparisonId = randomUUID()
  await service.putComparison({
    comparisonId: autoAnonymousComparisonId,
    orderedProjectIds: [mergeProjectIds[2]!, mergeProjectIds[3]!, mergeProjectIds[4]!],
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: autoAnonymousSubject,
  })
  const autoAuthFlowId = randomUUID()
  const autoLinkId = await createMergeIdentityLink(
    autoMergeUserId,
    autoAnonymousSubject.id,
    autoAuthFlowId,
  )
  const autoReplayLinkId = await createPendingReplayIdentityLink(
    autoMergeUserId,
    autoAnonymousSubject.id,
    autoAuthFlowId,
  )
  const autoOperationId = randomUUID()
  const autoMerged = await service.prepareLoginMerge({
    userId: autoMergeUserId,
    anonymousSubjectId: autoAnonymousSubject.id,
    identityLinkId: autoLinkId,
    operationId: autoOperationId,
    pendingActionId: null,
  })
  assert.equal(autoMerged.result, 'merged')
  assert.equal(autoMerged.comparison_id, autoAccountComparisonId)
  assert.equal(autoMerged.comparison_version, 2)
  assert.deepEqual(
    (await service.getComparison(autoAccountComparisonId, autoMergeUser)).ordered_project_ids,
    mergeProjectIds.slice(0, 5),
  )
  assert.equal(
    (await pool.query<{ status: string }>(
      'SELECT status FROM iam.identity_links WHERE identity_link_id=$1',
      [autoLinkId],
    )).rows[0]?.status,
    'consumed',
  )
  assert.deepEqual(await service.prepareLoginMerge({
    userId: autoMergeUserId,
    anonymousSubjectId: autoAnonymousSubject.id,
    identityLinkId: autoLinkId,
    operationId: autoOperationId,
    pendingActionId: null,
  }), autoMerged)
  const replaySaved = await service.setSavedAfterLoginReplay({
    sourceComparisonId: autoAnonymousComparisonId,
    sourceComparisonVersion: 1,
    state: true,
    identityLinkId: autoReplayLinkId,
    subject: autoMergeUser,
    requestId: randomUUID(),
  })
  assert.equal(replaySaved.comparison_id, autoAccountComparisonId)
  assert.equal(replaySaved.comparison_version, 2)
  assert.ok(replaySaved.saved_at)

  const conflictUserId = randomUUID()
  await pool.query('INSERT INTO iam.users (user_id) VALUES ($1)', [conflictUserId])
  const conflictUser = { kind: 'user' as const, id: conflictUserId }
  const conflictAccountId = randomUUID()
  await service.putComparison({
    comparisonId: conflictAccountId,
    orderedProjectIds: mergeProjectIds.slice(0, 3),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: conflictUser,
  })
  const conflictAnonymous = { kind: 'anonymous' as const, id: randomUUID() }
  const conflictAnonymousId = randomUUID()
  await service.putComparison({
    comparisonId: conflictAnonymousId,
    orderedProjectIds: mergeProjectIds.slice(3, 6),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: conflictAnonymous,
  })
  const conflictLinkId = await createMergeIdentityLink(conflictUserId, conflictAnonymous.id)
  const conflict = await service.prepareLoginMerge({
    userId: conflictUserId,
    anonymousSubjectId: conflictAnonymous.id,
    identityLinkId: conflictLinkId,
    operationId: randomUUID(),
    pendingActionId: null,
  })
  assert.equal(conflict.result, 'conflict')
  assert.ok(conflict.conflict_id)
  const recovered = await service.getMergeConflict({
    conflictId: conflict.conflict_id!,
    subject: conflictUser,
  })
  assert.equal(recovered.status, 'pending')
  assert.equal(recovered.version, 1)
  assert.deepEqual(recovered.candidate_project_ids, mergeProjectIds)
  assert.equal(recovered.candidate_projects.length, 6)

  const resolveOperationId = randomUUID()
  const resolutionCommand = {
    conflictId: conflict.conflict_id!,
    selectedProjectIds: mergeProjectIds.slice(0, 5),
    accountVersion: 1,
    anonymousVersion: 1,
    expectedConflictVersion: 1,
    operationId: resolveOperationId,
    subject: conflictUser,
  }
  const resolved = await service.resolveMergeConflict(resolutionCommand)
  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.conflict_version, 2)
  assert.equal(resolved.comparison_version, 2)
  assert.deepEqual(await service.resolveMergeConflict(resolutionCommand), resolved)
  assert.equal((await service.getComparison(conflictAnonymousId, conflictAnonymous)).comparison_version, 1)
  const retainedAccountVersion = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM comparison.comparison_versions
     WHERE comparison_id=$1 AND comparison_version=1`,
    [conflictAccountId],
  )
  assert.equal(retainedAccountVersion.rows[0]?.count, 1)

  const cancelUserId = randomUUID()
  await pool.query('INSERT INTO iam.users (user_id) VALUES ($1)', [cancelUserId])
  const cancelUser = { kind: 'user' as const, id: cancelUserId }
  const cancelAccountId = randomUUID()
  await service.putComparison({
    comparisonId: cancelAccountId,
    orderedProjectIds: mergeProjectIds.slice(0, 3),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: cancelUser,
  })
  const cancelAnonymous = { kind: 'anonymous' as const, id: randomUUID() }
  const cancelAnonymousId = randomUUID()
  await service.putComparison({
    comparisonId: cancelAnonymousId,
    orderedProjectIds: mergeProjectIds.slice(3, 6),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: cancelAnonymous,
  })
  const cancelAuthFlowId = randomUUID()
  const cancelLinkId = await createMergeIdentityLink(cancelUserId, cancelAnonymous.id, cancelAuthFlowId)
  const cancelPendingActionId = randomUUID()
  const cancelPendingLinkId = randomUUID()
  await pool.query(
    `INSERT INTO iam.pending_actions (
       pending_action_id,anonymous_subject_hash,action_type,payload_ciphertext,
       payload_key_version,request_payload_hash,return_to,client_request_id,status,
       expires_at,created_at,updated_at
     ) VALUES (
       $1,digest($2,'sha256'),'save_comparison',decode('00','hex'),'fixture-v1',$3,
       '/compare',$4,'pending',$5,$6,$6
     )`,
    [
      cancelPendingActionId,
      cancelAnonymous.id,
      '0'.repeat(64),
      randomUUID(),
      new Date(clock.getTime() + 300_000),
      clock,
    ],
  )
  await pool.query(
    `INSERT INTO iam.identity_links (
       identity_link_id,anonymous_subject_id,user_id,auth_flow_id,purpose,status,issued_at,expires_at
     ) VALUES ($1,$2,$3,$4,'pending_action_replay','active',$5,$6)`,
    [
      cancelPendingLinkId,
      cancelAnonymous.id,
      cancelUserId,
      cancelAuthFlowId,
      clock,
      new Date(clock.getTime() + 300_000),
    ],
  )
  await pool.query(
    `INSERT INTO iam.pending_action_identity_links (pending_action_id,identity_link_id,created_at)
     VALUES ($1,$2,$3)`,
    [cancelPendingActionId, cancelPendingLinkId, clock],
  )
  const pendingCancellation = await service.prepareLoginMerge({
    userId: cancelUserId,
    anonymousSubjectId: cancelAnonymous.id,
    identityLinkId: cancelLinkId,
    operationId: randomUUID(),
    pendingActionId: cancelPendingActionId,
  })
  assert.equal(pendingCancellation.result, 'conflict')
  const cancelOperationId = randomUUID()
  const cancellationCommand = {
    conflictId: pendingCancellation.conflict_id!,
    cancelReason: 'user_closed',
    expectedConflictVersion: 1,
    operationId: cancelOperationId,
    subject: cancelUser,
  }
  const cancelled = await service.cancelMergeConflict(cancellationCommand)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.conflict_version, 2)
  assert.equal(cancelled.pending_action_status, 'cancelled')
  assert.deepEqual(await service.cancelMergeConflict(cancellationCommand), cancelled)
  assert.equal((await service.getComparison(cancelAccountId, cancelUser)).comparison_version, 1)
  assert.equal((await service.getComparison(cancelAnonymousId, cancelAnonymous)).comparison_version, 1)
  const cancelledPending = await pool.query<{
    status: string
    payload_ciphertext: Buffer | null
    link_status: string
  }>(
    `SELECT action.status,action.payload_ciphertext,link.status AS link_status
     FROM iam.pending_actions action
     JOIN iam.pending_action_identity_links binding USING (pending_action_id)
     JOIN iam.identity_links link USING (identity_link_id)
     WHERE action.pending_action_id=$1`,
    [cancelPendingActionId],
  )
  assert.equal(cancelledPending.rows[0]?.status, 'cancelled')
  assert.equal(cancelledPending.rows[0]?.payload_ciphertext, null)
  assert.equal(cancelledPending.rows[0]?.link_status, 'revoked')

  const expiryUserId = randomUUID()
  await pool.query('INSERT INTO iam.users (user_id) VALUES ($1)', [expiryUserId])
  const expiryUser = { kind: 'user' as const, id: expiryUserId }
  await service.putComparison({
    comparisonId: randomUUID(),
    orderedProjectIds: mergeProjectIds.slice(0, 3),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: expiryUser,
  })
  const expiryAnonymous = { kind: 'anonymous' as const, id: randomUUID() }
  await service.putComparison({
    comparisonId: randomUUID(),
    orderedProjectIds: mergeProjectIds.slice(3, 6),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject: expiryAnonymous,
  })
  const expiryLinkId = await createMergeIdentityLink(expiryUserId, expiryAnonymous.id)
  const expiringConflict = await service.prepareLoginMerge({
    userId: expiryUserId,
    anonymousSubjectId: expiryAnonymous.id,
    identityLinkId: expiryLinkId,
    operationId: randomUUID(),
    pendingActionId: null,
  })
  assert.equal(expiringConflict.result, 'conflict')
  clock = new Date(clock.getTime() + 301_000)
  await expectComparisonError(() => service.getMergeConflict({
    conflictId: expiringConflict.conflict_id!,
    subject: expiryUser,
  }), 'COMPARISON_MERGE_CONFLICT_GONE', 410)
  const expiredConflict = await pool.query<{ status: string; link_status: string }>(
    `SELECT conflict.status,link.status AS link_status
     FROM comparison.comparison_merge_conflicts conflict
     JOIN iam.identity_links link ON link.identity_link_id=conflict.identity_link_id
     WHERE conflict.conflict_id=$1`,
    [expiringConflict.conflict_id],
  )
  assert.equal(expiredConflict.rows[0]?.status, 'expired')
  assert.equal(expiredConflict.rows[0]?.link_status, 'expired')

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
    login_merge_candidate_count: recovered.candidate_project_ids.length,
  }))
} finally {
  await pool.end()
}
