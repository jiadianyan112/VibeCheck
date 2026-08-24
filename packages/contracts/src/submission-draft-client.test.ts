import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SubmissionDraftClient,
  SubmissionDraftClientError,
  createSubmissionDraftClient,
  type SubmissionDraft,
  type SubmissionDraftCreateRequest,
  type SubmissionDraftPatchRequest,
} from './submission-draft-client.js'

const draftId = '84000000-0000-4000-8000-000000000002'
const chainId = '84000000-0000-4000-8000-000000000003'
const checkId = '84000000-0000-4000-8000-000000000004'
const mediaId = '84000000-0000-4000-8000-000000000005'
const evidenceId = '84000000-0000-4000-8000-000000000006'

const createRequest: SubmissionDraftCreateRequest = {
  check_id: checkId,
  category_id: 'personal_site_portfolio',
  client_request_id: 'draft-create-request-01',
}

const patchRequest: SubmissionDraftPatchRequest = {
  expected_version: 3,
  patch: {
    project_core: {
      name: 'A preserved draft name',
    },
  },
  operation_id: 'draft-patch-operation-01',
}

const projection: SubmissionDraft = {
  draft_id: draftId,
  submission_chain_id: chainId,
  category_id: 'personal_site_portfolio',
  category_schema_version: 'portfolio.v1',
  check_id: checkId,
  draft_revision: 1,
  supersedes_draft_id: null,
  base_submission_id: null,
  payload_snapshot: {
    project_core: {
      name: 'A preserved draft name',
    },
  },
  media_reference_ids: [mediaId],
  evidence_draft_ids: [evidenceId],
  asset_drafts: [],
  status: 'editing',
  version: 3,
  created_at: '2026-08-24T10:00:00.000Z',
  updated_at: '2026-08-24T10:05:00.000Z',
  saved_at: '2026-08-24T10:05:00.000Z',
  expires_at: '2026-08-24T10:30:00.000Z',
}

function jsonResponse(body: unknown, status = 200, contentType = 'application/json; charset=utf-8'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': contentType,
      'x-request-id': 'server-request-01',
    },
  })
}

function errorBody(code = 'DRAFT_REQUEST_REJECTED', directFieldErrors = false) {
  const fieldErrors = [{ path: '/expected_version', code: 'conflict' }]
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: 'server-request-01',
      retryable: true,
      retry_after_ms: 1500,
      ...(directFieldErrors ? { field_errors: fieldErrors } : {}),
      details: {
        ...(directFieldErrors ? {} : { field_errors: fieldErrors }),
        conflict: {
          current_version: 4,
        },
        preserved: 'details are not discarded',
      },
    },
  }
}

async function rejected(action: () => Promise<unknown>): Promise<SubmissionDraftClientError> {
  try {
    await action()
    assert.fail('expected the request to reject')
  } catch (error) {
    if (!(error instanceof SubmissionDraftClientError)) throw error
    return error
  }
}

