import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'

import type { ServiceConfig } from '@vibecheck/config'

import { close, createApiServer } from './server.js'

const config: ServiceConfig = Object.freeze({
  serviceName: 'vibecheck-api',
  environment: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'fatal',
  databaseUrl: 'postgresql://unused',
  databaseSsl: false,
  webOrigins: Object.freeze(['https://web.example']),
  gitCommit: 'test-commit',
  workerPollIntervalMs: 1_000,
  workerBatchSize: 25,
})

async function start(checkReadiness: () => Promise<void>): Promise<{
  readonly baseUrl: string
  readonly stop: () => Promise<void>
}> {
  const server = createApiServer(config, {
    checkReadiness,
    now: () => new Date('2026-08-10T00:00:00.000Z'),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => close(server),
  }
}

test('live and ready endpoints expose deterministic health contracts', async () => {
  const runtime = await start(async () => undefined)
  try {
    const live = await fetch(`${runtime.baseUrl}/health/live`)
    assert.equal(live.status, 200)
    assert.deepEqual(await live.json(), {
      status: 'ok',
      service: 'vibecheck-api',
      version: '0.1.0',
      commit: 'test-commit',
      checked_at: '2026-08-10T00:00:00.000Z',
    })

    const ready = await fetch(`${runtime.baseUrl}/health/ready`)
    assert.equal(ready.status, 200)
    assert.deepEqual((await ready.json() as { checks: unknown }).checks, { database: 'ok' })
  } finally {
    await runtime.stop()
  }
})

test('readiness failure returns 503 without leaking the error', async () => {
  const runtime = await start(async () => {
    throw new Error('database password must stay private')
  })
  try {
    const response = await fetch(`${runtime.baseUrl}/health/ready`)
    assert.equal(response.status, 503)
    const body = await response.json() as { status: string; checks: unknown }
    assert.equal(body.status, 'degraded')
    assert.deepEqual(body.checks, { database: 'failed' })
  } finally {
    await runtime.stop()
  }
})

test('unknown routes return the standard error envelope', async () => {
  const runtime = await start(async () => undefined)
  try {
    const response = await fetch(`${runtime.baseUrl}/missing`, {
      headers: { 'x-request-id': 'request_12345678' },
    })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error_code: 'ROUTE_NOT_FOUND',
      message_key: 'error.route_not_found',
      request_id: 'request_12345678',
      retryable: false,
    })
  } finally {
    await runtime.stop()
  }
})

test('CORS preflight reflects only an explicitly configured web origin', async () => {
  const runtime = await start(async () => undefined)
  try {
    const allowed = await fetch(`${runtime.baseUrl}/api/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'https://web.example' },
    })
    assert.equal(allowed.status, 204)
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://web.example')
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')

    const denied = await fetch(`${runtime.baseUrl}/api/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example' },
    })
    assert.equal(denied.status, 204)
    assert.equal(denied.headers.get('access-control-allow-origin'), null)
  } finally {
    await runtime.stop()
  }
})
