import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MediaClientError,
  createMediaClient,
  type MediaReference,
  type MediaReferenceCreateRequest,
  type MediaReferenceDeleteRequest,
  type MediaReferenceListRequest,
  type MediaResource,
  type MediaResourceCompleteRequest,
  type MediaResourcePrepareRequest,
  type MediaResourcePrepareResponse,
} from './media-client.js'

const resourceId = '11111111-1111-4111-8111-111111111111'
const secondResourceId = '22222222-2222-4222-8222-222222222222'
const referenceId = '33333333-3333-4333-8333-333333333333'
const targetId = '44444444-4444-4444-8444-444444444444'

const prepareRequest: MediaResourcePrepareRequest = {
  purpose: 'project_cover',
  declared_mime: 'image/png',
  byte_size: 1024,
  checksum_sha256: 'a'.repeat(64),
}

const completeRequest: MediaResourceCompleteRequest = {
  checksum_sha256: 'a'.repeat(64),
  upload_receipt: 'receipt-from-upload-provider',
}

const createReferenceRequest: MediaReferenceCreateRequest = {
  media_resource_id: resourceId,
  target_type: 'submission_draft',
  target_id: targetId,
  role: 'cover',
  alt_text: 'A project cover',
  sort_order: 0,
  crop_focus: { x: 0.5, y: 0.25 },
  variant: 'cover.v1',
  client_request_id: 'reference-create-0001',
}

const listReferenceRequest: MediaReferenceListRequest = {
  target_type: 'submission_draft',
  target_id: targetId,
  role: 'cover',
}

const deleteReferenceRequest: MediaReferenceDeleteRequest = {
  expected_version: 1,
  operation_id: 'reference-delete-0001',
}

const resource: MediaResource = {
  media_resource_id: resourceId,
  declared_mime: 'image/png',
  detected_mime: null,
  byte_size: 1024,
  width: null,
  height: null,
  duration_ms: null,
  checksum_sha256: 'a'.repeat(64),
  source: 'upload',
  status: 'uploading',
  scan_result: 'not_scanned',
  rejection_reason_code: null,
  scan_attempt_count: 0,
  next_scan_at: null,
  exif_removed: false,
  deletion_guard_active: true,
  version: 1,
  created_at: '2026-08-26T10:00:00.000Z',
  updated_at: '2026-08-26T10:00:00.000Z',
}

const prepareProjection: MediaResourcePrepareResponse = {
  media: resource,
  upload_url: 'https://uploads.example.test/quarantine/resource?signature=abc',
  upload_headers: {
    'content-type': 'image/png',
    'x-upload-token': 'provider-token',
  },
  upload_expires_at: '2026-08-26T10:15:00.000Z',
}

const reference: MediaReference = {
  media_reference_id: referenceId,
  media_resource_id: resourceId,
  target_type: 'submission_draft',
  target_id: targetId,
  role: 'cover',
  alt_text: 'A project cover',
  sort_order: 0,
  crop_focus: { x: 0.5, y: 0.25 },
  variant: 'cover.v1',
  source_media_reference_id: null,
  version: 1,
  created_at: '2026-08-26T10:01:00.000Z',
  updated_at: '2026-08-26T10:01:00.000Z',
}

function jsonResponse(body: unknown, status: number, requestId = 'server-request-01'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
    },
  })
}

function errorBody(code = 'MEDIA_REQUEST_REJECTED') {
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: 'server-request-01',
      retryable: code === 'MEDIA_SERVICE_UNAVAILABLE',
      retry_after_ms: code === 'MEDIA_SERVICE_UNAVAILABLE' ? 1500 : null,
      details: {
        field_errors: [{ path: '/media_resource_id', code: 'invalid' }],
      },
    },
  }
}

async function rejected(action: () => Promise<unknown>): Promise<MediaClientError> {
  try {
    await action()
    assert.fail('expected the request to reject')
  } catch (error) {
    assert.ok(error instanceof MediaClientError)
    return error
  }
}

