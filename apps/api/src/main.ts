import {
  AssetResolutionService,
  AssetWebSafetyResolver,
  CatalogService,
  DefaultAssetDnsResolver,
  NodePinnedAssetHttpProbe,
  PostgresAssetResolutionStore,
  PostgresCatalogStore,
} from '@vibecheck/catalog'
import { ComparisonService, PostgresComparisonStore } from '@vibecheck/comparison'
import { CommunityService, PostgresCommunityStore } from '@vibecheck/community'
import {
  loadCatalogConfig,
  loadCommunityConfig,
  loadComparisonConfig,
  loadIdentityConfig,
  loadSearchConfig,
  loadServiceConfig,
} from '@vibecheck/config'
import { checkDatabase, createDatabasePool } from '@vibecheck/database'
import {
  IdentityService,
  PendingActionService,
  PostgresIdentityStore,
  PostgresPendingActionStore,
  ResendEmailSender,
} from '@vibecheck/identity'
import { PostgresSearchStore, SearchService } from '@vibecheck/search'
import { fileURLToPath } from 'node:url'

import { close, createApiServer, listen } from './server.js'
import { PendingActionExecutor } from './pending-action-executor.js'

const config = loadServiceConfig({ serviceName: 'vibecheck-api' })
const identityConfig = loadIdentityConfig()
const catalogConfig = loadCatalogConfig()
const comparisonConfig = loadComparisonConfig()
const searchConfig = loadSearchConfig()
const communityConfig = loadCommunityConfig()
if (config.databaseUrl === null) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = createDatabasePool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  applicationName: config.serviceName,
})
const community = communityConfig.enabled
  ? new CommunityService({
      store: new PostgresCommunityStore(pool),
      config: communityConfig,
    })
  : undefined
const comparison = comparisonConfig.enabled
  ? new ComparisonService({
      store: new PostgresComparisonStore(pool),
      config: comparisonConfig,
    })
  : undefined
const server = createApiServer(config, {
  checkReadiness: () => checkDatabase(pool),
  ...(community ? { community } : {}),
  staticDirectory: fileURLToPath(new URL('../../../dist', import.meta.url)),
  ...(catalogConfig.enabled
    ? {
        catalog: new CatalogService({
          store: new PostgresCatalogStore(pool),
          cursorSecret: catalogConfig.cursorSecret,
        }),
        assetResolver: new AssetResolutionService({
          store: new PostgresAssetResolutionStore(pool),
          webResolver: new AssetWebSafetyResolver(
            new DefaultAssetDnsResolver(),
            new NodePinnedAssetHttpProbe(),
          ),
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
