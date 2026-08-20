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

export interface CatalogConfig {
  readonly enabled: boolean
  readonly cursorSecret: string
  readonly defaultPageSize: number
  readonly maximumPageSize: number
}

export interface SearchConfig {
  readonly enabled: boolean
  readonly encryptionMasterKey: string
  readonly encryptionKeyVersion: string
  readonly subjectHashPepper: string
  readonly resultTokenSecret: string
  readonly subjectCookieSecret: string
  readonly snapshotTtlSeconds: number
  readonly pageSize: number
  readonly maximumStoredResults: number
  readonly rawQueryLimit: number
  readonly rawQueryRateWindowSeconds: number
}

export interface ComparisonConfig {
  readonly enabled: boolean
  readonly subjectHashPepper: string
  readonly subjectCookieSecret: string
  readonly anonymousTtlSeconds: number
  readonly maximumVisibleMsPerEvent: number
}

export interface CommunityConfig {
  readonly enabled: boolean
  readonly cursorSecret: string
  readonly reportEncryptionKey: string
  readonly reportEncryptionKeyVersion: string
  readonly commentPageSize: number
}

export interface AnalyticsConfig {
  readonly enabled: boolean
  readonly sessionSecret: string
  readonly subjectHashPepper: string
  readonly sessionTtlSeconds: number
  readonly consentState: 'granted' | 'not_required'
}

export interface SubmissionConfig {
  readonly enabled: boolean
  readonly urlCheckTtlSeconds: number
  readonly draftTtlSeconds: number
}

export interface WorkflowConfig {
  readonly enabled: boolean
  readonly cursorSecret: string
  readonly leaseSeconds: number
  readonly maximumClaimSeconds: number
  readonly queuePageSize: number
}

export interface MediaConfig {
  readonly enabled: boolean
}

export interface EvidenceConfig {
  readonly enabled: boolean
}

export interface PrivateMaterialConfig {
  readonly enabled: boolean
  readonly awsRegion: string
  readonly bucket: string
  readonly objectPrefix: string
  readonly encryptionMasterKey: string
  readonly encryptionKeyVersion: string
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

function base64Key(name: string, value: string | undefined): string {
  const normalized = requiredSecret(name, value)
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== normalized) {
    throw new Error(`CONFIG_${name}_INVALID`)
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

export function loadCatalogConfig(
  env: NodeJS.ProcessEnv = process.env,
): CatalogConfig {
  const enabled = parseBoolean('CATALOG_ENABLED', env.CATALOG_ENABLED, false)
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      cursorSecret: '',
      defaultPageSize: 24,
      maximumPageSize: 50,
    })
  }
  const maximumPageSize = parseInteger(
    'CATALOG_MAXIMUM_PAGE_SIZE', env.CATALOG_MAXIMUM_PAGE_SIZE, 50, 1, 100,
  )
  const defaultPageSize = parseInteger(
    'CATALOG_DEFAULT_PAGE_SIZE', env.CATALOG_DEFAULT_PAGE_SIZE, 24, 1, maximumPageSize,
  )
  return Object.freeze({
    enabled: true,
    cursorSecret: requiredSecret('CATALOG_CURSOR_SECRET', env.CATALOG_CURSOR_SECRET),
    defaultPageSize,
    maximumPageSize,
  })
}

