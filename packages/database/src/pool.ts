import { Pool, type PoolConfig } from 'pg'

export interface DatabasePoolOptions {
  readonly connectionString: string
  readonly ssl: boolean
  readonly applicationName: string
  readonly maxConnections?: number
}

export function createDatabasePool(options: DatabasePoolOptions): Pool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  }

  if (options.ssl) {
    config.ssl = { rejectUnauthorized: true }
  }

  return new Pool(config)
}

export async function checkDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ ok: number }>('SELECT 1::int AS ok')
  if (result.rows[0]?.ok !== 1) throw new Error('DATABASE_READINESS_FAILED')
}
