import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { ComparisonService, PostgresComparisonStore } from '@vibecheck/comparison'
import type { AnalyticsConfig, ComparisonConfig } from '@vibecheck/config'
import { Pool } from 'pg'

import { PostgresAnalyticsStore } from '../postgres-store.js'
import { AnalyticsService } from '../service.js'

if (process.env.NODE_ENV === 'production') throw new Error('ANALYTICS_FIXTURE_PRODUCTION_FORBIDDEN')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  application_name: 'vibecheck-analytics-fixture-verify',
  max: 3,
})

const clock = new Date('2026-08-13T08:00:00.000Z')
const comparisonConfig: ComparisonConfig = Object.freeze({
  enabled: true,
  subjectHashPepper: 'comparison-fixture-subject-pepper-at-least-32-characters',
  subjectCookieSecret: 'comparison-fixture-cookie-secret-at-least-32-characters',
  anonymousTtlSeconds: 604_800,
  maximumVisibleMsPerEvent: 60_000,
})
const analyticsConfig: AnalyticsConfig = Object.freeze({
  enabled: true,
  sessionSecret: 'analytics-fixture-session-secret-at-least-32-characters',
  subjectHashPepper: 'analytics-fixture-subject-pepper-at-least-32-characters',
  sessionTtlSeconds: 3_600,
  consentState: 'not_required',
})
const comparison = new ComparisonService({
  store: new PostgresComparisonStore(pool),
  config: comparisonConfig,
  now: () => clock,
})
const analytics = new AnalyticsService({
  config: analyticsConfig,
  store: new PostgresAnalyticsStore(pool),
  eventHandler: {
    async recordComparisonDimension(input) {
      await comparison.recordDimensionProgress(input)
    },
  },
  now: () => clock,
})

try {
  const projects = await pool.query<{ project_id: string }>(
    `SELECT project_id
     FROM catalog.projects
     WHERE category_id='personal_site_portfolio'
       AND review_status IN ('published_platform','published_author')
       AND access_status='normal'
     ORDER BY project_id
     LIMIT 2`,
  )
  assert.equal(projects.rows.length, 2, 'analytics fixture requires two public portfolio projects')
  const subject = Object.freeze({ kind: 'anonymous' as const, id: randomUUID() })
  const context = Object.freeze({ subject, bindingMaterial: `fixture-browser:${randomUUID()}` })
  const comparisonId = randomUUID()
  const created = await comparison.putComparison({
    comparisonId,
    orderedProjectIds: projects.rows.map(({ project_id }) => project_id),
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    subject,
  })
  const token = analytics.issueSession(context)
  const groups = created.dimension_groups.slice(0, 4)
  assert.equal(groups.length, 4)
  const eventIds = groups.map(() => randomUUID())
  const body = Object.freeze({
    batch_version: 1,
    sent_at: clock.toISOString(),
    sdk_version: 'fixture-1',
    events: Object.freeze(groups.map((dimensionGroup, index) => Object.freeze({
      event_id: eventIds[index]!,
      event_name: 'comparison_dimension_viewed',
      event_version: 1,
      occurred_at: new Date(clock.getTime() - (4 - index) * 1_000).toISOString(),
      app_version: '0.2.0',
      page_id: 'P09',
      payload: Object.freeze({
        comparison_id: comparisonId,
        comparison_version: created.comparison_version,
        dimension_group: dimensionGroup,
        visible_ms: 7_500,
        project_count: 2,
        view_sequence: 1,
        interaction_type: 'scroll',
      }),
    }))),
  })
  const accepted = await analytics.ingestClientBatch({
    body,
    sessionHeader: token,
    context,
    environment: 'test',
  })
  assert.deepEqual(accepted.items.map(({ status }) => status), [
    'accepted', 'accepted', 'accepted', 'accepted',
  ])
  const completed = await comparison.getComparison(comparisonId, subject)
  assert.equal(completed.dimension_groups_viewed.length, 4)
  assert.equal(completed.visible_duration_ms, 30_000)
  assert.ok(completed.completed_at)

  const replayed = await analytics.ingestClientBatch({
    body,
    sessionHeader: token,
    context,
    environment: 'test',
  })
  assert.deepEqual(replayed.items.map(({ status }) => status), [
    'deduplicated', 'deduplicated', 'deduplicated', 'deduplicated',
  ])
  const crossed = await analytics.ingestClientBatch({
    body: Object.freeze({
      ...body,
      events: Object.freeze([Object.freeze({ ...body.events[0]!, event_id: randomUUID() })]),
    }),
    sessionHeader: token,
    context: Object.freeze({ ...context, bindingMaterial: 'another-browser' }),
    environment: 'test',
  })
  assert.equal(crossed.items[0]?.error_code, 'ACTOR_IDENTITY_INVALID')

  const protectedField = await analytics.ingestClientBatch({
    body: Object.freeze({
      ...body,
      events: Object.freeze([Object.freeze({
        ...body.events[0]!,
        event_id: randomUUID(),
        user_id: randomUUID(),
      })]),
    }),
    sessionHeader: token,
    context,
    environment: 'test',
  })
  assert.equal(protectedField.items[0]?.error_code, 'IDENTITY_FIELD_FORBIDDEN')

  const facts = await pool.query<{
    event_count: number
    completion_count: number
    receipt_count: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM analytics.events WHERE event_id=ANY($1::uuid[])) AS event_count,
       (SELECT count(*)::int FROM ops.outbox_events
        WHERE aggregate_id=$2 AND event_name='comparison_completed') AS completion_count,
       (SELECT count(*)::int FROM analytics.ingest_receipts
        WHERE receipt_id=ANY($3::uuid[])) AS receipt_count`,
    [
      eventIds,
      comparisonId,
      [accepted.receipt_id, replayed.receipt_id, crossed.receipt_id, protectedField.receipt_id],
    ],
  )
  assert.deepEqual(facts.rows[0], { event_count: 4, completion_count: 1, receipt_count: 4 })
  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='analytics' AND table_name='events' AND column_name='user_id'`,
  )
  assert.equal(columns.rowCount, 0)
  await assert.rejects(
    pool.query('UPDATE analytics.events SET app_version=app_version WHERE event_id=$1', [eventIds[0]]),
    (error: unknown) => (error as { code?: string }).code === '55000',
  )
  process.stdout.write('analytics_fixture_ok events=4 completion=1 receipts=4\n')
} finally {
  await pool.end()
}