export function loadSearchConfig(
  env: NodeJS.ProcessEnv = process.env,
): SearchConfig {
  const enabled = parseBoolean('SEARCH_ENABLED', env.SEARCH_ENABLED, false)
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      encryptionMasterKey: '',
      encryptionKeyVersion: '',
      subjectHashPepper: '',
      resultTokenSecret: '',
      subjectCookieSecret: '',
      snapshotTtlSeconds: 86_400,
      pageSize: 20,
      maximumStoredResults: 100,
      rawQueryLimit: 30,
      rawQueryRateWindowSeconds: 900,
    })
  }
  const pageSize = parseInteger('SEARCH_PAGE_SIZE', env.SEARCH_PAGE_SIZE, 20, 1, 50)
  return Object.freeze({
    enabled: true,
    encryptionMasterKey: base64Key('SEARCH_ENCRYPTION_MASTER_KEY', env.SEARCH_ENCRYPTION_MASTER_KEY),
    encryptionKeyVersion: requiredName(env.SEARCH_ENCRYPTION_KEY_VERSION ?? ''),
    subjectHashPepper: requiredSecret('SEARCH_SUBJECT_HASH_PEPPER', env.SEARCH_SUBJECT_HASH_PEPPER),
    resultTokenSecret: requiredSecret('SEARCH_RESULT_TOKEN_SECRET', env.SEARCH_RESULT_TOKEN_SECRET),
    subjectCookieSecret: requiredSecret('SEARCH_SUBJECT_COOKIE_SECRET', env.SEARCH_SUBJECT_COOKIE_SECRET),
    snapshotTtlSeconds: parseInteger(
      'SEARCH_SNAPSHOT_TTL_SECONDS', env.SEARCH_SNAPSHOT_TTL_SECONDS, 86_400, 60, 86_400,
    ),
    pageSize,
    maximumStoredResults: parseInteger(
      'SEARCH_MAXIMUM_STORED_RESULTS', env.SEARCH_MAXIMUM_STORED_RESULTS, 100, pageSize, 500,
    ),
    rawQueryLimit: parseInteger('SEARCH_RAW_QUERY_LIMIT', env.SEARCH_RAW_QUERY_LIMIT, 30, 1, 1_000),
    rawQueryRateWindowSeconds: parseInteger(
      'SEARCH_RAW_QUERY_RATE_WINDOW_SECONDS', env.SEARCH_RAW_QUERY_RATE_WINDOW_SECONDS,
      900, 60, 86_400,
    ),
  })
}

export function loadComparisonConfig(
  env: NodeJS.ProcessEnv = process.env,
): ComparisonConfig {
  const enabled = parseBoolean('COMPARISON_ENABLED', env.COMPARISON_ENABLED, false)
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      subjectHashPepper: '',
      subjectCookieSecret: '',
      anonymousTtlSeconds: 604_800,
      maximumVisibleMsPerEvent: 60_000,
    })
  }
  return Object.freeze({
    enabled: true,
    subjectHashPepper: requiredSecret(
      'COMPARISON_SUBJECT_HASH_PEPPER', env.COMPARISON_SUBJECT_HASH_PEPPER,
    ),
    subjectCookieSecret: requiredSecret(
      'COMPARISON_SUBJECT_COOKIE_SECRET', env.COMPARISON_SUBJECT_COOKIE_SECRET,
    ),
    anonymousTtlSeconds: parseInteger(
      'COMPARISON_ANONYMOUS_TTL_SECONDS', env.COMPARISON_ANONYMOUS_TTL_SECONDS,
      604_800, 3_600, 2_592_000,
    ),
    maximumVisibleMsPerEvent: parseInteger(
      'COMPARISON_MAXIMUM_VISIBLE_MS_PER_EVENT', env.COMPARISON_MAXIMUM_VISIBLE_MS_PER_EVENT,
      60_000, 1_000, 300_000,
    ),
  })
}

export function loadCommunityConfig(
  env: NodeJS.ProcessEnv = process.env,
): CommunityConfig {
  const enabled = parseBoolean('COMMUNITY_ENABLED', env.COMMUNITY_ENABLED, false)
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      cursorSecret: '',
      reportEncryptionKey: '',
      reportEncryptionKeyVersion: '',
      commentPageSize: 20,
    })
  }
  return Object.freeze({
    enabled: true,
    cursorSecret: requiredSecret('COMMUNITY_CURSOR_SECRET', env.COMMUNITY_CURSOR_SECRET),
    reportEncryptionKey: base64Key(
      'COMMUNITY_REPORT_ENCRYPTION_KEY', env.COMMUNITY_REPORT_ENCRYPTION_KEY,
    ),
    reportEncryptionKeyVersion: requiredName(
      env.COMMUNITY_REPORT_ENCRYPTION_KEY_VERSION ?? '',
    ),
    commentPageSize: parseInteger(
      'COMMUNITY_COMMENT_PAGE_SIZE', env.COMMUNITY_COMMENT_PAGE_SIZE, 20, 1, 50,
    ),
  })
}

export function loadAnalyticsConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsConfig {
  const enabled = parseBoolean('ANALYTICS_ENABLED', env.ANALYTICS_ENABLED, false)
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      sessionSecret: '',
      subjectHashPepper: '',
      sessionTtlSeconds: 86_400,
      consentState: 'not_required',
    })
  }
  const consentState = env.ANALYTICS_CONSENT_STATE
  if (consentState !== 'granted' && consentState !== 'not_required') {
    throw new Error('CONFIG_ANALYTICS_CONSENT_STATE_REQUIRED')
  }
  return Object.freeze({
    enabled: true,
    sessionSecret: requiredSecret('ANALYTICS_SESSION_SECRET', env.ANALYTICS_SESSION_SECRET),
    subjectHashPepper: requiredSecret(
      'ANALYTICS_SUBJECT_HASH_PEPPER', env.ANALYTICS_SUBJECT_HASH_PEPPER,
    ),
    sessionTtlSeconds: parseInteger(
      'ANALYTICS_SESSION_TTL_SECONDS', env.ANALYTICS_SESSION_TTL_SECONDS,
      86_400, 300, 604_800,
    ),
    consentState,
  })
}

