import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ServiceConfig } from '@vibecheck/config'
import type {
  SessionProjection,
  StartChallengeCommand,
  VerifyChallengeCommand,
} from '@vibecheck/identity'

import { close, createApiServer, type ApiIdentityService } from './server.js'

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

async function start(
  checkReadiness: () => Promise<void>,
  identity?: ApiIdentityService,
  staticDirectory?: string,
): Promise<{
  readonly baseUrl: string
  readonly stop: () => Promise<void>
}> {
  const server = createApiServer(config, {
    checkReadiness,
    ...(identity
      ? {
          identity,
          authCookieSecure: false,
          anonymousCookieSecret: 'test-anonymous-cookie-secret-at-least-32-bytes',
        }
      : {}),
    ...(staticDirectory ? { staticDirectory } : {}),
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
      error: {
        code: 'ROUTE_NOT_FOUND',
        message_key: 'error.route_not_found',
        request_id: 'request_12345678',
        retryable: false,
        retry_after_ms: null,
      },
    })
  } finally {
    await runtime.stop()
  }
})

const session: SessionProjection = Object.freeze({
  authenticated: true,
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'u***@example.com',
  accountStatus: 'active',
  roles: Object.freeze(['user'] as const),
  primaryRole: 'user',
  permissions: Object.freeze(['profile:read', 'interaction:write'] as const),
  sessionVersion: 1,
  csrfToken: 'csrf-token-with-at-least-thirty-two-characters',
  recentAuthAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-09-09T00:00:00.000Z',
})

class FakeIdentityService implements ApiIdentityService {
  startCommand: StartChallengeCommand | null = null
  verifyCommand: VerifyChallengeCommand | null = null
  logoutVersion: number | null = null

  async startChallenge(command: StartChallengeCommand) {
    this.startCommand = command
    return {
      authFlowId: '22222222-2222-4222-8222-222222222222',
      challengeId: '33333333-3333-4333-8333-333333333333',
      expiresAt: '2026-08-10T00:10:00.000Z',
      resendAfter: '2026-08-10T00:01:00.000Z',
      maskedEmail: 'u***@example.com',
      browserBindingToken: 'browser-binding-token-with-at-least-32-characters',
    } as const
  }

  async verifyChallenge(command: VerifyChallengeCommand) {
    this.verifyCommand = command
    return {
      purpose: 'login',
      session,
      sessionToken: 'session-token-with-at-least-thirty-two-characters',
      returnTo: '/me',
    } as const
  }

  async getSession() {
    return session
  }

  async logout(
    _sessionToken: string | null,
    _csrfToken: string | null,
    expectedVersion: number,
  ) {
    this.logoutVersion = expectedVersion
  }
}

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`))
  assert(match?.[1])
  return decodeURIComponent(match[1])
}

test('email OTP flow establishes signed browser cookies and a server session', async () => {
  const identity = new FakeIdentityService()
  const runtime = await start(async () => undefined, identity)
  try {
    const challenge = await fetch(`${runtime.baseUrl}/api/v1/auth/email-challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({
        email: 'user@example.com',
        purpose: 'login',
        return_to: '/me',
        client_request_id: '44444444-4444-4444-8444-444444444444',
      }),
    })
    assert.equal(challenge.status, 202)
    assert.equal((await challenge.json() as { masked_email: string }).masked_email, 'u***@example.com')
    const challengeCookies = challenge.headers.get('set-cookie') ?? ''
    assert.match(challengeCookies, /vc_anon=/)
    assert.match(challengeCookies, /vc_auth_flow=/)
    assert.match(challengeCookies, /HttpOnly/)
    assert.match(challengeCookies, /SameSite=Lax/)
    assert.equal(identity.startCommand?.email, 'user@example.com')

    const browserBinding = cookieValue(challengeCookies, 'vc_auth_flow')
    const anonymous = cookieValue(challengeCookies, 'vc_anon')
    const verification = await fetch(
      `${runtime.baseUrl}/api/v1/auth/email-challenges/33333333-3333-4333-8333-333333333333/verify`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `vc_anon=${encodeURIComponent(anonymous)}; vc_auth_flow=${encodeURIComponent(browserBinding)}`,
          origin: 'https://web.example',
        },
        body: JSON.stringify({
          auth_flow_id: '22222222-2222-4222-8222-222222222222',
          otp: '123456',
          client_request_id: '55555555-5555-4555-8555-555555555555',
        }),
      },
    )
    assert.equal(verification.status, 200)
    assert.equal((await verification.json() as { purpose: string }).purpose, 'login')
    assert.equal(identity.verifyCommand?.browserBindingToken, browserBinding)
    const sessionCookies = verification.headers.get('set-cookie') ?? ''
    assert.match(sessionCookies, /vc_session=/)
    assert.match(sessionCookies, /vc_csrf=/)

    const current = await fetch(`${runtime.baseUrl}/api/v1/auth/session`, {
      headers: {
        cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
      },
    })
    assert.equal(current.status, 200)
    assert.equal((await current.json() as { user_id: string }).user_id, session.userId)

    const logout = await fetch(`${runtime.baseUrl}/api/v1/auth/session`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
        origin: 'https://web.example',
        'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
      },
      body: JSON.stringify({ session_version: 1 }),
    })
    assert.equal(logout.status, 204)
    assert.equal(identity.logoutVersion, 1)
  } finally {
    await runtime.stop()
  }
})

test('authentication writes reject missing Origin and unknown input fields', async () => {
  const identity = new FakeIdentityService()
  const runtime = await start(async () => undefined, identity)
  try {
    const missingOrigin = await fetch(`${runtime.baseUrl}/api/v1/auth/email-challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(missingOrigin.status, 403)

    const unknownField = await fetch(`${runtime.baseUrl}/api/v1/auth/email-challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({ unexpected: true }),
    })
    assert.equal(unknownField.status, 422)
    assert.equal(
      (await unknownField.json() as { error: { code: string } }).error.code,
      'REQUEST_FIELD_UNKNOWN',
    )
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

test('same-origin web hosting serves assets and falls back to the SPA entry document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecheck-static-'))
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>VibeCheck</title>')
  await writeFile(join(directory, 'app.js'), 'globalThis.vibecheck=true')
  const runtime = await start(async () => undefined, undefined, directory)
  try {
    const asset = await fetch(`${runtime.baseUrl}/app.js`)
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')

    const spa = await fetch(`${runtime.baseUrl}/project/example`)
    assert.equal(spa.status, 200)
    assert.match(await spa.text(), /VibeCheck/)
    assert.equal(spa.headers.get('cache-control'), 'no-store')
    assert.equal(spa.headers.get('x-frame-options'), 'DENY')
  } finally {
    await runtime.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
