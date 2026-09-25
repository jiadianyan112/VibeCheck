import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CatalogError } from './errors.js'
import {
  AssetResolutionService,
  AssetWebSafetyResolver,
  isPublicAssetAddress,
  normalizeAssetContactUri,
  type AssetDnsResolver,
  type AssetHttpProbe,
  type AssetResolutionProjection,
  type AssetResolutionStore,
  type ResolvedAddress,
  type StoredAssetResolutionTarget,
} from './asset-resolution.js'

const assetId = '10000000-0000-4000-8000-000000000001'
const projectId = '20000000-0000-4000-8000-000000000001'
const subjectId = '30000000-0000-4000-8000-000000000001'
const attemptId = '40000000-0000-4000-8000-000000000001'
const targetHash = Buffer.alloc(32, 7)

class FakeDns implements AssetDnsResolver {
  readonly hosts: string[] = []

  constructor(private readonly records: Readonly<Record<string, readonly ResolvedAddress[]>>) {}

  async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    this.hosts.push(hostname)
    const result = this.records[hostname]
    if (!result) throw new Error('DNS_UNAVAILABLE')
    return result
  }
}

class FakeHttp implements AssetHttpProbe {
  readonly calls: Array<{ url: string; addresses: readonly ResolvedAddress[]; method: 'HEAD' | 'GET' }> = []

  constructor(private readonly responses: Array<{
    readonly statusCode: number
    readonly location: string | null
  } | Error>) {}

  async probe(input: {
    readonly url: string
    readonly addresses: readonly ResolvedAddress[]
    readonly method: 'HEAD' | 'GET'
    readonly timeoutMs: number
  }): Promise<{ readonly statusCode: number; readonly location: string | null }> {
    this.calls.push({ url: input.url, addresses: input.addresses, method: input.method })
    const response = this.responses.shift()
    if (!response) throw new Error('NO_RESPONSE')
    if (response instanceof Error) throw response
    return response
  }
}

class FakeStore implements AssetResolutionStore {
  receipt: AssetResolutionProjection | null = null
  target: StoredAssetResolutionTarget = Object.freeze({
    kind: 'active',
    assetId,
    projectId,
    safeWebUrl: 'https://example.com/resource',
    contactUri: null,
    targetHash,
  })
  rateAllowed = true
  saved = 0

  async getReceipt(): Promise<AssetResolutionProjection | null> {
    return this.receipt
  }

  async consumeRateLimit(): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return { allowed: this.rateAllowed, retryAfterSeconds: this.rateAllowed ? 0 : 60 }
  }

  async getTarget(): Promise<StoredAssetResolutionTarget> {
    return this.target
  }

  async saveReceipt(input: { readonly projection: AssetResolutionProjection }): Promise<AssetResolutionProjection> {
    this.saved += 1
    this.receipt = input.projection
    return input.projection
  }
}

function publicAddress(address = '93.184.216.34'): ResolvedAddress {
  return Object.freeze({ address, family: 4 })
}

async function catalogFailure(run: () => Promise<unknown>, code: string, status: number): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof CatalogError)
    assert.equal(error.code, code)
    assert.equal(error.httpStatus, status)
    return true
  })
}

