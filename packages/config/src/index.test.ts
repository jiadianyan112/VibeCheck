import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadCatalogConfig, loadIdentityConfig, loadSearchConfig, loadServiceConfig } from './index.js'

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
})
