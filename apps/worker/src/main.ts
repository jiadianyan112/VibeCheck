import { randomUUID } from 'node:crypto'

import { loadPrivateMaterialConfig, loadServiceConfig } from '@vibecheck/config'
import {
  PostgresPublishedProjectIndexer,
  PostgresProjectUpdateApplier,
  PostgresUpdatedProjectIndexer,
  validateLinkPermissionProfileDeployment,
} from '@vibecheck/catalog'
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
import {
  AwsS3PrivateMaterialStorage,
  PostgresPrivateMaterialScanStore,
  PrivateMaterialScanProcessor,
  createPrivateMaterialStorageKeyResolver,
  PostgresPrivateMaterialAccessRevoker,
} from '@vibecheck/private-material'

import { runWorkerCycle, type OutboxHandler, type OutboxStore } from './runtime.js'
import { createSubmissionPublicationHandler } from './submission-publication-handler.js'
import { createProjectPublishedHandler } from './project-published-handler.js'
import { createProjectUpdateApplicationHandler } from './project-update-application-handler.js'
import { createProjectUpdatedHandler } from './project-updated-handler.js'
import { createPrivateMaterialScanHandler } from './private-material-scan-handler.js'
import { createPrivateMaterialAccessRevokeHandler } from './private-material-access-revoke-handler.js'

const config = loadServiceConfig({ serviceName: 'vibecheck-worker' })
const privateMaterialConfig = loadPrivateMaterialConfig()
if (config.databaseUrl === null) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = createDatabasePool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  applicationName: config.serviceName,
  maxConnections: 5,
})
await validateLinkPermissionProfileDeployment(pool)
const workerId = `${config.serviceName}-${randomUUID()}`
const publisher = new PostgresSubmissionPublisher(pool)
const projectUpdateApplier = new PostgresProjectUpdateApplier(pool)
const publishedProjectIndexer = new PostgresPublishedProjectIndexer(pool)
const updatedProjectIndexer = new PostgresUpdatedProjectIndexer(pool)
const notificationStore = new PostgresNotificationStore(pool)
const handlers = new Map<string, OutboxHandler>([
  ['submission_approved', createSubmissionPublicationHandler(publisher)],
  ['project_update_approved', createProjectUpdateApplicationHandler(projectUpdateApplier)],
  ['project_published', createProjectPublishedHandler(publishedProjectIndexer, notificationStore)],
  ['project_updated', createProjectUpdatedHandler(updatedProjectIndexer, notificationStore)],
])
const privateMaterialStorage = privateMaterialConfig.enabled
  ? new AwsS3PrivateMaterialStorage({
      region: privateMaterialConfig.awsRegion,
      bucket: privateMaterialConfig.bucket,
      objectPrefix: privateMaterialConfig.objectPrefix,
    })
  : undefined
const privateMaterialScanStore = privateMaterialConfig.enabled
  ? new PostgresPrivateMaterialScanStore(pool)
  : undefined
if (privateMaterialStorage && privateMaterialScanStore) {
  const resolveStorageKey=createPrivateMaterialStorageKeyResolver({
    encryptionKeyBase64:privateMaterialConfig.encryptionMasterKey,
    encryptionKeyVersion:privateMaterialConfig.encryptionKeyVersion,
  })
  handlers.set(
    'verification_material_scan_requested',
    createPrivateMaterialScanHandler(new PrivateMaterialScanProcessor({
      store: privateMaterialScanStore,
      scanner: privateMaterialStorage,
      storage: privateMaterialStorage,
      resolveStorageKey,
    })),
  )
  handlers.set('verification_material_access_revoke_requested',
    createPrivateMaterialAccessRevokeHandler(new PostgresPrivateMaterialAccessRevoker({
      pool,storage:privateMaterialStorage,resolveStorageKey,
    })))
}
const workflowStore = new PostgresWorkflowStore(pool)
let nextPrivateMaterialSweepAt = 0
const store: OutboxStore = {
  requeueExpired: () => requeueExpiredOutbox(pool),
  requeueExpiredReviewClaims: () => workflowStore.requeueExpiredClaims(
    new Date(), config.workerBatchSize,
  ),
  ...(privateMaterialScanStore
    ? {
        sweepPrivateMaterials: async () => {
          const now = new Date()
          if (now.getTime()<nextPrivateMaterialSweepAt) return 0
          nextPrivateMaterialSweepAt = now.getTime()+60_000
          return privateMaterialScanStore.sweepExpired(now, config.workerBatchSize)
        },
      }
    : {}),
  claim: (id, eventNames, limit) => claimOutboxEvents(pool, id, eventNames, limit),
  markPublished: (outboxId) => markOutboxPublished(pool, outboxId),
  markRetry: (outboxId, code) => markOutboxRetry(pool, outboxId, code),
}

let stopping = false

async function cycle(): Promise<void> {
  try {
    const result = await runWorkerCycle(store, workerId, handlers, config.workerBatchSize)
    if (
      result.requeued > 0 || result.reviewClaimsRequeued > 0 ||
      result.privateMaterialsSwept > 0 || result.claimed > 0
    ) {
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
