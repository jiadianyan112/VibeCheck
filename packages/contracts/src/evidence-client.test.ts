import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EvidenceDraftClientError,
  createEvidenceDraftClient,
  type EvidenceDraft,
} from './evidence-client.js'

const draftId = '11111111-1111-4111-8111-111111111111'
const parentId = '22222222-2222-4222-8222-222222222222'
const evidenceId = '33333333-3333-4333-8333-333333333333'

const draft: EvidenceDraft = {
  evidence_draft_id: draftId,
  collector_actor_type: 'user',
  parent_type: 'submission_draft',
  parent_id: parentId,
  final_target_kind: 'project',
  target_asset_draft_key: null,
  evidence_type: 'trusted_external_source',
  source_channel: 'official_site',
  field_path: '/project_core/current_name',
  requested_visibility: 'reviewer_only',
  source_url: null,
  text_excerpt: null,
  attachment_drafts: [],
  status: 'editing',
  bound: false,
  source_hash: 'a'.repeat(64),
  final_field_preview: null,
  completed_at: null,
  promoted_evidence_id: null,
  version: 1,
  created_at: '2026-08-26T10:00:00.000Z',
  updated_at: '2026-08-26T10:00:00.000Z',
}

const readyDraft: EvidenceDraft = {
  ...draft,
  source_url: 'https://example.test/source',
  status: 'ready',
  bound: true,
  final_field_preview: {
    source_summary: '公开来源',
    captured_at: '2026-08-26T10:01:00.000Z',
    collected_by: 'user',
    confidence: 'medium',
    source_channel: 'official_site',
  },
  completed_at: '2026-08-26T10:01:00.000Z',
  version: 3,
  updated_at: '2026-08-26T10:01:00.000Z',
}

const binding = {
  parent_type: 'submission_draft' as const,
  parent_id: parentId,
  evidence_draft_ids: [evidenceId],
  parent_version: 8,
  evidence_draft_version: 2,
}

const createRequest = {
  parent_type: 'submission_draft' as const,
  parent_id: parentId,
  final_target_kind: 'project' as const,
  target_asset_draft_key: null,
  field_path: '/project_core/current_name',
  requested_visibility: 'reviewer_only' as const,
  evidence_type: 'trusted_external_source' as const,
  source_channel: 'official_site' as const,
  client_request_id: 'evidence-create-01',
}

const patchRequest = {
  expected_version: 1,
  source_url: 'https://example.test/source',
  internal_record_ref: null,
  text_excerpt: null,
  field_path: '/project_core/current_name',
  requested_visibility: 'reviewer_only' as const,
}

const csrf = 'csrf-token-for-evidence-tests'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'server-request-01' },
  })
}

function errorBody(code: string) {
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: 'server-request-error',
      retryable: false,
      retry_after_ms: null,
      details: {
        field_errors: [{ path: '/expected_version', code: 'conflict' }],
        conflict: { current_version: 4 },
        preserved: 'do-not-drop',
      },
    },
  }
}

function clientWith(response: Response | (() => Response)) {
  const fetchMock = async (input: string | URL, init?: RequestInit) => {
    void input
    void init
    return typeof response === 'function' ? response() : response
  }
  return { client: createEvidenceDraftClient({ fetch: fetchMock, baseUrl: 'https://api.example.test', getCsrfToken: () => csrf, requestIdGenerator: () => 'request-id-01' }) }
}

test('create sends exact evidence fields with CSRF and credentials', async () => {
  let seen: RequestInit | undefined
  let seenUrl: string | URL | undefined
  const client = createEvidenceDraftClient({
    baseUrl: 'https://api.example.test',
    getCsrfToken: () => csrf,
    requestIdGenerator: () => 'request-id-01',
    fetch: async (input, init) => {
      seenUrl = input
      seen = init
      return jsonResponse(draft, 201)
    },
  })

  assert.deepEqual(await client.create(createRequest), draft)
  assert.equal(String(seenUrl), 'https://api.example.test/api/v1/evidence-drafts')
  assert.equal(seen?.method, 'POST')
  assert.equal(seen?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(seen?.body)), createRequest)
  assert.deepEqual(seen?.headers, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
    'X-Request-Id': 'request-id-01',
  })
})

