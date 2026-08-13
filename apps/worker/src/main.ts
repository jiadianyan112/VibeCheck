import { randomUUID } from 'node:crypto'

import { loadServiceConfig } from '@vibecheck/config'
import { PostgresPublishedProjectIndexer } from '@vibecheck/catalog'
import { PostgresNotificationStore } from '@vibecheck/community'
import {
  claimOutboxEvents,
  createDatabasePool,
  markOutboxPublished,
  markOutboxRetry,
  requeueExpiredOutbox,
} from '@vibecheck/database'
import { PostgresWorkflowStore } from '@vibecheck/workflow'
import { PostgresSubmissionPublisher } from '@vibecheck/submission'

import { runWorkerCycle, type OutboxHandler, type OutboxStore } from './runtime.js'
import { createSubmissionPublicationHandler } from './submission-publication-handler.js'
import { createProjectPublishedHandler } from './project-published-handler.js'

const config = loadServiceConfig({ serviceName: 'vibecheck-worker' })
if (config.databaseUrl === null) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = createDatabasePool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  applicationName: config.serviceName,
  maxConnections: 5,
})
const workerId = `${config.serviceName}-${randomUUID()}`
const publisher = new PostgresSubmissionPublisher(pool)
const publishedProjectIndexer = new PostgresPublishedProjectIndexer(pool)
const notificationStore = new PostgresNotificationStore(pool)
const handlers = new Map<string, OutboxHandler>([
  ['submission_approved', createSubmissionPublicationHandler(publisher)],
  ['project_published', createProjectPublishedHandler(publishedProjectIndexer, notificationStore)],
])
const workflowStore = new PostgresWorkflowStore(pool)
const store: OutboxStore = {
  requeueExpired: () => requeueExpiredOutbox(pool),
  requeueExpiredReviewClaims: () => workflowStore.requeueExpiredClaims(
    new Date(), config.workerBatchSize,
  ),
  claim: (id, eventNames, limit) => claimOutboxEvents(pool, id, eventNames, limit),
  markPublished: (outboxId) => markOutboxPublished(pool, outboxId),
  markRetry: (outboxId, code) => markOutboxRetry(pool, outboxId, code),
}

let stopping = false

async function cycle(): Promise<void> {
  try {
    const result = await runWorkerCycle(store, workerId, handlers, config.workerBatchSize)
    if (result.requeued > 0 || result.reviewClaimsRequeued > 0 || result.claimed > 0) {
      console.info(
        JSON.stringify({
          level: 'info',
          service: config.serviceName,
          message: 'worker_cycle_completed',
          ...result,
        }),
      )
    }
  } catch {
    console.error(
      JSON.stringify({
        level: 'error',
        service: config.serviceName,
        error_code: 'WORKER_CYCLE_FAILED',
      }),
    )
  }
}

async function run(): Promise<void> {
  console.info(
    JSON.stringify({
      level: 'info',
      service: config.serviceName,
      message: 'worker_started',
      registered_event_count: handlers.size,
    }),
  )
  while (!stopping) {
    await cycle()
    await new Promise<void>((resolve) => setTimeout(resolve, config.workerPollIntervalMs))
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true
    console.info(JSON.stringify({ level: 'info', service: config.serviceName, signal }))
  })
}

await run()
await pool.end()