function clientWithResponse(
  response: Response | (() => Response),
  options: Partial<Parameters<typeof createMediaClient>[0]> = {},
) {
  let calls = 0
  let seenUrl: string | URL | undefined
  let seenInit: RequestInit | undefined
  const client = createMediaClient({
    baseUrl: 'https://api.example.test///',
    fetch: async (url, init) => {
      calls += 1
      seenUrl = url
      seenInit = init
      return typeof response === 'function' ? response() : response
    },
    getCsrfToken: () => 'csrf-token-for-media',
    requestIdGenerator: () => 'request-id-from-test',
    ...options,
  })
  return {
    client,
    get calls() { return calls },
    get seenUrl() { return seenUrl },
    get seenInit() { return seenInit },
  }
}

describe('Media typed client', () => {
  it('prepares with the exact method, body, credentials, CSRF, request id, idempotency key, and signal', async () => {
    const controller = new AbortController()
    const harness = clientWithResponse(jsonResponse(prepareProjection, 201))

    assert.deepEqual(
      await harness.client.prepare(prepareRequest, {
        idempotencyKey: 'prepare-key-0001',
        signal: controller.signal,
      }),
      prepareProjection,
    )
    assert.equal(harness.calls, 1)
    assert.equal(harness.seenUrl, 'https://api.example.test/api/v1/media-resources')
    assert.equal(harness.seenInit?.method, 'POST')
    assert.equal(harness.seenInit?.credentials, 'include')
    assert.equal(harness.seenInit?.signal, controller.signal)
    assert.deepEqual(harness.seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token-for-media',
      'X-Request-Id': 'request-id-from-test',
      'Idempotency-Key': 'prepare-key-0001',
    })
    assert.deepEqual(JSON.parse(String(harness.seenInit?.body)), prepareRequest)
  })

  it('gets a resource with GET and no CSRF or Content-Type header', async () => {
    let csrfCalls = 0
    const controller = new AbortController()
    const harness = clientWithResponse(jsonResponse(resource, 200), {
      getCsrfToken: () => {
        csrfCalls += 1
        return 'csrf-token-for-media'
      },
    })

    assert.deepEqual(await harness.client.get(resourceId, { signal: controller.signal }), resource)
    assert.equal(harness.seenUrl, 'https://api.example.test/api/v1/media-resources/11111111-1111-4111-8111-111111111111')
    assert.equal(harness.seenInit?.method, 'GET')
    assert.equal(harness.seenInit?.credentials, 'include')
    assert.equal(harness.seenInit?.signal, controller.signal)
    assert.deepEqual(harness.seenInit?.headers, {
      Accept: 'application/json',
      'X-Request-Id': 'request-id-from-test',
    })
    assert.equal(csrfCalls, 0)
  })

  it('completes with the exact body and only the Idempotency-Key header', async () => {
    const harness = clientWithResponse(jsonResponse({ media: resource, scan_queued: true }, 202))

    assert.deepEqual(
      await harness.client.complete(resourceId, completeRequest, { idempotencyKey: 'complete-key-0001' }),
      { media: resource, scan_queued: true },
    )
    assert.equal(harness.seenUrl, 'https://api.example.test/api/v1/media-resources/11111111-1111-4111-8111-111111111111/complete')
    assert.equal(harness.seenInit?.method, 'POST')
    assert.deepEqual(harness.seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token-for-media',
      'X-Request-Id': 'request-id-from-test',
      'Idempotency-Key': 'complete-key-0001',
    })
    assert.deepEqual(JSON.parse(String(harness.seenInit?.body)), completeRequest)
    assert.equal(Object.hasOwn(JSON.parse(String(harness.seenInit?.body)), 'operation_id'), false)
  })

  it('creates a reference with client_request_id in the body and no Idempotency-Key', async () => {
    const harness = clientWithResponse(jsonResponse(reference, 201))

    assert.deepEqual(await harness.client.createReference(createReferenceRequest), reference)
    assert.equal(harness.seenUrl, 'https://api.example.test/api/v1/media-references')
    assert.equal(harness.seenInit?.method, 'POST')
    assert.deepEqual(harness.seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token-for-media',
      'X-Request-Id': 'request-id-from-test',
    })
    assert.deepEqual(JSON.parse(String(harness.seenInit?.body)), createReferenceRequest)
    assert.equal(Object.hasOwn(harness.seenInit?.headers as object, 'Idempotency-Key'), false)
  })

  it('lists references with exact encoded query parameters and GET headers', async () => {
    const harness = clientWithResponse(jsonResponse({ items: [reference], total_count: 1 }, 200))

    assert.deepEqual(await harness.client.listReferences(listReferenceRequest), {
      items: [reference],
      total_count: 1,
    })
    assert.equal(
      harness.seenUrl,
      'https://api.example.test/api/v1/media-references?target_type=submission_draft&target_id=44444444-4444-4444-8444-444444444444&role=cover',
    )
    assert.equal(harness.seenInit?.method, 'GET')
    assert.deepEqual(harness.seenInit?.headers, {
      Accept: 'application/json',
      'X-Request-Id': 'request-id-from-test',
    })
  })

  it('deletes with operation_id in the body, sends 204 without parsing JSON, and does not retry', async () => {
    let jsonCalls = 0
    const response = new Response(null, {
      status: 204,
      headers: { 'x-request-id': 'server-request-01' },
    })
    Object.defineProperty(response, 'json', {
      value: async () => {
        jsonCalls += 1
        throw new Error('DELETE 204 must not parse JSON')
      },
    })
    const harness = clientWithResponse(response)

    await harness.client.deleteReference(referenceId, deleteReferenceRequest)
    assert.equal(harness.seenUrl, 'https://api.example.test/api/v1/media-references/33333333-3333-4333-8333-333333333333')
    assert.equal(harness.seenInit?.method, 'DELETE')
    assert.deepEqual(harness.seenInit?.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token-for-media',
      'X-Request-Id': 'request-id-from-test',
    })
    assert.deepEqual(JSON.parse(String(harness.seenInit?.body)), deleteReferenceRequest)
    assert.equal(jsonCalls, 0)
    assert.equal(harness.calls, 1)
  })

  it('accepts the documented success statuses and rejects a status mismatch without accepting the body', async () => {
    const prepareHarness = clientWithResponse(jsonResponse(prepareProjection, 200))
    const prepareError = await rejected(() => prepareHarness.client.prepare(
      prepareRequest,
      { idempotencyKey: 'prepare-key-0001' },
    ))
    assert.equal(prepareError.kind, 'protocol')
    assert.equal(prepareError.status, 200)

    const getHarness = clientWithResponse(jsonResponse(resource, 201))
    const getError = await rejected(() => getHarness.client.get(resourceId))
    assert.equal(getError.kind, 'protocol')
    assert.equal(getError.status, 201)
  })

  it('maps a valid API error envelope and preserves request id, retry, field errors, and details', async () => {
    const harness = clientWithResponse(jsonResponse(errorBody('MEDIA_SERVICE_UNAVAILABLE'), 503))

    const thrown = await rejected(() => harness.client.get(resourceId))
    assert.equal(thrown.kind, 'http')
    assert.equal(thrown.status, 503)
    assert.equal(thrown.code, 'MEDIA_SERVICE_UNAVAILABLE')
    assert.equal(thrown.requestId, 'server-request-01')
    assert.equal(thrown.request_id, thrown.requestId)
    assert.equal(thrown.retryable, true)
    assert.equal(thrown.retryAfterMs, 1500)
    assert.equal(thrown.retry_after_ms, 1500)
    assert.deepEqual(thrown.fieldErrors, [{ path: '/media_resource_id', code: 'invalid' }])
    assert.deepEqual(thrown.details, { field_errors: [{ path: '/media_resource_id', code: 'invalid' }] })
  })

  it('maps a non-JSON or malformed JSON response to protocol without retrying', async () => {
    let calls = 0
    const client = createMediaClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => {
        calls += 1
        return new Response('<html>gateway failure</html>', {
          status: 503,
          headers: { 'content-type': 'text/html', 'x-request-id': 'server-request-01' },
        })
      },
      requestIdGenerator: () => 'request-id-from-test',
    })
    const thrown = await rejected(() => client.get(resourceId))
    assert.equal(thrown.kind, 'protocol')
    assert.equal(thrown.code, 'PROTOCOL_INVALID_RESPONSE')
    assert.equal(thrown.status, 503)
    assert.equal(calls, 1)

    const malformed = createMediaClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => new Response('{', {
        status: 503,
        headers: { 'content-type': 'application/json', 'x-request-id': 'server-request-02' },
      }),
      requestIdGenerator: () => 'request-id-from-test',
    })
    const malformedError = await rejected(() => malformed.get(resourceId))
    assert.equal(malformedError.kind, 'protocol')
    assert.equal(malformedError.status, 503)
    assert.equal(malformedError.requestId, 'server-request-02')
  })

  it('maps an invalid error envelope or extra error field to protocol', async () => {
    const invalidEnvelope = clientWithResponse(jsonResponse({ error: { code: 'MISSING_FIELDS' } }, 422))
    const envelopeError = await rejected(() => invalidEnvelope.client.get(resourceId))
    assert.equal(envelopeError.kind, 'protocol')
    assert.equal(envelopeError.status, 422)

    const extraField = clientWithResponse(jsonResponse({
      ...errorBody(),
      error: { ...errorBody().error, unexpected: true },
    }, 422))
    const extraError = await rejected(() => extraField.client.get(resourceId))
    assert.equal(extraError.kind, 'protocol')
    assert.equal(extraError.status, 422)

    const undeclaredFieldErrors = clientWithResponse(jsonResponse({
      ...errorBody(),
      error: { ...errorBody().error, field_errors: [{ path: '/source_url', code: 'required' }] },
    }, 422))
    const undeclaredFieldErrorsError = await rejected(() => undeclaredFieldErrors.client.get(resourceId))
    assert.equal(undeclaredFieldErrorsError.kind, 'protocol')
    assert.equal(undeclaredFieldErrorsError.status, 422)
  })

  it('maps network failure to transport and performs exactly one fetch, including for 409', async () => {
    let networkCalls = 0
    const networkClient = createMediaClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => {
        networkCalls += 1
        throw new Error('offline')
      },
      requestIdGenerator: () => 'request-id-from-test',
    })
    const networkError = await rejected(() => networkClient.get(resourceId))
    assert.equal(networkError.kind, 'transport')
    assert.equal(networkError.code, 'TRANSPORT_NETWORK_ERROR')
    assert.equal(networkError.requestId, 'request-id-from-test')
    assert.equal(networkCalls, 1)

    let conflictCalls = 0
    const conflictClient = createMediaClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => {
        conflictCalls += 1
        return jsonResponse(errorBody(), 409)
      },
      getCsrfToken: () => 'csrf-token-for-media',
      requestIdGenerator: () => 'request-id-from-test',
    })
    const conflictError = await rejected(() => conflictClient.prepare(
      prepareRequest,
      { idempotencyKey: 'prepare-key-0001' },
    ))
    assert.equal(conflictError.kind, 'http')
    assert.equal(conflictError.status, 409)
    assert.equal(conflictError.code, 'MEDIA_REQUEST_REJECTED')
    assert.equal(conflictError.requestId, 'server-request-01')
    assert.equal(conflictError.retryable, false)
    assert.equal(conflictError.retryAfterMs, null)
    assert.deepEqual(conflictError.fieldErrors, [{ path: '/media_resource_id', code: 'invalid' }])
    assert.deepEqual(conflictError.details, { field_errors: [{ path: '/media_resource_id', code: 'invalid' }] })
    assert.equal(conflictCalls, 1)
  })

  it('rejects illegal base URLs before creating a client', () => {
    for (const baseUrl of [
      'ftp://api.example.test',
      '//api.example.test',
      'api.example.test',
      'https://user:password@api.example.test',
      'https://api.example.test/?token=secret',
      'https://api.example.test/#fragment',
      'not a URL',
    ]) {
      assert.throws(
        () => createMediaClient({ baseUrl }),
        TypeError,
        baseUrl,
      )
    }
  })

  it('rejects invalid local UUID, version, enum, request keys, and idempotency fields before fetch', async () => {
    let calls = 0
    const harness = clientWithResponse(jsonResponse(prepareProjection, 201))
    const fetchClient = createMediaClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => {
        calls += 1
        return jsonResponse(prepareProjection, 201)
      },
    })

    await assert.rejects(
      () => fetchClient.get('not-a-uuid'),
      (error: unknown) => error instanceof TypeError,
    )
    await assert.rejects(
      () => fetchClient.deleteReference(referenceId, { ...deleteReferenceRequest, expected_version: 0 }),
      (error: unknown) => error instanceof TypeError,
    )
    await assert.rejects(
      () => fetchClient.prepare(prepareRequest, { idempotencyKey: 'short' }),
      (error: unknown) => error instanceof TypeError,
    )
    await assert.rejects(
      () => fetchClient.prepare({ ...prepareRequest, extra: true } as unknown as MediaResourcePrepareRequest, {
        idempotencyKey: 'prepare-key-0001',
      }),
      (error: unknown) => error instanceof TypeError,
    )
    await assert.rejects(
      () => fetchClient.createReference({
        ...createReferenceRequest,
        target_type: 'not-a-target',
      } as unknown as MediaReferenceCreateRequest),
      (error: unknown) => error instanceof TypeError,
    )
    await assert.rejects(
      () => fetchClient.listReferences({
        ...listReferenceRequest,
        target_id: 'not-a-uuid',
      } as unknown as MediaReferenceListRequest),
      (error: unknown) => error instanceof TypeError,
    )
    assert.equal(calls, 0)
    assert.equal(harness.calls, 0)
  })

  it('rejects an invalid upload URL, date-time, nested crop focus, and success projection fields', async () => {
    const badUploadUrl = clientWithResponse(jsonResponse({
      ...prepareProjection,
      upload_url: 'http://uploads.example.test/object',
    }, 201))
    const uploadUrlError = await rejected(() => badUploadUrl.client.prepare(
      prepareRequest,
      { idempotencyKey: 'prepare-key-0001' },
    ))
    assert.equal(uploadUrlError.kind, 'protocol')

    for (const upload_url of ['https:/uploads.example.test/object', 'https:uploads.example.test/object']) {
      const malformedUploadUrl = clientWithResponse(jsonResponse({ ...prepareProjection, upload_url }, 201))
      const malformedError = await rejected(() => malformedUploadUrl.client.prepare(
        prepareRequest,
        { idempotencyKey: 'prepare-key-0001' },
      ))
      assert.equal(malformedError.kind, 'protocol')
    }

    const badDate = clientWithResponse(jsonResponse({
      ...prepareProjection,
      upload_expires_at: '2026-02-30T10:15:00.000Z',
    }, 201))
    const dateError = await rejected(() => badDate.client.prepare(
      prepareRequest,
      { idempotencyKey: 'prepare-key-0001' },
    ))
    assert.equal(dateError.kind, 'protocol')

    const badCrop = clientWithResponse(jsonResponse({
      ...reference,
      crop_focus: { x: 0.5, y: 0.25, zoom: 1 },
    }, 201))
    const cropError = await rejected(() => badCrop.client.createReference(createReferenceRequest))
    assert.equal(cropError.kind, 'protocol')

    const badResource = clientWithResponse(jsonResponse({
      ...resource,
      media_resource_id: 'not-a-uuid',
    }, 200))
    const resourceError = await rejected(() => badResource.client.get(resourceId))
    assert.equal(resourceError.kind, 'protocol')

    const badVersion = clientWithResponse(jsonResponse({
      ...resource,
      version: 0,
    }, 200))
    const versionError = await rejected(() => badVersion.client.get(resourceId))
    assert.equal(versionError.kind, 'protocol')

    const badEnum = clientWithResponse(jsonResponse({
      ...resource,
      status: 'unknown',
    }, 200))
    const enumError = await rejected(() => badEnum.client.get(resourceId))
    assert.equal(enumError.kind, 'protocol')

    const extraField = clientWithResponse(jsonResponse({ ...resource, extra: true }, 200))
    const extraError = await rejected(() => extraField.client.get(resourceId))
    assert.equal(extraError.kind, 'protocol')
  })

  it('rejects malformed list and reference projections instead of returning partial success', async () => {
    const badPage = clientWithResponse(jsonResponse({ items: [reference], total_count: -1 }, 200))
    const pageError = await rejected(() => badPage.client.listReferences(listReferenceRequest))
    assert.equal(pageError.kind, 'protocol')

    const malformedReference = clientWithResponse(jsonResponse({
      ...reference,
      media_resource_id: secondResourceId,
      extra: true,
    }, 201))
    const referenceError = await rejected(() => malformedReference.client.createReference(createReferenceRequest))
    assert.equal(referenceError.kind, 'protocol')
  })
})
