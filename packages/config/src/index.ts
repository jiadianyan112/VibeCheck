export type RuntimeEnvironment = 'development' | 'test' | 'production'
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface ServiceConfig {
  readonly serviceName: string
  readonly environment: RuntimeEnvironment
  readonly host: string
  readonly port: number
  readonly logLevel: LogLevel
  readonly databaseUrl: string | null
  readonly databaseSsl: boolean
  readonly webOrigins: readonly string[]
  readonly gitCommit: string
  readonly workerPollIntervalMs: number
  readonly workerBatchSize: number
}

export interface LoadConfigOptions {
  readonly serviceName: string
  readonly databaseRequired?: boolean
}

const environments = new Set<RuntimeEnvironment>([
  'development',
  'test',
  'production',
])

const logLevels = new Set<LogLevel>([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
])

function requiredName(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 64) {
    throw new Error('CONFIG_SERVICE_NAME_INVALID')
  }
  return normalized
}

function parseEnvironment(value: string | undefined): RuntimeEnvironment {
  const normalized = value ?? 'development'
  if (!environments.has(normalized as RuntimeEnvironment)) {
    throw new Error('CONFIG_NODE_ENV_INVALID')
  }
  return normalized as RuntimeEnvironment
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`CONFIG_${name}_INVALID`)
  }
  return parsed
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`CONFIG_${name}_INVALID`)
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value ?? 'info'
  if (!logLevels.has(normalized as LogLevel)) {
    throw new Error('CONFIG_LOG_LEVEL_INVALID')
  }
  return normalized as LogLevel
}

function parseOrigins(value: string | undefined, environment: RuntimeEnvironment): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  for (const origin of origins) {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('CONFIG_WEB_ORIGINS_INVALID')
    }
    if (environment === 'production' && parsed.protocol !== 'https:') {
      throw new Error('CONFIG_WEB_ORIGINS_INSECURE')
    }
  }

  return origins
}

export function loadServiceConfig(
  options: LoadConfigOptions,
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  const serviceName = requiredName(options.serviceName)
  const environment = parseEnvironment(env.NODE_ENV)
  const databaseUrl = env.DATABASE_URL?.trim() || null
  const databaseRequired = options.databaseRequired ?? true

  if (databaseRequired && databaseUrl === null) {
    throw new Error('CONFIG_DATABASE_URL_REQUIRED')
  }

  return Object.freeze({
    serviceName,
    environment,
    host: env.HOST?.trim() || '0.0.0.0',
    port: parseInteger('PORT', env.PORT, 3001, 1, 65_535),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    databaseUrl,
    databaseSsl: parseBoolean('DATABASE_SSL', env.DATABASE_SSL, environment === 'production'),
    webOrigins: Object.freeze(parseOrigins(env.WEB_ORIGINS, environment)),
    gitCommit: env.GIT_COMMIT?.trim() || env.RENDER_GIT_COMMIT?.trim() || 'unknown',
    workerPollIntervalMs: parseInteger(
      'WORKER_POLL_INTERVAL_MS',
      env.WORKER_POLL_INTERVAL_MS,
      1_000,
      100,
      60_000,
    ),
    workerBatchSize: parseInteger(
      'WORKER_BATCH_SIZE',
      env.WORKER_BATCH_SIZE,
      25,
      1,
      100,
    ),
  })
}
