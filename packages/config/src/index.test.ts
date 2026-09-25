import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loadAnalyticsConfig,
  loadCatalogConfig,
  loadComparisonConfig,
  loadCommunityConfig,
  loadEvidenceConfig,
  loadIdentityConfig,
  loadMediaConfig,
  loadPrivateMaterialConfig,
  loadSearchConfig,
  loadServiceConfig,
  loadSubmissionConfig,
  loadWorkflowConfig,
} from './index.js'

interface R2MediaConfigProjection {
  readonly enabled: boolean
  readonly storageProvider: string
  readonly s3Endpoint: string
  readonly awsRegion: string
  readonly bucket: string
  readonly objectPrefix: string
}

function r2MediaConfig(value: ReturnType<typeof loadMediaConfig>): R2MediaConfigProjection {
  return value as unknown as R2MediaConfigProjection
}

describe('loadServiceConfig', () => {
  it('loads deterministic defaults for local services', () => {
    const config = loadServiceConfig(
      { serviceName: 'vibecheck-api' },
      {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/vibecheck',
        WEB_ORIGINS: 'http://localhost:5173',
      },
    )

    assert.equal(config.port, 3001)
    assert.equal(config.databaseSsl, false)
    assert.deepEqual(config.webOrigins, ['http://localhost:5173'])
  })

  it('rejects insecure production origins', () => {
    assert.throws(
      () =>
        loadServiceConfig(
          { serviceName: 'vibecheck-api' },
          {
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://db/vibecheck',
            WEB_ORIGINS: 'http://example.com',
          },
        ),
      /CONFIG_WEB_ORIGINS_INSECURE/,
    )
  })

  it('requires a database URL when the service uses persistence', () => {
    assert.throws(
      () => loadServiceConfig({ serviceName: 'vibecheck-worker' }, { NODE_ENV: 'test' }),
      /CONFIG_DATABASE_URL_REQUIRED/,
    )
  })

  it('uses the Render commit identifier when the portable key is absent', () => {
    const config = loadServiceConfig(
      { serviceName: 'vibecheck-api' },
      {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/vibecheck',
        RENDER_GIT_COMMIT: 'render-commit',
      },
    )
    assert.equal(config.gitCommit, 'render-commit')
  })

  it('keeps identity dependencies optional when authentication is disabled', () => {
    const config = loadIdentityConfig({ NODE_ENV: 'development', AUTH_ENABLED: 'false' })
    assert.equal(config.enabled, false)
    assert.equal(config.resendApiKey, '')
  })

  it('rejects insecure production authentication cookies', () => {
    assert.throws(
      () => loadIdentityConfig({
        NODE_ENV: 'production',
        AUTH_ENABLED: 'true',
        AUTH_COOKIE_SECURE: 'false',
      }),
      /CONFIG_AUTH_COOKIE_INSECURE/,
    )
  })

  it('loads a complete enabled email OTP configuration without storing production secrets', () => {
    const config = loadIdentityConfig({
      NODE_ENV: 'test',
      AUTH_ENABLED: 'true',
      AUTH_COOKIE_SECURE: 'false',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'VibeCheck <login@example.com>',
      RESEND_API_KEY: 'resend-key-at-least-thirty-two-characters',
      EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
      EMAIL_ENCRYPTION_KEY_VERSION: 'test-v1',
      EMAIL_HASH_PEPPER: 'email-hash-pepper-at-least-thirty-two-characters',
      OTP_PEPPER: 'otp-pepper-at-least-thirty-two-characters',
      AUTH_TOKEN_SECRET: 'auth-token-secret-at-least-thirty-two-characters',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.emailProvider, 'resend')
    assert.equal(config.otpTtlSeconds, 600)
    assert.equal(config.otpResendSeconds, 60)
  })

  it('keeps the catalog optional locally and validates signed cursor configuration when enabled', () => {
    assert.equal(loadCatalogConfig({ CATALOG_ENABLED: 'false' }).enabled, false)
    assert.throws(
      () => loadCatalogConfig({ CATALOG_ENABLED: 'true', CATALOG_CURSOR_SECRET: 'short' }),
      /CONFIG_CATALOG_CURSOR_SECRET_REQUIRED/,
    )
    const config = loadCatalogConfig({
      CATALOG_ENABLED: 'true',
      CATALOG_CURSOR_SECRET: 'catalog-cursor-secret-at-least-thirty-two-characters',
      CATALOG_DEFAULT_PAGE_SIZE: '20',
    })
    assert.equal(config.defaultPageSize, 20)
    assert.equal(config.maximumPageSize, 50)
  })

  it('keeps search optional and validates isolated search secrets when enabled', () => {
    assert.equal(loadSearchConfig({ SEARCH_ENABLED: 'false' }).enabled, false)
    assert.throws(
      () => loadSearchConfig({ SEARCH_ENABLED: 'true' }),
      /CONFIG_SEARCH_ENCRYPTION_MASTER_KEY_REQUIRED/,
    )
    const key = Buffer.alloc(32, 9).toString('base64')
    const config = loadSearchConfig({
      SEARCH_ENABLED: 'true',
      SEARCH_ENCRYPTION_MASTER_KEY: key,
      SEARCH_ENCRYPTION_KEY_VERSION: 'search-key-v1',
      SEARCH_SUBJECT_HASH_PEPPER: 'search-subject-hash-pepper-at-least-32-characters',
      SEARCH_RESULT_TOKEN_SECRET: 'search-result-token-secret-at-least-32-characters',
      SEARCH_SUBJECT_COOKIE_SECRET: 'search-subject-cookie-secret-at-least-32-characters',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.encryptionMasterKey, key)
    assert.equal(config.snapshotTtlSeconds, 86_400)
  })

  it('keeps comparison optional and requires isolated owner secrets when enabled', () => {
    assert.equal(loadComparisonConfig({ COMPARISON_ENABLED: 'false' }).enabled, false)
    assert.throws(
      () => loadComparisonConfig({ COMPARISON_ENABLED: 'true' }),
      /CONFIG_COMPARISON_SUBJECT_HASH_PEPPER_REQUIRED/,
    )
    const config = loadComparisonConfig({
      COMPARISON_ENABLED: 'true',
      COMPARISON_SUBJECT_HASH_PEPPER: 'comparison-subject-hash-pepper-at-least-32-characters',
      COMPARISON_SUBJECT_COOKIE_SECRET: 'comparison-subject-cookie-secret-at-least-32-characters',
      COMPARISON_ANONYMOUS_TTL_SECONDS: '604800',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.anonymousTtlSeconds, 604_800)
  })

  it('keeps community comments optional and validates isolated cursor/encryption secrets', () => {
    assert.equal(loadCommunityConfig({ COMMUNITY_ENABLED: 'false' }).enabled, false)
    assert.throws(
      () => loadCommunityConfig({ COMMUNITY_ENABLED: 'true' }),
      /CONFIG_COMMUNITY_CURSOR_SECRET_REQUIRED/,
    )
    const key = Buffer.alloc(32, 7).toString('base64')
    const config = loadCommunityConfig({
      COMMUNITY_ENABLED: 'true',
      COMMUNITY_CURSOR_SECRET: 'community-cursor-secret-at-least-thirty-two-characters',
      COMMUNITY_REPORT_ENCRYPTION_KEY: key,
      COMMUNITY_REPORT_ENCRYPTION_KEY_VERSION: 'community-v1',
      COMMUNITY_COMMENT_PAGE_SIZE: '15',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.reportEncryptionKey, key)
    assert.equal(config.commentPageSize, 15)
  })

  it('requires explicit analytics secrets and consent policy only when collection is enabled', () => {
    assert.equal(loadAnalyticsConfig({ ANALYTICS_ENABLED: 'false' }).enabled, false)
    assert.throws(
      () => loadAnalyticsConfig({ ANALYTICS_ENABLED: 'true' }),
      /CONFIG_ANALYTICS_CONSENT_STATE_REQUIRED/,
    )
    const config = loadAnalyticsConfig({
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_CONSENT_STATE: 'not_required',
      ANALYTICS_SESSION_SECRET: 'analytics-session-secret-at-least-thirty-two-characters',
      ANALYTICS_SUBJECT_HASH_PEPPER: 'analytics-subject-pepper-at-least-thirty-two-characters',
      ANALYTICS_SESSION_TTL_SECONDS: '3600',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.sessionTtlSeconds, 3_600)
    assert.equal(config.consentState, 'not_required')
  })

  it('keeps submission disabled by default and freezes the PRD URL-check TTL', () => {
    assert.equal(loadSubmissionConfig({}).enabled, false)
    const config = loadSubmissionConfig({
      SUBMISSION_ENABLED: 'true',
      SUBMISSION_URL_CHECK_TTL_SECONDS: '1800',
      SUBMISSION_DRAFT_TTL_SECONDS: '2592000',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.urlCheckTtlSeconds, 1_800)
    assert.equal(config.draftTtlSeconds, 2_592_000)
    assert.throws(
      () => loadSubmissionConfig({ SUBMISSION_URL_CHECK_TTL_SECONDS: '7200' }),
      /CONFIG_SUBMISSION_URL_CHECK_TTL_SECONDS_INVALID/,
    )
  })

  it('freezes the review lease and requires an isolated signed cursor secret', () => {
    assert.equal(loadWorkflowConfig({ REVIEW_WORKFLOW_ENABLED: 'false' }).enabled, false)
    assert.throws(
      () => loadWorkflowConfig({ REVIEW_WORKFLOW_ENABLED: 'true' }),
      /CONFIG_REVIEW_WORKFLOW_CURSOR_SECRET_REQUIRED/,
    )
    const config = loadWorkflowConfig({
      REVIEW_WORKFLOW_ENABLED: 'true',
      REVIEW_WORKFLOW_CURSOR_SECRET: 'review-workflow-cursor-secret-at-least-32-characters',
      REVIEW_WORKFLOW_LEASE_SECONDS: '60',
      REVIEW_WORKFLOW_MAXIMUM_CLAIM_SECONDS: '900',
    })
    assert.equal(config.enabled, true)
    assert.equal(config.leaseSeconds, 60)
    assert.equal(config.maximumClaimSeconds, 900)
    assert.throws(
      () => loadWorkflowConfig({ REVIEW_WORKFLOW_LEASE_SECONDS: '120' }),
      /CONFIG_REVIEW_WORKFLOW_LEASE_SECONDS_INVALID/,
    )
  })

  it('keeps media and evidence control planes disabled until explicitly enabled', () => {
    const disabledMedia = r2MediaConfig(loadMediaConfig({}))
    assert.equal(disabledMedia.enabled, false)
    assert.equal(disabledMedia.storageProvider, '')
    assert.equal(disabledMedia.s3Endpoint, '')
    assert.equal(disabledMedia.awsRegion, '')
    assert.equal(disabledMedia.bucket, '')
    assert.equal(disabledMedia.objectPrefix, 'public-media/')
    assert.equal(loadEvidenceConfig({}).enabled, false)
    assert.equal(loadEvidenceConfig({ EVIDENCE_ENABLED: 'true' }).enabled, true)
    assert.throws(() => loadMediaConfig({ MEDIA_ENABLED: 'yes' }), /CONFIG_MEDIA_ENABLED_INVALID/)
  })

  it('loads enabled R2 media configuration with the exact auto region and endpoint', () => {
    const config = r2MediaConfig(loadMediaConfig({
      MEDIA_ENABLED: 'true',
      MEDIA_STORAGE_PROVIDER: 'r2',
      MEDIA_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      MEDIA_AWS_REGION: 'auto',
      MEDIA_S3_BUCKET: 'vibecheck-media-test',
      MEDIA_S3_PREFIX: 'public-media/',
    }))

    assert.equal(config.enabled, true)
    assert.equal(config.storageProvider, 'r2')
    assert.equal(config.s3Endpoint, 'https://account.r2.cloudflarestorage.com')
    assert.equal(config.awsRegion, 'auto')
    assert.equal(config.bucket, 'vibecheck-media-test')
    assert.equal(config.objectPrefix, 'public-media/')
  })

  it('requires an HTTPS endpoint when enabled media uses R2', () => {
    assert.throws(
      () => loadMediaConfig({
        MEDIA_ENABLED: 'true', MEDIA_STORAGE_PROVIDER: 'r2', MEDIA_AWS_REGION: 'auto',
        MEDIA_S3_BUCKET: 'vibecheck-media-test', MEDIA_S3_PREFIX: 'public-media/',
      }),
      /CONFIG_MEDIA_S3_ENDPOINT_REQUIRED/,
    )
    assert.throws(
      () => loadMediaConfig({
        MEDIA_ENABLED: 'true', MEDIA_STORAGE_PROVIDER: 'r2',
        MEDIA_S3_ENDPOINT: 'http://account.r2.cloudflarestorage.com', MEDIA_AWS_REGION: 'auto',
        MEDIA_S3_BUCKET: 'vibecheck-media-test', MEDIA_S3_PREFIX: 'public-media/',
      }),
      /CONFIG_MEDIA_S3_ENDPOINT_INVALID/,
    )
  })

  it('rejects a non-auto media region and unsupported storage provider', () => {
    assert.throws(
      () => loadMediaConfig({
        MEDIA_ENABLED: 'true', MEDIA_STORAGE_PROVIDER: 'r2',
        MEDIA_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com', MEDIA_AWS_REGION: 'us-east-1',
        MEDIA_S3_BUCKET: 'vibecheck-media-test', MEDIA_S3_PREFIX: 'public-media/',
      }),
      /CONFIG_MEDIA_AWS_REGION_INVALID/,
    )
    assert.throws(
      () => loadMediaConfig({
        MEDIA_ENABLED: 'true', MEDIA_STORAGE_PROVIDER: 's3',
        MEDIA_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com', MEDIA_AWS_REGION: 'auto',
        MEDIA_S3_BUCKET: 'vibecheck-media-test', MEDIA_S3_PREFIX: 'public-media/',
      }),
      /CONFIG_MEDIA_STORAGE_PROVIDER_INVALID/,
    )
  })

  it('loads the private material AWS boundary only when fully configured', () => {
    assert.equal(loadPrivateMaterialConfig({}).enabled, false)
    assert.throws(
      () => loadPrivateMaterialConfig({ PRIVATE_MATERIAL_ENABLED: 'true' }),
      /CONFIG_PRIVATE_MATERIAL_AWS_REGION_REQUIRED/,
    )
    const config = loadPrivateMaterialConfig({
      PRIVATE_MATERIAL_ENABLED: 'true',
      PRIVATE_MATERIAL_AWS_REGION: 'ap-southeast-1',
      PRIVATE_MATERIAL_S3_BUCKET: 'vibecheck-private-material-test',
      PRIVATE_MATERIAL_S3_PREFIX: 'identity/verification',
      PRIVATE_MATERIAL_ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
      PRIVATE_MATERIAL_ENCRYPTION_KEY_VERSION: 'aws-v1',
    })
    assert.equal(config.objectPrefix, 'identity/verification/')
  })
})
