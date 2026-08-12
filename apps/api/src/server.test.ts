import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type {
  AssetPage,
  AssetResolutionCommand,
  AssetResolutionProjection,
  CreatorProjection,
  EventPage,
  ProjectListProjection,
  ProjectProjection,
} from '@vibecheck/catalog'
import type { ServiceConfig } from '@vibecheck/config'
import type {
  SessionProjection,
  StartChallengeCommand,
  VerifyChallengeCommand,
} from '@vibecheck/identity'
import type { SearchCommand, SearchProjection, SearchSubject } from '@vibecheck/search'

import {
  close,
  createApiServer,
  type ApiCatalogService,
  type ApiAssetResolutionService,
  type ApiIdentityService,
  type ApiSearchService,
} from './server.js'

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
  catalog?: ApiCatalogService,
  search?: ApiSearchService,
  assetResolver?: ApiAssetResolutionService,
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
        }
      : {}),
    ...((identity || search || assetResolver)
      ? { anonymousCookieSecret: 'test-anonymous-cookie-secret-at-least-32-bytes' }
      : {}),
    ...(staticDirectory ? { staticDirectory } : {}),
    ...(catalog
      ? {
          catalog,
          catalogDefaultPageSize: 24,
          catalogMaximumPageSize: 50,
        }
      : {}),
    ...(search ? { search } : {}),
    ...(assetResolver ? { assetResolver } : {}),
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

class FakeSearchService implements ApiSearchService {
  command: SearchCommand | null = null
  subject: SearchSubject | null = null
  lifecycleSubject: SearchSubject | null = null

  async search(command: SearchCommand, subject: SearchSubject): Promise<SearchProjection> {
    this.command = command
    this.subject = subject
    return Object.freeze({
      query_id: '90000000-0000-4000-8000-000000000001',
      intent_version: 1,
      parser_version: 'keyword.v1',
      result_version: '91000000-0000-4000-8000-000000000001',
      ranking_version: 'search.keyword.v1',
      mode: 'search',
      category_id: 'personal_site_portfolio',
      filters: Object.freeze({
        access_status: Object.freeze([]),
        has_available_asset: null,
        verified_since: null,
        category_fields: Object.freeze({}),
        exclude_category_fields: Object.freeze({}),
      }),
      sort: 'relevance',
      semantic_degraded: true,
      exact_count: 0,
      adjacent_count: 0,
      groups: Object.freeze([]),
      next_cursor: null,
      expires_at: '2026-08-11T00:00:00.000Z',
    })
  }


  async getQuerySnapshot(queryId: string, subject: SearchSubject) {
    this.lifecycleSubject = subject
    return Object.freeze({
      query_id: queryId,
      mode: 'search' as const,
      category_id: 'personal_site_portfolio' as const,
      intent: Object.freeze({ mode: 'search' }),
      confidence: Object.freeze({ overall: 'not_applicable' }),
      intent_version: 1,
      parser_version: 'keyword.v1',
      result_version: '91000000-0000-4000-8000-000000000001',
      ranking_version: 'search.keyword.v1',
      filters: Object.freeze({
        access_status: Object.freeze([]),
        has_available_asset: null,
        verified_since: null,
        category_fields: Object.freeze({}),
        exclude_category_fields: Object.freeze({}),
      }),
      sort: 'relevance' as const,
      semantic_degraded: true,
      exact_count: 0,
      adjacent_count: 0,
      version: 1,
      expires_at: '2026-08-11T00:00:00.000Z',
      input_state: 'not_restored' as const,
      notice_key: 'search.conditions_restored' as const,
    })
  }

  async linkQuery(_queryId: string, _command: unknown, subject: SearchSubject) {
    this.lifecycleSubject = subject
    return Object.freeze({
      authorized: true as const,
      version: 2,
      expires_at: '2026-08-11T00:00:00.000Z',
    })
  }