describe('asset network boundary', () => {
  it('allows globally routable addresses and rejects private, reserved, and mapped private addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      assert.equal(isPublicAssetAddress(address), true, address)
    }
    for (const address of [
      '0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
      '192.168.1.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
      '::', '::1', 'fe80::1', 'fc00::1', '2001:db8::1', '::ffff:127.0.0.1',
    ]) assert.equal(isPublicAssetAddress(address), false, address)
  })

  it('blocks unsafe syntax before DNS or HTTP and never probes a mixed public/private answer', async () => {
    for (const value of [
      'file:///etc/passwd', 'http://user:password@example.com/', 'https://example.com:8443/',
      'http://localhost/', 'http://metadata.internal/', 'http://single-label/',
    ]) {
      const dns = new FakeDns({})
      const http = new FakeHttp([])
      const result = await new AssetWebSafetyResolver(dns, http).resolve(value)
      assert.equal(result.result, 'blocked', value)
      assert.equal(dns.hosts.length, 0)
      assert.equal(http.calls.length, 0)
    }

    const dns = new FakeDns({
      'example.com': [publicAddress(), Object.freeze({ address: '127.0.0.1', family: 4 })],
    })
    const http = new FakeHttp([])
    const result = await new AssetWebSafetyResolver(dns, http).resolve('https://example.com/')
    assert.equal(result.reasonCode, 'ASSET_ADDRESS_BLOCKED')
    assert.equal(http.calls.length, 0)
  })

  it('re-resolves and pins every safe redirect while blocking a redirect to private infrastructure', async () => {
    const safeDns = new FakeDns({
      'one.example': [publicAddress('8.8.8.8')],
      'two.example': [publicAddress('1.1.1.1')],
    })
    const safeHttp = new FakeHttp([
      { statusCode: 302, location: 'https://two.example/final' },
      { statusCode: 200, location: null },
    ])
    const allowed = await new AssetWebSafetyResolver(safeDns, safeHttp).resolve('https://one.example/start')
    assert.equal(allowed.result, 'allowed')
    assert.equal(allowed.safeWebUrl, 'https://two.example/final')
    assert.equal(allowed.redirectCount, 1)
    assert.deepEqual(safeDns.hosts, ['one.example', 'two.example'])
    assert.deepEqual(safeHttp.calls.map(({ addresses }) => addresses[0]?.address), ['8.8.8.8', '1.1.1.1'])

    const privateDns = new FakeDns({
      'one.example': [publicAddress()],
      'private.example': [Object.freeze({ address: '10.0.0.1', family: 4 })],
    })
    const privateHttp = new FakeHttp([{ statusCode: 302, location: 'http://private.example/admin' }])
    const blocked = await new AssetWebSafetyResolver(privateDns, privateHttp)
      .resolve('https://one.example/start')
    assert.equal(blocked.result, 'blocked')
    assert.equal(blocked.reasonCode, 'ASSET_ADDRESS_BLOCKED')
    assert.equal(blocked.safeWebUrl, null)
    assert.equal(privateHttp.calls.length, 1)
  })

  it('falls back to a one-byte GET and degrades transient DNS, probe, and upstream failures', async () => {
    const dns = new FakeDns({ 'example.com': [publicAddress()] })
    const http = new FakeHttp([
      { statusCode: 405, location: null },
      { statusCode: 204, location: null },
    ])
    assert.equal((await new AssetWebSafetyResolver(dns, http).resolve('https://example.com')).result, 'allowed')
    assert.deepEqual(http.calls.map(({ method }) => method), ['HEAD', 'GET'])

    const dnsFailure = await new AssetWebSafetyResolver(new FakeDns({}), new FakeHttp([]))
      .resolve('https://example.com')
    assert.equal(dnsFailure.reasonCode, 'ASSET_DNS_UNAVAILABLE')
    assert.equal(dnsFailure.result, 'uncertain')

    const probeFailure = await new AssetWebSafetyResolver(
      new FakeDns({ 'example.com': [publicAddress()] }),
      new FakeHttp([new Error('timeout')]),
    ).resolve('https://example.com')
    assert.equal(probeFailure.reasonCode, 'ASSET_PROBE_UNAVAILABLE')
    assert.equal(probeFailure.result, 'uncertain')

    const upstreamFailure = await new AssetWebSafetyResolver(
      new FakeDns({ 'example.com': [publicAddress()] }),
      new FakeHttp([{ statusCode: 503, location: null }]),
    ).resolve('https://example.com')
    assert.equal(upstreamFailure.reasonCode, 'ASSET_UPSTREAM_UNAVAILABLE')
    assert.equal(upstreamFailure.result, 'uncertain')
  })
})