test('get does not send CSRF or a request body', async () => {
  let seen: RequestInit | undefined
  const client = createEvidenceDraftClient({
    baseUrl: 'https://api.example.test',
    getCsrfToken: () => { throw new Error('GET must not read CSRF') },
    fetch: async (_input, init) => {
      seen = init
      return jsonResponse(draft)
    },
  })

  assert.deepEqual(await client.get(draftId), draft)
  assert.equal(seen?.method, 'GET')
  assert.equal(seen?.credentials, 'include')
  assert.equal(seen?.body, undefined)
  assert.equal((seen?.headers as Record<string, string>)?.Accept, 'application/json')
  assert.equal(typeof (seen?.headers as Record<string, string>)?.['X-Request-Id'], 'string')
  assert.equal(Object.hasOwn(seen?.headers ?? {}, 'X-CSRF-Token'), false)
})

test('patch uses Idempotency-Key header and does not put operation_id in the body', async () => {
  let seen: RequestInit | undefined
  const client = createEvidenceDraftClient({
    baseUrl: 'https://api.example.test',
    getCsrfToken: () => csrf,
    fetch: async (_input, init) => {
      seen = init
      return jsonResponse(readyDraft)
    },
  })

  assert.deepEqual(await client.patch(draftId, patchRequest, { idempotencyKey: 'patch-idempotency-01' }), readyDraft)
  assert.equal(seen?.method, 'PATCH')
  assert.equal((seen?.headers as Record<string, string>)?.Accept, 'application/json')
  assert.equal((seen?.headers as Record<string, string>)?.['Content-Type'], 'application/json')
  assert.equal((seen?.headers as Record<string, string>)?.['X-CSRF-Token'], csrf)
  assert.equal((seen?.headers as Record<string, string>)?.['Idempotency-Key'], 'patch-idempotency-01')
  assert.equal(typeof (seen?.headers as Record<string, string>)?.['X-Request-Id'], 'string')
  assert.deepEqual(JSON.parse(String(seen?.body)), patchRequest)
  assert.equal(Object.hasOwn(JSON.parse(String(seen?.body)), 'operation_id'), false)
})

test('bind, complete and withdraw send their operation_id in the body', async () => {
  const seen: RequestInit[] = []
  const seenUrls: (string | URL)[] = []
  const responses = [jsonResponse(binding), jsonResponse(readyDraft), jsonResponse({ ...readyDraft, status: 'withdrawn' as const, version: 4 })]
  const client = createEvidenceDraftClient({
    baseUrl: 'https://api.example.test',
    getCsrfToken: () => csrf,
    fetch: async (input, init) => {
      seenUrls.push(input)
      seen.push(init ?? {})
      const response = responses.shift()
      if (response === undefined) throw new Error('unexpected request')
      return response
    },
  })

  assert.deepEqual(await client.bind(draftId, { parent_type: 'submission_draft', parent_id: parentId, expected_parent_version: 7, operation_id: 'bind-operation-01' }), binding)
  assert.deepEqual(await client.complete(draftId, { expected_version: 2, operation_id: 'complete-operation-01' }), readyDraft)
  assert.equal((await client.withdraw(draftId, { expected_version: 3, reason_code: 'user_cancelled', operation_id: 'withdraw-operation-01' })).status, 'withdrawn')
  assert.equal(JSON.parse(String(seen[0]?.body)).operation_id, 'bind-operation-01')
  assert.equal(JSON.parse(String(seen[1]?.body)).operation_id, 'complete-operation-01')
  assert.equal(JSON.parse(String(seen[2]?.body)).operation_id, 'withdraw-operation-01')
  assert.equal(seen.every((init) => init.credentials === 'include'), true)
  assert.equal(seen.every((init) => String((init.headers as Record<string, string>)['X-CSRF-Token']) === csrf), true)
  assert.deepEqual(seenUrls.map(String), [
    `https://api.example.test/api/v1/evidence-drafts/${draftId}/binding`,
    `https://api.example.test/api/v1/evidence-drafts/${draftId}/complete`,
    `https://api.example.test/api/v1/evidence-drafts/${draftId}/withdraw`,
  ])
  assert.equal(seen.every((init) => (init.method ?? '') === 'POST'), true)
  assert.equal(seen.every((init) => !Object.hasOwn(init.headers ?? {}, 'Idempotency-Key')), true)
})

