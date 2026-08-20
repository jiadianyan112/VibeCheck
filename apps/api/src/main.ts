import {
  AnalyticsService,
  PostgresAnalyticsStore,
  type RecordComparisonDimensionInput,
} from '@vibecheck/analytics'
import {
  AssetResolutionService,
  AssetWebSafetyResolver,
  CatalogService,
  DefaultAssetDnsResolver,
  NodePinnedAssetHttpProbe,
  PostgresAuthorAuthorizationResolver,
  PostgresAssetResolutionStore,
  PostgresCatalogStore,
  PostgresProjectUpdateStore,
  ProjectUpdateService,
  validateLinkPermissionProfileDeployment,
} from '@vibecheck/catalog'
import { ComparisonError, ComparisonService, PostgresComparisonStore } from '@vibecheck/comparison'
import {
  CommunityService,
  NotificationService,
  PostgresCommunityStore,
  PostgresNotificationStore,
} from '@vibecheck/community'
import {
  loadAnalyticsConfig,
  loadCatalogConfig,
  loadCommunityConfig,
  loadComparisonConfig,
  loadEvidenceConfig,
  loadIdentityConfig,
  loadMediaConfig,
  loadPrivateMaterialConfig,
  loadSearchConfig,
  loadServiceConfig,
  loadSubmissionConfig,
  loadWorkflowConfig,
} from '@vibecheck/config'
import { checkDatabase, createDatabasePool } from '@vibecheck/database'
import { EvidenceService, PostgresEvidenceStore } from '@vibecheck/evidence'
import {
  IdentityService,
  PendingActionService,
  PostgresIdentityStore,
  PostgresPendingActionStore,
  ResendEmailSender,
} from '@vibecheck/identity'
import { MediaService, PostgresMediaStore } from '@vibecheck/media'
import {
  AwsS3PrivateMaterialStorage,
  PostgresPrivateMaterialStore,
  PrivateMaterialService,
} from '@vibecheck/private-material'
import { PostgresSearchStore, SearchService } from '@vibecheck/search'
import { PostgresSubmissionStore, SubmissionService } from '@vibecheck/submission'
import {
  AdminOperationSecurityService,
  PostgresAdminOperationSecurityStore,
  PostgresReviewDecisionStore,
  PostgresWorkflowStore,
  PostgresVerificationRequestStore,
  ReviewDecisionService,
  VerificationRequestService,
  WorkflowService,
} from '@vibecheck/workflow'
import { fileURLToPath } from 'node:url'

import { close, createApiServer, listen } from './server.js'
import { PendingActionExecutor } from './pending-action-executor.js'

const config = loadServiceConfig({ serviceName: 'vibecheck-api' })
const identityConfig = loadIdentityConfig()
const catalogConfig = loadCatalogConfig()
const comparisonConfig = loadComparisonConfig()
const searchConfig = loadSearchConfig()
const communityConfig = loadCommunityConfig()
const analyticsConfig = loadAnalyticsConfig()
const submissionConfig = loadSubmissionConfig()
const workflowConfig = loadWorkflowConfig()
const mediaConfig = loadMediaConfig()
const evidenceConfig = loadEvidenceConfig()
const privateMaterialConfig = loadPrivateMaterialConfig()
if (config.databaseUrl === null) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = createDatabasePool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  applicationName: config.serviceName,
})
await validateLinkPermissionProfileDeployment(pool)
const community = communityConfig.enabled
  ? new CommunityService({
      store: new PostgresCommunityStore(pool),
      config: communityConfig,
    })
  : undefined
const notifications = communityConfig.enabled
  ? new NotificationService(new PostgresNotificationStore(pool), communityConfig.cursorSecret)
  : undefined
const comparison = comparisonConfig.enabled
  ? new ComparisonService({
      store: new PostgresComparisonStore(pool),
      config: comparisonConfig,
    })
  : undefined
if (analyticsConfig.enabled && !comparison) {
  throw new Error('CONFIG_ANALYTICS_REQUIRES_COMPARISON')
}
const analytics = analyticsConfig.enabled && comparison
  ? new AnalyticsService({
      config: analyticsConfig,
      store: new PostgresAnalyticsStore(pool),
      eventHandler: {
        async recordComparisonDimension(input: RecordComparisonDimensionInput): Promise<void> {
          const current = await comparison.getComparison(input.comparisonId, input.subject)
          if (
            current.comparison_version !== input.comparisonVersion ||
            current.valid_count !== input.projectCount
          ) throw new ComparisonError('COMPARISON_PROJECT_COUNT_MISMATCH', 409)
          await comparison.recordDimensionProgress(input)
        },
      },
    })
  : undefined
if (submissionConfig.enabled && !identityConfig.enabled) {
  throw new Error('CONFIG_SUBMISSION_REQUIRES_IDENTITY')
}
const submissionWebResolver = new AssetWebSafetyResolver(
  new DefaultAssetDnsResolver(),
  new NodePinnedAssetHttpProbe(),
)
const submission = submissionConfig.enabled
  ? new SubmissionService({
      store: new PostgresSubmissionStore(pool),
      urlSafetyResolver: submissionWebResolver,
      config: submissionConfig,
    })
  : undefined
if ((mediaConfig.enabled || evidenceConfig.enabled) && !identityConfig.enabled) {
  throw new Error('CONFIG_MEDIA_EVIDENCE_REQUIRES_IDENTITY')
}
if (evidenceConfig.enabled && !submissionConfig.enabled) {
  throw new Error('CONFIG_EVIDENCE_REQUIRES_SUBMISSION')
}
const media = mediaConfig.enabled
  ? new MediaService(new PostgresMediaStore(pool))
  : undefined