  async unlinkQuery(_queryId: string, _command: unknown, subject: SearchSubject) {
    this.lifecycleSubject = subject
  }
  async invalidateQuery(_queryId: string, _command: unknown, subject: SearchSubject) {
    this.lifecycleSubject = subject
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

test('search creates a signed anonymous subject and never echoes raw query text', async () => {
  const search = new FakeSearchService()
  const runtime = await start(async () => undefined, undefined, undefined, undefined, search)
  try {
    const response = await fetch(`${runtime.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({
        query: 'private raw query text',
        mode: 'search',
        category_id: 'personal_site_portfolio',
        filters: {},
        sort: 'relevance',
      }),
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie') ?? '', /vc_anon=/)
    assert.equal(search.command?.query, 'private raw query text')
    assert.equal(search.subject?.kind, 'anonymous')
    assert.match(search.subject?.id ?? '', /^[0-9a-f-]{36}$/)
    assert.equal(JSON.stringify(await response.json()).includes('private raw query text'), false)
  } finally {
    await runtime.stop()
  }
})

test('search rejects cross-origin creation before invoking the search service', async () => {
  const search = new FakeSearchService()
  const runtime = await start(async () => undefined, undefined, undefined, undefined, search)
  try {
    const response = await fetch(`${runtime.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ query: 'portfolio', mode: 'search' }),
    })
    assert.equal(response.status, 403)
    assert.equal(search.command, null)
  } finally {
    await runtime.stop()
  }
})

class FakeAssetResolutionService implements ApiAssetResolutionService {
  command: AssetResolutionCommand | null = null

  getCommand(): AssetResolutionCommand | null {
    return this.command
  }

  async resolve(command: AssetResolutionCommand): Promise<AssetResolutionProjection> {
    this.command = command
    return Object.freeze({
      attempt_id: command.attemptId,
      asset_id: command.assetId,
      project_id: '22222222-2222-4222-8222-222222222222',
      target_kind: command.targetKind ?? 'safe_web_url',
      result: 'allowed',
      safe_web_url: command.targetKind === 'contact_uri' ? null : 'https://example.com/resource',
      contact_uri: command.targetKind === 'contact_uri' ? 'mailto:team@example.com' : null,
      target_domain: command.targetKind === 'contact_uri' ? null : 'example.com',
      reason_code: null,
      redirect_count: 0,
      checked_at: '2026-08-10T00:00:00.000Z',
      expires_at: '2026-08-10T00:05:00.000Z',
    })
  }
}