test('preserves a server 409 without guessing a version or retrying', async () => {
  let calls = 0
  const client = createEvidenceDraftClient({
    baseUrl: 'https://api.example.test',
    getCsrfToken: () => csrf,
    fetch: async () => {
      calls += 1
      return jsonResponse(errorBody('EVIDENCE_PARENT_VERSION_CONFLICT'), 409)
    },
  })

  await assert.rejects(
    () => client.bind(draftId, { parent_type: 'submission_draft', parent_id: parentId, expected_parent_version: 7, operation_id: 'stale-bind-operation-01' }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceDraftClientError)
      assert.equal(error.kind, 'http')
      assert.equal(error.status, 409)
      assert.equal(error.code, 'EVIDENCE_PARENT_VERSION_CONFLICT')
      assert.deepEqual(error.details, {
        field_errors: [{ path: '/expected_version', code: 'conflict' }],
        conflict: { current_version: 4 },
        preserved: 'do-not-drop',
      })
      return true
    },
  )
  assert.equal(calls, 1)
})

test('rejects invalid successful projections, extra fields and non-positive versions', async () => {
  for (const invalid of [
    { ...draft, unexpected: true },
    { ...draft, status: 'saving' },
    { ...draft, version: 0 },
    { ...draft, evidence_draft_id: 'not-a-uuid' },
  ]) {
    const { client } = clientWith(jsonResponse(invalid, 201))
    await assert.rejects(
      () => client.create(createRequest),
      (error: unknown) => error instanceof EvidenceDraftClientError && error.kind === 'protocol' && error.code === 'PROTOCOL_INVALID_RESPONSE',
    )
  }
})

test('rejects an invalid patch field path before fetching', async () => {
  let calls = 0
  const client = createEvidenceDraftClient({
    fetch: async () => {
      calls += 1
      return jsonResponse(readyDraft)
    },
  })

  await assert.rejects(
    () => client.patch(draftId, { ...patchRequest, field_path: 'not/a/path' }, { idempotencyKey: 'patch-idempotency-01' }),
    TypeError,
  )
  assert.equal(calls, 0)
})

test('rejects invalid local IDs and base URLs before fetching', async () => {
  let calls = 0
  const client = createEvidenceDraftClient({ fetch: async () => { calls += 1; return jsonResponse(draft) } })
  await assert.rejects(() => client.get('not-a-uuid'), TypeError)
  assert.throws(() => createEvidenceDraftClient({ baseUrl: 'ftp://api.example.test' }), TypeError)
  assert.equal(calls, 0)
})

test('maps network and malformed JSON failures without fabricating a draft', async () => {
  const networkClient = createEvidenceDraftClient({
    requestIdGenerator: () => 'network-request-01',
    fetch: async () => { throw new Error('offline') },
  })
  await assert.rejects(() => networkClient.get(draftId), (error: unknown) => {
    assert.ok(error instanceof EvidenceDraftClientError)
    assert.equal(error.kind, 'transport')
    assert.equal(error.status, null)
    return true
  })

  const malformedClient = createEvidenceDraftClient({
    requestIdGenerator: () => 'protocol-request-01',
    fetch: async () => new Response('<html>gateway</html>', { status: 503, headers: { 'content-type': 'text/html' } }),
  })
  await assert.rejects(() => malformedClient.get(draftId), (error: unknown) => {
    assert.ok(error instanceof EvidenceDraftClientError)
    assert.equal(error.kind, 'protocol')
    assert.equal(error.status, 503)
    return true
  })
})

test('rejects an undeclared top-level error field as a protocol response', async () => {
  const client = clientWith(jsonResponse({
    error: {
      code: 'EVIDENCE_REJECTED',
      message_key: 'error.evidence_rejected',
      request_id: 'server-request-error',
      retryable: false,
      retry_after_ms: null,
      field_errors: [{ path: '/source_url', code: 'required' }],
    },
  }, 422))

  await assert.rejects(
    () => client.client.get(draftId),
    (error: unknown) => error instanceof EvidenceDraftClientError &&
      error.kind === 'protocol' && error.code === 'PROTOCOL_INVALID_RESPONSE',
  )
})
