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

export interface IdentityConfig {
  readonly enabled: boolean
  readonly cookieSecure: boolean
  readonly sessionTtlSeconds: number
  readonly otpTtlSeconds: number
  readonly otpResendSeconds: number
  readonly emailSendLimit: number
  readonly ipSendLimit: number
  readonly rateWindowSeconds: number
  readonly emailProvider: 'resend'
  readonly emailFrom: string
  readonly resendApiKey: string
  readonly emailEncryptionKey: string
  readonly emailEncryptionKeyVersion: string
  readonly emailHashPepper: string
  readonly otpPepper: string
  readonly authTokenSecret: string
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

function requiredSecret(name: string, value: string | undefined): string {
  const normalized = value?.trim() ?? ''
  if (normalized.length < 32) throw new Error(`CONFIG_${name}_REQUIRED`)
  return normalized
}

function encryptionKey(value: string | undefined): string {
  const normalized = requiredSecret('EMAIL_ENCRYPTION_KEY', value)
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== normalized) {
    throw new Error('CONFIG_EMAIL_ENCRYPTION_KEY_INVALID')
  }
  return normalized
}

export function loadIdentityConfig(
  env: NodeJS.ProcessEnv = process.env,
): IdentityConfig {
  const environment = parseEnvironment(env.NODE_ENV)
  const enabled = parseBoolean('AUTH_ENABLED', env.AUTH_ENABLED, false)
  const cookieSecure = parseBoolean(
    'AUTH_COOKIE_SECURE',
    env.AUTH_COOKIE_SECURE,
    environment === 'production',
  )

  if (environment === 'production' && enabled && !cookieSecure) {
    throw new Error('CONFIG_AUTH_COOKIE_INSECURE')
  }

  if (!enabled) {
    return Object.freeze({
      enabled,
      cookieSecure,
      sessionTtlSeconds: 2_592_000,
      otpTtlSeconds: 600,
      otpResendSeconds: 60,
      emailSendLimit: 5,
      ipSendLimit: 20,
      rateWindowSeconds: 900,
      emailProvider: 'resend',
      emailFrom: '',
      resendApiKey: '',
      emailEncryptionKey: '',
      emailEncryptionKeyVersion: '',
      emailHashPepper: '',
      otpPepper: '',
      authTokenSecret: '',
    })
  }

  if ((env.EMAIL_PROVIDER ?? 'resend') !== 'resend') {
    throw new Error('CONFIG_EMAIL_PROVIDER_INVALID')
  }
  const emailFrom = env.EMAIL_FROM?.trim() ?? ''
  if (!emailFrom || emailFrom.length > 320) throw new Error('CONFIG_EMAIL_FROM_REQUIRED')

  return Object.freeze({
    enabled,
    cookieSecure,
    sessionTtlSeconds: parseInteger(
      'AUTH_SESSION_TTL_SECONDS', env.AUTH_SESSION_TTL_SECONDS, 2_592_000, 3_600, 7_776_000,
    ),
    otpTtlSeconds: parseInteger('AUTH_OTP_TTL_SECONDS', env.AUTH_OTP_TTL_SECONDS, 600, 60, 900),
    otpResendSeconds: parseInteger(
      'AUTH_OTP_RESEND_SECONDS', env.AUTH_OTP_RESEND_SECONDS, 60, 30, 300,
    ),
    emailSendLimit: parseInteger('AUTH_EMAIL_SEND_LIMIT', env.AUTH_EMAIL_SEND_LIMIT, 5, 1, 20),
    ipSendLimit: parseInteger('AUTH_IP_SEND_LIMIT', env.AUTH_IP_SEND_LIMIT, 20, 1, 100),
    rateWindowSeconds: parseInteger(
      'AUTH_RATE_WINDOW_SECONDS', env.AUTH_RATE_WINDOW_SECONDS, 900, 60, 3_600,
    ),
    emailProvider: 'resend',
    emailFrom,
    resendApiKey: requiredSecret('RESEND_API_KEY', env.RESEND_API_KEY),
    emailEncryptionKey: encryptionKey(env.EMAIL_ENCRYPTION_KEY),
    emailEncryptionKeyVersion: requiredName(env.EMAIL_ENCRYPTION_KEY_VERSION ?? ''),
    emailHashPepper: requiredSecret('EMAIL_HASH_PEPPER', env.EMAIL_HASH_PEPPER),
    otpPepper: requiredSecret('OTP_PEPPER', env.OTP_PEPPER),
    authTokenSecret: requiredSecret('AUTH_TOKEN_SECRET', env.AUTH_TOKEN_SECRET),
  })
}