export function loadSubmissionConfig(
  env: NodeJS.ProcessEnv = process.env,
): SubmissionConfig {
  const enabled = parseBoolean('SUBMISSION_ENABLED', env.SUBMISSION_ENABLED, false)
  return Object.freeze({
    enabled,
    urlCheckTtlSeconds: parseInteger(
      'SUBMISSION_URL_CHECK_TTL_SECONDS', env.SUBMISSION_URL_CHECK_TTL_SECONDS,
      1_800, 60, 3_600,
    ),
    draftTtlSeconds: parseInteger(
      'SUBMISSION_DRAFT_TTL_SECONDS', env.SUBMISSION_DRAFT_TTL_SECONDS,
      2_592_000, 86_400, 7_776_000,
    ),
  })
}

export function loadWorkflowConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkflowConfig {
  const enabled = parseBoolean('REVIEW_WORKFLOW_ENABLED', env.REVIEW_WORKFLOW_ENABLED, false)
  return Object.freeze({
    enabled,
    cursorSecret: enabled
      ? requiredSecret('REVIEW_WORKFLOW_CURSOR_SECRET', env.REVIEW_WORKFLOW_CURSOR_SECRET)
      : '',
    leaseSeconds: parseInteger(
      'REVIEW_WORKFLOW_LEASE_SECONDS', env.REVIEW_WORKFLOW_LEASE_SECONDS, 60, 60, 60,
    ),
    maximumClaimSeconds: parseInteger(
      'REVIEW_WORKFLOW_MAXIMUM_CLAIM_SECONDS', env.REVIEW_WORKFLOW_MAXIMUM_CLAIM_SECONDS,
      900, 60, 86_400,
    ),
    queuePageSize: parseInteger(
      'REVIEW_WORKFLOW_QUEUE_PAGE_SIZE', env.REVIEW_WORKFLOW_QUEUE_PAGE_SIZE, 25, 1, 50,
    ),
  })
}

export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  return Object.freeze({
    enabled: parseBoolean('MEDIA_ENABLED', env.MEDIA_ENABLED, false),
  })
}

export function loadEvidenceConfig(env: NodeJS.ProcessEnv = process.env): EvidenceConfig {
  return Object.freeze({
    enabled: parseBoolean('EVIDENCE_ENABLED', env.EVIDENCE_ENABLED, false),
  })
}

export function loadPrivateMaterialConfig(
  env: NodeJS.ProcessEnv = process.env,
): PrivateMaterialConfig {
  const enabled = parseBoolean('PRIVATE_MATERIAL_ENABLED', env.PRIVATE_MATERIAL_ENABLED, false)
  if (!enabled) return Object.freeze({
    enabled: false, awsRegion: '', bucket: '', objectPrefix: 'verification/',
    encryptionMasterKey: '', encryptionKeyVersion: '',
  })
  const awsRegion = env.PRIVATE_MATERIAL_AWS_REGION?.trim() ?? ''
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(awsRegion)) {
    throw new Error('CONFIG_PRIVATE_MATERIAL_AWS_REGION_REQUIRED')
  }
  const bucket = env.PRIVATE_MATERIAL_S3_BUCKET?.trim() ?? ''
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('CONFIG_PRIVATE_MATERIAL_S3_BUCKET_REQUIRED')
  }
  const rawPrefix = env.PRIVATE_MATERIAL_S3_PREFIX?.trim() || 'verification/'
  const objectPrefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,127}\/$/.test(objectPrefix) || objectPrefix.includes('//')) {
    throw new Error('CONFIG_PRIVATE_MATERIAL_S3_PREFIX_INVALID')
  }
  return Object.freeze({
    enabled: true, awsRegion, bucket, objectPrefix,
    encryptionMasterKey: base64Key(
      'PRIVATE_MATERIAL_ENCRYPTION_MASTER_KEY', env.PRIVATE_MATERIAL_ENCRYPTION_MASTER_KEY,
    ),
    encryptionKeyVersion: requiredName(env.PRIVATE_MATERIAL_ENCRYPTION_KEY_VERSION ?? ''),
  })
}