test('asset resolve binds an anonymous subject, returns no-store, and validates mutation origin first', async () => {
  const resolver = new FakeAssetResolutionService()
  const runtime = await start(
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    resolver,
  )
  const assetId = '11111111-1111-4111-8111-111111111111'
  const attemptId = '22222222-2222-4222-8222-222222222223'
  try {
    const rejected = await fetch(`${runtime.baseUrl}/api/v1/assets/${assetId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ attempt_id: attemptId }),
    })
    assert.equal(rejected.status, 403)
    assert.equal(resolver.command, null)

    const resolved = await fetch(`${runtime.baseUrl}/api/v1/assets/${assetId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({ attempt_id: attemptId, target_kind: 'safe_web_url' }),
    })
    assert.equal(resolved.status, 200)
    assert.equal(resolved.headers.get('cache-control'), 'no-store')
    assert.match(resolved.headers.get('set-cookie') ?? '', /vc_anon=/)
    assert.equal((await resolved.json() as { result: string }).result, 'allowed')
    const captured = resolver.getCommand()
    assert.ok(captured)
    assert.equal(captured.assetId, assetId)
    assert.equal(captured.attemptId, attemptId)
    assert.equal(captured.targetKind, 'safe_web_url')
    assert.equal(captured.subject.kind, 'anonymous')

    for (const body of [
      { attempt_id: attemptId, target_kind: 'file' },
      { attempt_id: attemptId, unexpected: true },
      { target_kind: 'safe_web_url' },
    ]) {
      const invalid = await fetch(`${runtime.baseUrl}/api/v1/assets/${assetId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://web.example' },
        body: JSON.stringify(body),
      })
      assert.equal(invalid.status, 422)
    }
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
      identityLinks: [{
        identityLinkId: '99999999-9999-4999-8999-999999999999',
        purpose: 'query_continuation',
        expiresAt: '2026-08-10T00:05:00.000Z',
      }] as const,
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

test('search binds an active authenticated session to the user subject', async () => {
  const search = new FakeSearchService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    search,
  )
  try {
    const response = await fetch(`${runtime.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
      },
      body: JSON.stringify({ query: 'portfolio', mode: 'search' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(search.subject, { kind: 'user', id: session.userId })
  } finally {
    await runtime.stop()
  }
})

test('query lifecycle exposes structured recovery and enforces session CSRF on identity linking', async () => {
  const search = new FakeSearchService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    search,
  )
  const queryId = '90000000-0000-4000-8000-000000000001'
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  try {
    const recovered = await fetch(`${runtime.baseUrl}/api/v1/query-snapshots/${queryId}`, {
      headers: { cookie: sessionCookie },
    })
    assert.equal(recovered.status, 200)
    const recovery = await recovered.json() as Record<string, unknown>
    assert.equal(recovery.input_state, 'not_restored')
    assert.equal('query' in recovery, false)
    assert.deepEqual(search.lifecycleSubject, { kind: 'user', id: session.userId })

    const rejected = await fetch(
      `${runtime.baseUrl}/api/v1/query-snapshots/${queryId}/authorized-subjects`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
        },
        body: JSON.stringify({
          identity_link_id: '99999999-9999-4999-8999-999999999999',
          expected_version: 1,
          operation_id: '98000000-0000-4000-8000-000000000001',
        }),
      },
    )
    assert.equal(rejected.status, 403)

    const linked = await fetch(
      `${runtime.baseUrl}/api/v1/query-snapshots/${queryId}/authorized-subjects`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
          'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
        },
        body: JSON.stringify({
          identity_link_id: '99999999-9999-4999-8999-999999999999',
          expected_version: 1,
          operation_id: '98000000-0000-4000-8000-000000000001',
        }),
      },
    )
    assert.equal(linked.status, 200)
    assert.equal((await linked.json() as { authorized: boolean }).authorized, true)
  } finally {
    await runtime.stop()
  }
})

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
    const verificationBody = await verification.json() as {
      purpose: string
      identity_links: readonly { identity_link_id: string; purpose: string; expires_at: string }[]
    }
    assert.equal(verificationBody.purpose, 'login')
    assert.deepEqual(verificationBody.identity_links, [{
      identity_link_id: '99999999-9999-4999-8999-999999999999',
      purpose: 'query_continuation',
      expires_at: '2026-08-10T00:05:00.000Z',
    }])
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

const projectCard = Object.freeze({
  project_id: '11111111-1111-4111-8111-111111111111',
  version_id: '22222222-2222-4222-8222-222222222222',
  current_name: 'Fixture Project',
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  one_line_definition: '把资料转换为练习内容',
  cover_media_reference_ids: Object.freeze(['cover-reference']),
  access_status: 'normal',
  review_status: 'published_platform',
  last_verified_at: '2026-08-10T00:00:00.000Z',
  creator_summaries: Object.freeze([]),
  ai_coding_tools: Object.freeze({
    knowledge_state: 'unknown',
    values: Object.freeze([]),
    source_type: 'system_inference',
    observed_at: '2026-08-10T00:00:00.000Z',
  }),
  interaction_summary: Object.freeze({
    favorite_count: 0,
    like_count: 0,
    follower_count: 0,
    visible_comment_count: 0,
  }),
  latest_event_summary: null,
  read_version: 1,
} as const)