const evidence = evidenceConfig.enabled
  ? new EvidenceService({
      store: new PostgresEvidenceStore(pool),
      urlSafetyResolver: submissionWebResolver,
    })
  : undefined
const authorAuthorization = catalogConfig.enabled
  ? new PostgresAuthorAuthorizationResolver(pool)
  : undefined
const projectUpdates = authorAuthorization
  ? new ProjectUpdateService({
      store: new PostgresProjectUpdateStore(pool),
      authorization: authorAuthorization,
    })
  : undefined
if (workflowConfig.enabled && !identityConfig.enabled) {
  throw new Error('CONFIG_REVIEW_WORKFLOW_REQUIRES_IDENTITY')
}
const workflow = workflowConfig.enabled
  ? new WorkflowService(new PostgresWorkflowStore(pool), workflowConfig)
  : undefined
const verificationRequests = workflowConfig.enabled
  ? new VerificationRequestService(new PostgresVerificationRequestStore(pool))
  : undefined
if (privateMaterialConfig.enabled && (!identityConfig.enabled || !workflowConfig.enabled)) {
  throw new Error('CONFIG_PRIVATE_MATERIAL_REQUIRES_IDENTITY_WORKFLOW')
}
const privateMaterials = privateMaterialConfig.enabled
  ? new PrivateMaterialService({
      store: new PostgresPrivateMaterialStore(pool),
      storage: new AwsS3PrivateMaterialStorage({
        region: privateMaterialConfig.awsRegion,
        bucket: privateMaterialConfig.bucket,
        objectPrefix: privateMaterialConfig.objectPrefix,
      }),
      crypto: {
        encryptionKeyBase64: privateMaterialConfig.encryptionMasterKey,
        encryptionKeyVersion: privateMaterialConfig.encryptionKeyVersion,
      },
    })
  : undefined
const adminOperations = workflowConfig.enabled
  ? new AdminOperationSecurityService(
      new PostgresAdminOperationSecurityStore(pool),
      {
        tokenSecret: workflowConfig.cursorSecret,
        authTokenSecret: identityConfig.authTokenSecret,
        previewTtlSeconds: 600,
        confirmTtlSeconds: 120,
        recentAuthWindowSeconds: 300,
      },
    )
  : undefined
const reviewDecisions = workflowConfig.enabled
  ? new ReviewDecisionService(
      new PostgresReviewDecisionStore(pool),
      {
        tokenSecret: workflowConfig.cursorSecret,
        authTokenSecret: identityConfig.authTokenSecret,
      },
    )
  : undefined
const server = createApiServer(config, {
  checkReadiness: () => checkDatabase(pool),
  ...(community ? { community } : {}),
  ...(notifications ? { notifications } : {}),
  ...(analytics ? { analytics } : {}),
  ...(submission ? { submission } : {}),
  ...(workflow ? { workflow } : {}),
  ...(verificationRequests ? { verificationRequests } : {}),
  ...(privateMaterials ? { privateMaterials } : {}),
  ...(adminOperations ? { adminOperations } : {}),
  ...(reviewDecisions ? { reviewDecisions } : {}),
  ...(media ? { media } : {}),
  ...(evidence ? { evidence } : {}),
  ...(projectUpdates ? { projectUpdates } : {}),
  staticDirectory: fileURLToPath(new URL('../../../dist', import.meta.url)),
  ...(catalogConfig.enabled
    ? {
        catalog: new CatalogService({
          store: new PostgresCatalogStore(pool),
          cursorSecret: catalogConfig.cursorSecret,
        }),
        assetResolver: new AssetResolutionService({
          store: new PostgresAssetResolutionStore(pool),
          webResolver: submissionWebResolver,
        }),
        catalogDefaultPageSize: catalogConfig.defaultPageSize,
        catalogMaximumPageSize: catalogConfig.maximumPageSize,
      }
    : {}),
  ...(identityConfig.enabled
    ? {
        identity: new IdentityService({
          config: identityConfig,
          store: new PostgresIdentityStore(pool),
          emailSender: new ResendEmailSender({
            resendApiKey: identityConfig.resendApiKey,
            emailFrom: identityConfig.emailFrom,
          }),
        }),
        pendingActions: new PendingActionService({
          config: identityConfig,
          store: new PostgresPendingActionStore(pool),
        }),
        pendingActionExecutor: new PendingActionExecutor({
          ...(community ? { community } : {}),
          ...(comparison ? { comparison } : {}),
        }),
        authCookieSecure: identityConfig.cookieSecure,
      }
    : {}),
  ...(searchConfig.enabled
    ? {
        search: new SearchService({
          store: new PostgresSearchStore(pool),
          config: searchConfig,
        }),
      }
    : {}),
  ...(comparison ? { comparison } : {}),
  ...((catalogConfig.enabled || comparisonConfig.enabled || searchConfig.enabled || identityConfig.enabled)
    ? {
        anonymousCookieSecret: searchConfig.enabled
          ? searchConfig.subjectCookieSecret
          : identityConfig.enabled
            ? identityConfig.authTokenSecret
            : comparisonConfig.enabled
              ? comparisonConfig.subjectCookieSecret
              : catalogConfig.cursorSecret,
      }
    : {}),
})

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.info(JSON.stringify({ level: 'info', service: config.serviceName, signal }))
  await close(server)
  await pool.end()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}

await listen(server, config)
console.info(
  JSON.stringify({
    level: 'info',
    service: config.serviceName,
    message: 'api_started',
    host: config.host,
    port: config.port,
  }),
)
