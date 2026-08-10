import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadServiceConfig } from './index.js'

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
})