class FakeCatalogService implements ApiCatalogService {
  listInput: Parameters<ApiCatalogService['listProjects']>[0] | null = null
  eventInput: Parameters<ApiCatalogService['listProjectEvents']>[0] | null = null
  assetInput: Parameters<ApiCatalogService['listProjectAssets']>[0] | null = null

  async listProjects(input: Parameters<ApiCatalogService['listProjects']>[0]): Promise<ProjectListProjection> {
    this.listInput = input
    return Object.freeze({
      items: Object.freeze([projectCard]),
      next_cursor: null,
      result_version: 'a'.repeat(64),
    })
  }

  async getProject(): Promise<ProjectProjection> {
    return Object.freeze({
      ...projectCard,
      viewer_schema: 'public',
      visibility: 'public',
      project_core: Object.freeze({
        current_name: 'Fixture Project',
        public_url: 'https://fixture.example.com',
        repository_url: null,
        original_platform: null,
        cover_media_reference_ids: Object.freeze(['cover-reference']),
        one_line_definition: '把资料转换为练习内容',
        ai_coding_tools: projectCard.ai_coding_tools,
        tech_stack: Object.freeze([]),
        deployment_platform: null,
        maintenance_signal: 'unknown',
        status_note: null,
      }),
      category_data: Object.freeze({
        target_users: Object.freeze(['university_students']),
        core_problem: '资料难以直接练习',
        use_scenarios: Object.freeze(['daily_practice']),
        main_inputs: Object.freeze(['pdf']),
        main_outputs: Object.freeze(['questions']),
        core_flow: Object.freeze([Object.freeze({ order: 1, name: '上传资料' })]),
        content_processing: Object.freeze([]),
        practice_formats: Object.freeze([]),
        feedback_methods: Object.freeze([]),
        learning_records: Object.freeze([]),
        differentiation: null,
        core_features: Object.freeze([]),
        secondary_features: Object.freeze([]),
        login_requirement: 'unknown',
        sharing_capability: 'unknown',
      }),
      first_seen_at: '2026-08-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
      author_link_status: 'unlinked',
      completeness_level: 'complete',
      freshness_status: 'valid',
      record_source: 'platform_editor',
      evidence_summaries: Object.freeze([]),
      relations: Object.freeze([]),
    })
  }

  async listProjectEvents(input: Parameters<ApiCatalogService['listProjectEvents']>[0]): Promise<EventPage> {
    this.eventInput = input
    return Object.freeze({
      items: Object.freeze([Object.freeze({
        event_id: '55555555-5555-4555-8555-555555555555',
        project_id: projectCard.project_id,
        version_id: projectCard.version_id,
        event_type: 'version_updated',
        category_change_type: null,
        event_time: '2026-08',
        time_precision: 'month',
        event_sort_at: '2026-08-01T00:00:00.000Z',
        event_sort_rule_version: 'event_sort.v1',
        event_summary: '更新练习流程',
        source_actor: 'verified_author',
        lifecycle_status: 'published',
        supersedes_event_id: null,
        evidence_summaries: Object.freeze([]),
        evidence_dispute_summary: 'none',
        project_summary: Object.freeze({
          project_id: projectCard.project_id,
          current_name: projectCard.current_name,
          category_id: projectCard.category_id,
          access_status: projectCard.access_status,
        }),
      })]),
      next_cursor: null,
    })
  }

  async listProjectAssets(input: Parameters<ApiCatalogService['listProjectAssets']>[0]): Promise<AssetPage> {
    this.assetInput = input
    return Object.freeze({
      items: Object.freeze([Object.freeze({
        asset_id: '66666666-6666-4666-8666-666666666666',
        project_id: projectCard.project_id,
        asset_type: 'source_code',
        component_role: null,
        name: '源码仓库',
        description: '公开源码',
        availability_status: 'available',
        license_type: 'MIT',
        price_type: 'free',
        acquisition_method: 'fork',
        target_kind: 'safe_web_url',
        target_status: 'requires_resolve',
        evidence_summaries: Object.freeze([]),
        last_verified_at: '2026-08-10T00:00:00.000Z',
        read_version: 1,
      })]),
      next_cursor: null,
    })
  }