describe('asset resolution service', () => {
  it('normalizes mail and telephone contacts without making a network request', async () => {
    assert.equal(normalizeAssetContactUri(' MAILTO:team@example.com '), 'mailto:team@example.com')
    assert.equal(normalizeAssetContactUri('tel:+86 (138) 0013-8000'), 'tel:+8613800138000')
    assert.equal(normalizeAssetContactUri('javascript:alert(1)'), null)

    const store = new FakeStore()
    store.target = Object.freeze({
      kind: 'active', assetId, projectId, safeWebUrl: null,
      contactUri: 'mailto:team@example.com', targetHash,
    })
    const http = new FakeHttp([])
    const service = new AssetResolutionService({
      store,
      webResolver: new AssetWebSafetyResolver(new FakeDns({}), http),
      now: () => new Date('2026-08-12T00:00:00.000Z'),
    })
    const result = await service.resolve({
      assetId, attemptId, targetKind: null,
      subject: { kind: 'anonymous', id: subjectId }, requestId: 'request-0001',
    })
    assert.equal(result.result, 'allowed')
    assert.equal(result.contact_uri, 'mailto:team@example.com')
    assert.equal(result.safe_web_url, null)
    assert.equal(http.calls.length, 0)
  })

  it('requires a target choice when an asset has both target types and reports object access states', async () => {
    const cases: Array<[StoredAssetResolutionTarget, string, number]> = [
      [{ kind: 'missing' }, 'ASSET_NOT_FOUND', 404],
      [{ kind: 'forbidden' }, 'ASSET_FORBIDDEN', 403],
      [{ kind: 'gone' }, 'ASSET_GONE', 410],
      [{
        kind: 'active', assetId, projectId, safeWebUrl: 'https://example.com',
        contactUri: 'mailto:team@example.com', targetHash,
      }, 'ASSET_TARGET_KIND_REQUIRED', 422],
    ]
    for (const [target, code, status] of cases) {
      const store = new FakeStore()
      store.target = target
      const service = new AssetResolutionService({
        store,
        webResolver: new AssetWebSafetyResolver(new FakeDns({}), new FakeHttp([])),
      })
      await catalogFailure(() => service.resolve({
        assetId, attemptId, targetKind: null,
        subject: { kind: 'anonymous', id: subjectId }, requestId: 'request-0002',
      }), code, status)
    }
  })

  it('returns an existing attempt before consuming quota and rejects over-limit new attempts', async () => {
    const store = new FakeStore()
    store.receipt = Object.freeze({
      attempt_id: attemptId, asset_id: assetId, project_id: projectId,
      target_kind: 'safe_web_url', result: 'allowed', safe_web_url: 'https://example.com/',
      contact_uri: null, target_domain: 'example.com', reason_code: null, redirect_count: 0,
      checked_at: '2026-08-12T00:00:00.000Z', expires_at: '2026-08-12T00:05:00.000Z',
    })
    store.rateAllowed = false
    const service = new AssetResolutionService({
      store,
      webResolver: new AssetWebSafetyResolver(new FakeDns({}), new FakeHttp([])),
    })
    assert.equal((await service.resolve({
      assetId, attemptId, targetKind: null,
      subject: { kind: 'anonymous', id: subjectId }, requestId: 'request-0003',
    })).attempt_id, attemptId)

    store.receipt = null
    await catalogFailure(() => service.resolve({
      assetId, attemptId, targetKind: null,
      subject: { kind: 'anonymous', id: subjectId }, requestId: 'request-0004',
    }), 'ASSET_RESOLUTION_RATE_LIMITED', 429)
  })

  it('rechecks current asset access before returning a cached receipt', async () => {
    const store = new FakeStore()
    store.receipt = Object.freeze({
      attempt_id: attemptId, asset_id: assetId, project_id: projectId,
      target_kind: 'safe_web_url', result: 'allowed', safe_web_url: 'https://example.com/',
      contact_uri: null, target_domain: 'example.com', reason_code: null, redirect_count: 0,
      checked_at: '2026-08-12T00:00:00.000Z', expires_at: '2026-08-12T00:05:00.000Z',
    })
    store.target = Object.freeze({ kind: 'gone' })
    const service = new AssetResolutionService({
      store,
      webResolver: new AssetWebSafetyResolver(new FakeDns({}), new FakeHttp([])),
    })
    await catalogFailure(() => service.resolve({
      assetId, attemptId, targetKind: null,
      subject: { kind: 'anonymous', id: subjectId }, requestId: 'request-0005',
    }), 'ASSET_GONE', 410)
  })
})
