import { loadServiceConfig } from '@vibecheck/config'
import { checkDatabase, createDatabasePool } from '@vibecheck/database'

import { close, createApiServer, listen } from './server.js'

const config = loadServiceConfig({ serviceName: 'vibecheck-api' })
if (config.databaseUrl === null) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = createDatabasePool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  applicationName: config.serviceName,
})
const server = createApiServer(config, {
  checkReadiness: () => checkDatabase(pool),
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