  async getCreator(): Promise<CreatorProjection> {
    return Object.freeze({
      creator_id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Fixture Creator',
      avatar_url: null,
      verification_status: 'verified',
      viewer_schema: 'public',
      bio: '',
      contacts: Object.freeze([]),
      published_project_ids: Object.freeze([projectCard.project_id]),
      read_version: 1,
    })
  }
}

test('public catalog routes preserve list query state and emit versioned cache validators', async () => {
  const catalog = new FakeCatalogService()
  const runtime = await start(async () => undefined, undefined, undefined, catalog)
  try {
    const list = await fetch(`${runtime.baseUrl}/api/v1/projects?category_id=ai_learning_quiz&limit=12`)
    assert.equal(list.status, 200)
    assert.equal(list.headers.get('cache-control'), 'public, max-age=30, stale-while-revalidate=60')
    assert.deepEqual(catalog.listInput, {
      categoryId: 'ai_learning_quiz',
      limit: 12,
      cursor: null,
    })
    assert.equal((await list.json() as { items: unknown[] }).items.length, 1)

    const detail = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectCard.project_id}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.headers.get('etag'), `W/"project-${projectCard.project_id}-1"`)
    assert.equal((await detail.json() as { viewer_schema: string }).viewer_schema, 'public')

    const creator = await fetch(`${runtime.baseUrl}/api/v1/creators/33333333-3333-4333-8333-333333333333`)
    assert.equal(creator.status, 200)
    assert.equal(creator.headers.get('etag'), 'W/"creator-33333333-3333-4333-8333-333333333333-1"')

    const events = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectCard.project_id}/events?event_types=version_updated&include_superseded=true`)
    assert.equal(events.status, 200)
    assert.deepEqual(catalog.eventInput, {
      projectId: projectCard.project_id,
      eventTypes: ['version_updated'],
      includeSuperseded: true,
      cursor: null,
    })
    assert.equal((await events.json() as { items: unknown[] }).items.length, 1)

    const assets = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectCard.project_id}/assets`)
    assert.equal(assets.status, 200)
    assert.deepEqual(catalog.assetInput, { projectId: projectCard.project_id, cursor: null })
    assert.equal((await assets.json() as { items: unknown[] }).items.length, 1)
  } finally {
    await runtime.stop()
  }
})

test('public catalog routes reject duplicate, unknown and oversized pagination input', async () => {
  const runtime = await start(async () => undefined, undefined, undefined, new FakeCatalogService())
  try {
    for (const path of [
      '/api/v1/projects?limit=12&limit=13',
      '/api/v1/projects?unknown=true',
      '/api/v1/projects?limit=51',
    ]) {
      const response = await fetch(`${runtime.baseUrl}${path}`)
      assert.equal(response.status, 400)
      assert.match((await response.json() as { error: { code: string } }).error.code, /QUERY_PARAMETER_INVALID|LIMIT_INVALID/)
    }
  } finally {
    await runtime.stop()
  }
})

test('public event and asset routes reject malformed or duplicate query state', async () => {
  const runtime = await start(async () => undefined, undefined, undefined, new FakeCatalogService())
  const projectPath = `/api/v1/projects/${projectCard.project_id}`
  try {
    for (const path of [
      `${projectPath}/events?event_types=unknown`,
      `${projectPath}/events?event_types=version_updated,version_updated`,
      `${projectPath}/events?event_types=`,
      `${projectPath}/events?include_superseded=1`,
      `${projectPath}/events?cursor=a&cursor=b`,
      `${projectPath}/assets?unknown=true`,
    ]) {
      const response = await fetch(`${runtime.baseUrl}${path}`)
      assert.equal(response.status, 400)
    }
  } finally {
    await runtime.stop()
  }
})
