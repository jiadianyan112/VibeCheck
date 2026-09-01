import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SubmissionUrlCheckClientError,
  createSubmissionUrlCheckClient,
  type SubmissionUrlCheck,
  type SubmissionUrlCheckRequest,
} from './submission-url-check-client.js'

const request: SubmissionUrlCheckRequest = {
  raw_url: 'https://example.test/work',
  category_hint: 'personal_site_portfolio',
  client_request_id: 'client-request-kept-01',
}

const projection: SubmissionUrlCheck = {
  check_id: '11111111-1111-4111-8111-111111111111',
  category_id: 'personal_site_portfolio',
  category_schema_version: 'portfolio.v1',
  input_hash: 'a'.repeat(64),
  canonical_url: 'https://example.test/work',
  redirect_chain: ['https://example.test/work'],
  risk_result: 'allowed',
  access_result: 'accessible',
  category_result: 'matched',
  duplicate_result: 'none',
  duplicate_candidates: [],
  risk_reasons: [],
  can_create_draft: true,
  checked_at: '2026-08-24T10:00:00.000Z',
  expires_at: '2026-08-24T10:30:00.000Z',
}

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'server-request-01' },
  })
}

function errorBody(code = 'URL_CHECK_REJECTED') {
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: 'server-request-01',
      retryable: code === 'UPSTREAM_UNAVAILABLE',
      retry_after_ms: code === 'UPSTREAM_UNAVAILABLE' ? 1500 : null,
      field_errors: [{ path: '/raw_url', code: 'invalid' }],
    },
  }
}

async function rejected(action: () => Promise<unknown>): Promise<SubmissionUrlCheckClientError> {
  try {
    await action()
    assert.fail('expected the request to reject')
  } catch (error) {
    assert.ok(error instanceof SubmissionUrlCheckClientError)
    return error
  }
}

describe('createSubmissionUrlCheckClient', () => {
  it('sends the exact request, browser credentials, CSRF, request id, and signal', async () => {
    const controller = new AbortController()
    let calls = 0
    let seenUrl: string | URL | undefined
    let seenInit: RequestInit | undefined
    const client = createSubmissionUrlCheckClient({
      baseUrl: 'https://api.example.test///',
      fetch: async (url, init) => {
        calls += 1
        seenUrl = url
        seenInit = init
        return jsonResponse(projection)
      },
      getCsrfToken: () => 'csrf-token-for-url-check',
      requestIdGenerator: () => 'request-id-from-test',
    })

    const result = await client.check(request, { signal: controller.signal })

    assert.deepEqual(result, projection)
    assert.equal(calls, 1)
    assert.equal(seenUrl, 'https://api.example.test/api/v1/submission-url-checks')
    assert.equal(seenInit?.method, 'POST')
    assert.equal(seenInit?.credentials, 'include')
    assert.equal(seenInit?.signal, controller.signal)
    assert.deepEqual(seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token-for-url-check',
      'X-Request-Id': 'request-id-from-test',
    })
    assert.deepEqual(JSON.parse(String(seenInit?.body)), request)
  })

  it('uses a same-origin relative URL by default and preserves the client request id', async () => {
    let seenUrl: string | URL | undefined
    let seenBody: SubmissionUrlCheckRequest | undefined
    const client = createSubmissionUrlCheckClient({
      fetch: async (url, init) => {
        seenUrl = url
        seenBody = JSON.parse(String(init?.body)) as SubmissionUrlCheckRequest
        return jsonResponse(projection)
      },
      getCsrfToken: async () => 'csrf-token-for-url-check',
      generateRequestId: () => 'generated-request-id',
    })

    await client.check(request)

    assert.equal(seenUrl, '/api/v1/submission-url-checks')
    assert.equal(seenBody?.client_request_id, request.client_request_id)
  })

  it('returns a strict 201 projection', async () => {
    const client = createSubmissionUrlCheckClient({
      fetch: async () => jsonResponse(projection, 201),
      getCsrfToken: () => 'csrf-token-for-url-check',
      requestIdGenerator: () => 'request-id-from-test',
    })
    assert.deepEqual(await client.check(request), projection)
  })

  for (const status of [401, 403, 409, 422, 503]) {
    it(`maps ${status} standard errors without losing stable fields`, async () => {
      const client = createSubmissionUrlCheckClient({
        fetch: async () => jsonResponse(errorBody(status === 503 ? 'UPSTREAM_UNAVAILABLE' : 'URL_CHECK_REJECTED'), status),
        getCsrfToken: () => 'csrf-token-for-url-check',
        requestIdGenerator: () => 'request-id-from-test',
      })

      const thrown = await rejected(() => client.check(request))
      assert.equal(thrown.kind, 'http')
      assert.equal(thrown.status, status)
      assert.equal(thrown.code, status === 503 ? 'UPSTREAM_UNAVAILABLE' : 'URL_CHECK_REJECTED')
      assert.equal(thrown.requestId, 'server-request-01')
      assert.equal(thrown.retryable, status === 503)
      assert.equal(thrown.retryAfterMs, status === 503 ? 1500 : null)
      assert.deepEqual(thrown.fieldErrors, [{ path: '/raw_url', code: 'invalid' }])
      assert.equal(thrown.request_id, thrown.requestId)
      assert.equal(thrown.retry_after_ms, thrown.retryAfterMs)
    })
  }

  it('maps a network failure to a stable transport error and does not retry', async () => {
    let calls = 0
    const client = createSubmissionUrlCheckClient({
      fetch: async () => {
        calls += 1
        throw new Error('offline')
      },
      getCsrfToken: () => 'csrf-token-for-url-check',
      requestIdGenerator: () => 'request-id-from-test',
    })

    const thrown = await rejected(() => client.check(request))
    assert.equal(thrown.kind, 'transport')
    assert.equal(thrown.code, 'TRANSPORT_NETWORK_ERROR')
    assert.equal(thrown.requestId, 'request-id-from-test')
    assert.equal(calls, 1)
  })

  it('maps non-JSON responses to a stable protocol error', async () => {
    const client = createSubmissionUrlCheckClient({
      fetch: async () => new Response('<html>gateway failure</html>', {
        status: 503,
        headers: { 'content-type': 'text/html', 'x-request-id': 'server-request-01' },
      }),
      getCsrfToken: () => 'csrf-token-for-url-check',
      requestIdGenerator: () => 'request-id-from-test',
    })

    const thrown = await rejected(() => client.check(request))
    assert.equal(thrown.kind, 'protocol')
    assert.equal(thrown.code, 'PROTOCOL_INVALID_RESPONSE')
    assert.equal(thrown.status, 503)
    assert.equal(thrown.requestId, 'server-request-01')
  })

  it('maps an invalid 201 projection to a stable protocol error', async () => {
    const client = createSubmissionUrlCheckClient({
      fetch: async () => jsonResponse({ ...projection, can_create_draft: 'yes' }),
      getCsrfToken: () => 'csrf-token-for-url-check',
      requestIdGenerator: () => 'request-id-from-test',
    })

    const thrown = await rejected(() => client.check(request))
    assert.equal(thrown.kind, 'protocol')
    assert.equal(thrown.code, 'PROTOCOL_INVALID_RESPONSE')
    assert.equal(thrown.status, 201)
  })
})