describe('SubmissionDraftClient', () => {
  it('sends the exact create request with credentials, CSRF, request id, signal, and a custom origin', async () => {
    const controller = new AbortController()
    let calls = 0
    let seenUrl: string | URL | undefined
    let seenInit: RequestInit | undefined
    let csrfCalls = 0
    const client = createSubmissionDraftClient({
      baseUrl: 'https://api.example.test///',
      fetch: async (url, init) => {
        calls += 1
        seenUrl = url
        seenInit = init
        return jsonResponse(projection, 201)
      },
      getCsrfToken: () => {
        csrfCalls += 1
        return 'csrf-token-for-draft'
      },
      requestIdGenerator: () => 'request-id-from-test',
    })

    assert.deepEqual(await client.create(createRequest, { signal: controller.signal }), projection)
    assert.equal(calls, 1)
    assert.equal(csrfCalls, 1)
    assert.equal(seenUrl, 'https://api.example.test/api/v1/submission-drafts')
    assert.equal(seenInit?.method, 'POST')
    assert.equal(seenInit?.credentials, 'include')
    assert.equal(seenInit?.signal, controller.signal)
    assert.deepEqual(seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token-for-draft',
      'X-Request-Id': 'request-id-from-test',
    })
    assert.deepEqual(JSON.parse(String(seenInit?.body)), createRequest)
  })

  it('uses the same-origin GET URL by default and omits CSRF and Content-Type', async () => {
    const controller = new AbortController()
    let seenUrl: string | URL | undefined
    let seenInit: RequestInit | undefined
    let csrfCalls = 0
    const client = new SubmissionDraftClient({
      fetch: async (url, init) => {
        seenUrl = url
        seenInit = init
        return jsonResponse(projection, 200)
      },
      getCsrfToken: () => {
        csrfCalls += 1
        return 'must-not-be-read-for-get'
      },
      generateRequestId: () => 'generated-request-id',
    })

    assert.deepEqual(await client.get(draftId, { signal: controller.signal }), projection)
    assert.equal(seenUrl, `/api/v1/submission-drafts/${draftId}`)
    assert.equal(seenInit?.method, 'GET')
    assert.equal(seenInit?.credentials, 'include')
    assert.equal(seenInit?.signal, controller.signal)
    assert.equal(seenInit?.body, undefined)
    assert.deepEqual(seenInit?.headers, {
      Accept: 'application/json',
      'X-Request-Id': 'generated-request-id',
    })
    assert.equal(csrfCalls, 0)
  })

  it('sends the exact patch request, preserves operation_id, and obtains CSRF per write', async () => {
    let calls = 0
    let seenUrl: string | URL | undefined
    let seenInit: RequestInit | undefined
    let csrfCalls = 0
    const client = createSubmissionDraftClient({
      baseUrl: new URL('http://api.example.test/'),
      fetch: async (url, init) => {
        calls += 1
        seenUrl = url
        seenInit = init
        return jsonResponse(projection, 200)
      },
      getCsrfToken: () => {
        csrfCalls += 1
        return `csrf-${csrfCalls}`
      },
      requestIdGenerator: () => 'patch-request-id',
    })

    assert.deepEqual(await client.patch(draftId, patchRequest), projection)
    assert.equal(calls, 1)
    assert.equal(csrfCalls, 1)
    assert.equal(seenUrl, `http://api.example.test/api/v1/submission-drafts/${draftId}`)
    assert.equal(seenInit?.method, 'PATCH')
    assert.equal(seenInit?.credentials, 'include')
    assert.deepEqual(seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
      'X-Request-Id': 'patch-request-id',
    })
    assert.deepEqual(JSON.parse(String(seenInit?.body)), patchRequest)
  })

  it('returns the strict create projection from status 201', async () => {
    const client = createSubmissionDraftClient({
      fetch: async () => jsonResponse(projection, 201),
      getCsrfToken: () => 'csrf-token-for-draft',
      requestIdGenerator: () => 'create-request-id',
    })
    assert.deepEqual(await client.create(createRequest), projection)
  })

  it('returns the strict get projection from status 200', async () => {
    const client = createSubmissionDraftClient({
      fetch: async () => jsonResponse(projection, 200),
      requestIdGenerator: () => 'get-request-id',
    })
    assert.deepEqual(await client.get(draftId), projection)
  })

  it('returns the strict patch projection from status 200', async () => {
    const client = createSubmissionDraftClient({
      fetch: async () => jsonResponse(projection, 200),
      getCsrfToken: () => 'csrf-token-for-draft',
      requestIdGenerator: () => 'patch-request-id',
    })
    assert.deepEqual(await client.patch(draftId, patchRequest), projection)
  })

  for (const status of [401, 403, 409, 410, 422]) {
    it(`preserves standard create error fields for ${status} without retrying`, async () => {
      const client = createSubmissionDraftClient({
        fetch: async () => jsonResponse(errorBody(status === 409 ? 'DRAFT_VERSION_CONFLICT' : 'DRAFT_REQUEST_REJECTED'), status),
        getCsrfToken: () => 'csrf-token-for-draft',
        requestIdGenerator: () => 'create-request-id',
      })

      const thrown = await rejected(() => client.create(createRequest))
      assert.equal(thrown.kind, 'http')
      assert.equal(thrown.status, status)
      assert.equal(thrown.code, status === 409 ? 'DRAFT_VERSION_CONFLICT' : 'DRAFT_REQUEST_REJECTED')
      assert.equal(thrown.message_key, thrown.message)
      assert.equal(thrown.request_id, 'server-request-01')
      assert.equal(thrown.retryable, true)
      assert.equal(thrown.retry_after_ms, 1500)
      assert.deepEqual(thrown.field_errors, [{ path: '/expected_version', code: 'conflict' }])
      assert.deepEqual(thrown.details, {
        field_errors: [{ path: '/expected_version', code: 'conflict' }],
        conflict: { current_version: 4 },
        preserved: 'details are not discarded',
      })
    })
  }

  for (const status of [401, 403, 404, 410]) {
    it(`maps standard get error status ${status}`, async () => {
      const client = createSubmissionDraftClient({
        fetch: async () => jsonResponse(errorBody('DRAFT_GET_REJECTED'), status),
        requestIdGenerator: () => 'get-request-id',
      })

      const thrown = await rejected(() => client.get(draftId))
      assert.equal(thrown.kind, 'http')
      assert.equal(thrown.status, status)
      assert.equal(thrown.requestId, 'server-request-01')
      assert.equal(thrown.code, 'DRAFT_GET_REJECTED')
    })
  }

  for (const status of [401, 403, 409, 410, 413, 422]) {
    it(`maps standard patch error status ${status}`, async () => {
      const client = createSubmissionDraftClient({
        fetch: async () => jsonResponse(errorBody(status === 409 ? 'DRAFT_VERSION_CONFLICT' : 'DRAFT_PATCH_REJECTED', true), status),
        getCsrfToken: () => 'csrf-token-for-draft',
        requestIdGenerator: () => 'patch-request-id',
      })

      const thrown = await rejected(() => client.patch(draftId, patchRequest))
      assert.equal(thrown.kind, 'http')
      assert.equal(thrown.status, status)
      assert.equal(thrown.code, status === 409 ? 'DRAFT_VERSION_CONFLICT' : 'DRAFT_PATCH_REJECTED')
      assert.deepEqual(thrown.fieldErrors, [{ path: '/expected_version', code: 'conflict' }])
      assert.deepEqual(thrown.details, {
        conflict: { current_version: 4 },
        preserved: 'details are not discarded',
      })
    })
  }

  it('maps a network failure to a transport error and performs exactly one fetch', async () => {
    let calls = 0
    const client = createSubmissionDraftClient({
      fetch: async () => {
        calls += 1
        throw new Error('offline')
      },
      getCsrfToken: () => 'csrf-token-for-draft',
      requestIdGenerator: () => 'network-request-id',
    })

    const thrown = await rejected(() => client.create(createRequest))
    assert.equal(thrown.kind, 'transport')
    assert.equal(thrown.type, 'transport')
    assert.equal(thrown.code, 'TRANSPORT_NETWORK_ERROR')
    assert.equal(thrown.status, null)
    assert.equal(thrown.requestId, 'network-request-id')
    assert.equal(calls, 1)
  })

  it('maps a non-JSON response to a protocol error', async () => {
    const client = createSubmissionDraftClient({
      fetch: async () => new Response('<html>gateway failure</html>', {
        status: 503,
        headers: { 'content-type': 'text/html', 'x-request-id': 'server-request-503' },
      }),
      requestIdGenerator: () => 'protocol-request-id',
    })

    const thrown = await rejected(() => client.get(draftId))
    assert.equal(thrown.kind, 'protocol')
    assert.equal(thrown.code, 'PROTOCOL_INVALID_RESPONSE')
    assert.equal(thrown.status, 503)
    assert.equal(thrown.requestId, 'server-request-503')
  })

  it('maps an invalid successful projection to a protocol error', async () => {
    const client = createSubmissionDraftClient({
      fetch: async () => jsonResponse({ ...projection, asset_drafts: [{}] }, 201),
      getCsrfToken: () => 'csrf-token-for-draft',
      requestIdGenerator: () => 'protocol-request-id',
    })

    const thrown = await rejected(() => client.create(createRequest))
    assert.equal(thrown.kind, 'protocol')
    assert.equal(thrown.code, 'PROTOCOL_INVALID_RESPONSE')
    assert.equal(thrown.status, 201)
  })

  it('rejects invalid local create input before fetch', async () => {
    let calls = 0
    const client = createSubmissionDraftClient({
      fetch: async () => {
        calls += 1
        return jsonResponse(projection, 201)
      },
      getCsrfToken: () => 'csrf-token-for-draft',
    })

    await assert.rejects(
      () => client.create({ ...createRequest, check_id: 'not-a-uuid' }),
      TypeError,
    )
    assert.equal(calls, 0)
  })

  for (const [label, request] of [
    ['missing key', { check_id: checkId, category_id: 'personal_site_portfolio' }],
    ['extra key', { ...createRequest, unexpected: true }],
    ['invalid category', { ...createRequest, category_id: 'unknown' }],
    ['invalid client request id', { ...createRequest, client_request_id: 'short' }],
  ] as const) {
    it(`rejects local create input with ${label} before fetch`, async () => {
      let calls = 0
      const client = createSubmissionDraftClient({
        fetch: async () => {
          calls += 1
          return jsonResponse(projection, 201)
        },
        getCsrfToken: () => 'csrf-token-for-draft',
      })

      await assert.rejects(() => client.create(request as SubmissionDraftCreateRequest), TypeError)
      assert.equal(calls, 0)
    })
  }

  it('rejects an invalid local draft id before fetch', async () => {
    let calls = 0
    const client = createSubmissionDraftClient({
      fetch: async () => {
        calls += 1
        return jsonResponse(projection)
      },
    })

    await assert.rejects(() => client.get('not-a-uuid'), TypeError)
    assert.equal(calls, 0)
  })

  for (const [label, request] of [
    ['zero expected version', { ...patchRequest, expected_version: 0 }],
    ['invalid operation id', { ...patchRequest, operation_id: 'short' }],
    ['more than 100 patch properties', {
      ...patchRequest,
      patch: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field_${index}`, index])),
    }],
  ] as const) {
    it(`rejects local patch input with ${label} before fetch`, async () => {
      let calls = 0
      const client = createSubmissionDraftClient({
        fetch: async () => {
          calls += 1
          return jsonResponse(projection)
        },
        getCsrfToken: () => 'csrf-token-for-draft',
      })

      await assert.rejects(() => client.patch(draftId, request as SubmissionDraftPatchRequest), TypeError)
      assert.equal(calls, 0)
    })
  }

  it('rejects a circular local patch before fetching', async () => {
    let calls = 0
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const client = createSubmissionDraftClient({
      fetch: async () => {
        calls += 1
        return jsonResponse(projection)
      },
      getCsrfToken: () => 'csrf-token-for-draft',
    })

    await assert.rejects(
      () => client.patch(draftId, { ...patchRequest, patch: circular }),
      TypeError,
    )
    assert.equal(calls, 0)
  })

  for (const baseUrl of [
    'ftp://api.example.test',
    'https://user:password@api.example.test',
    'https://api.example.test/?token=secret',
    '//api.example.test',
    'api.example.test',
  ]) {
    it(`rejects an invalid baseUrl: ${baseUrl}`, () => {
      assert.throws(() => createSubmissionDraftClient({ baseUrl }), TypeError)
    })
  }

  const invalidProjections: readonly [string, unknown][] = [
    ['extra top-level key', { ...projection, extra: true }],
    ['invalid draft uuid', { ...projection, draft_id: 'not-a-uuid' }],
    ['invalid enum', { ...projection, status: 'saving' }],
    ['non-positive revision', { ...projection, draft_revision: 0 }],
    ['non-object payload snapshot', { ...projection, payload_snapshot: [] }],
    ['duplicate media ids', { ...projection, media_reference_ids: [mediaId, mediaId] }],
    ['too many evidence ids', {
      ...projection,
      evidence_draft_ids: Array.from({ length: 51 }, (_, index) => `84000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    }],
    ['non-empty asset drafts', { ...projection, asset_drafts: [{}] }],
    ['invalid calendar date', { ...projection, created_at: '2026-02-30T10:00:00.000Z' }],
  ]

  for (const [label, invalidProjection] of invalidProjections) {
    it(`rejects a successful projection with ${label}`, async () => {
      const client = createSubmissionDraftClient({
        fetch: async () => jsonResponse(invalidProjection, 201),
        getCsrfToken: () => 'csrf-token-for-draft',
        requestIdGenerator: () => 'protocol-request-id',
      })

      const thrown = await rejected(() => client.create(createRequest))
      assert.equal(thrown.kind, 'protocol')
      assert.equal(thrown.code, 'PROTOCOL_INVALID_RESPONSE')
    })
  }

  it('exposes the factory result as the independent SubmissionDraftClient class', () => {
    assert.ok(createSubmissionDraftClient() instanceof SubmissionDraftClient)
  })
})
