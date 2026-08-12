import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

import { catalogError } from './errors.js'

export interface AssetResolutionSubject {
  readonly kind: 'anonymous' | 'user'
  readonly id: string
}

export interface AssetResolutionCommand {
  readonly assetId: string
  readonly attemptId: string
  readonly targetKind: 'safe_web_url' | 'contact_uri' | null
  readonly subject: AssetResolutionSubject
  readonly requestId: string
}

export interface AssetResolutionProjection {
  readonly attempt_id: string
  readonly asset_id: string
  readonly project_id: string
  readonly target_kind: 'safe_web_url' | 'contact_uri'
  readonly result: 'allowed' | 'uncertain' | 'blocked'
  readonly safe_web_url: string | null
  readonly contact_uri: string | null
  readonly target_domain: string | null
  readonly reason_code: string | null
  readonly redirect_count: number
  readonly checked_at: string
  readonly expires_at: string
}

export interface StoredAssetResolutionTarget {
  readonly kind: 'active' | 'missing' | 'forbidden' | 'gone'
  readonly assetId?: string
  readonly projectId?: string
  readonly safeWebUrl?: string | null
  readonly contactUri?: string | null
  readonly targetHash?: Buffer
}

export interface AssetResolutionStore {
  getReceipt(
    attemptId: string,
    subjectHash: Buffer,
    requestHash: string,
    now: Date,
  ): Promise<AssetResolutionProjection | null>
  consumeRateLimit(input: {
    readonly subjectHash: Buffer
    readonly now: Date
    readonly windowStartedAt: Date
    readonly windowEndsAt: Date
    readonly limit: number
  }): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }>
  getTarget(assetId: string): Promise<StoredAssetResolutionTarget>
  saveReceipt(input: {
    readonly projection: AssetResolutionProjection
    readonly subject: AssetResolutionSubject
    readonly subjectHash: Buffer
    readonly targetHash: Buffer
    readonly requestHash: string
    readonly requestId: string
  }): Promise<AssetResolutionProjection>
}

export interface ResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

export interface AssetDnsResolver {
  resolve(hostname: string): Promise<readonly ResolvedAddress[]>
}

export interface AssetHttpProbe {
  probe(input: {
    readonly url: string
    readonly addresses: readonly ResolvedAddress[]
    readonly method: 'HEAD' | 'GET'
    readonly timeoutMs: number
  }): Promise<{ readonly statusCode: number; readonly location: string | null }>
}

export interface AssetWebResolutionResult {
  readonly result: 'allowed' | 'uncertain' | 'blocked'
  readonly safeWebUrl: string | null
  readonly targetDomain: string | null
  readonly reasonCode: string | null
  readonly redirectCount: number
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null
  const values = address.split('.').map(Number)
  return values.length === 4 && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? values
    : null
}

function ipv6Bytes(address: string): number[] | null {
  const withoutZone = address.split('%')[0]!
  if (isIP(withoutZone) !== 6) return null
  let value = withoutZone.toLowerCase()
  const ipv4Tail = value.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/)?.[1]
  if (ipv4Tail) {
    const bytes = ipv4Bytes(ipv4Tail)
    if (!bytes) return null
    value = `${value.slice(0, -ipv4Tail.length)}${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0
  if (zeroCount < 0) return null
  const groups = [...left, ...Array.from({ length: zeroCount }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.flatMap((group) => {
    const parsed = Number.parseInt(group, 16)
    return [parsed >> 8, parsed & 0xff]
  })
}

function prefix(bytes: readonly number[], expected: readonly number[], bits: number): boolean {
  const whole = Math.floor(bits / 8)
  const remainder = bits % 8
  for (let index = 0; index < whole; index += 1) {
    if (bytes[index] !== expected[index]) return false
  }
  if (remainder === 0) return true
  const mask = (0xff << (8 - remainder)) & 0xff
  return ((bytes[whole] ?? 0) & mask) === ((expected[whole] ?? 0) & mask)
}

export function isPublicAssetAddress(address: string): boolean {
  const v4 = ipv4Bytes(address)
  if (v4) {
    const [a, b] = v4
    if (
      a === 0 || a === 10 || a === 127 || a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && v4[2] === 100) ||
      (a === 203 && b === 0 && v4[2] === 113)
    ) return false
    return true
  }
  const v6 = ipv6Bytes(address)
  if (!v6) return false
  if (prefix(v6, Array(16).fill(0), 128) || prefix(v6, [...Array(15).fill(0), 1], 128)) return false
  const mappedPrefix = [...Array(10).fill(0), 0xff, 0xff]
  if (prefix(v6, mappedPrefix, 96)) {
    return isPublicAssetAddress(v6.slice(12).join('.'))
  }
  if (!prefix(v6, [0x20], 3)) return false
  if (
    prefix(v6, [0x20, 0x01, 0x00, 0x00], 32) ||
    prefix(v6, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48) ||
    prefix(v6, [0x20, 0x01, 0x00, 0x10], 28) ||
    prefix(v6, [0x20, 0x01, 0x00, 0x20], 28) ||
    prefix(v6, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    prefix(v6, [0x20, 0x02], 16)
  ) return false
  return true
}

interface NormalizedWebTarget {
  readonly url: string
  readonly hostname: string
  readonly literalAddress: ResolvedAddress | null
}

function normalizeWebTarget(value: string): NormalizedWebTarget | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (
    !hostname || hostname.length > 253 || hostname.includes('%') ||
    hostname === 'localhost' || !hostname.includes('.') && isIP(hostname) === 0 ||
    ['.localhost', '.local', '.internal', '.home', '.lan', '.onion', '.invalid'].some((suffix) => hostname.endsWith(suffix))
  ) return null
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname
  url.hash = ''
  const normalized = url.toString()
  if (normalized.length > 2_048) return null
  const family = isIP(hostname)
  const literalAddress = family === 4 || family === 6
    ? Object.freeze({ address: hostname, family }) as ResolvedAddress
    : null
  return Object.freeze({ url: normalized, hostname, literalAddress })
}

export function normalizeAssetContactUri(value: string): string | null {
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length < 1 || normalized.length > 512 || /[\r\n\0]/.test(normalized)) return null
  const separator = normalized.indexOf(':')
  if (separator < 1) return null
  const scheme = normalized.slice(0, separator).toLowerCase()
  const body = normalized.slice(separator + 1)
  if (scheme === 'mailto') {
    const [address, query] = body.split('?', 2)
    let decoded = ''
    try {
      decoded = decodeURIComponent(address ?? '')
    } catch {
      return null
    }
    if (
      decoded.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(decoded) ||
      (query !== undefined && /(?:%0a|%0d|\r|\n)/i.test(query))
    ) return null
    return `mailto:${address}${query === undefined ? '' : `?${query}`}`
  }
  if (scheme === 'tel') {
    const compact = body.replace(/[\s().-]/g, '')
    if (!/^\+?[0-9]{3,20}$/.test(compact)) return null
    return `tel:${compact}`
  }
  return null
}

export class DefaultAssetDnsResolver implements AssetDnsResolver {
  async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    const records = await lookup(hostname, { all: true, verbatim: true })
    const unique = new Map<string, ResolvedAddress>()
    for (const record of records) {
      if (record.family !== 4 && record.family !== 6) continue
      unique.set(`${record.family}:${record.address}`, Object.freeze({
        address: record.address,
        family: record.family,
      }))
    }
    return Object.freeze([...unique.values()])
  }
}

export class NodePinnedAssetHttpProbe implements AssetHttpProbe {
  async probe(input: {
    readonly url: string
    readonly addresses: readonly ResolvedAddress[]
    readonly method: 'HEAD' | 'GET'
    readonly timeoutMs: number
  }): Promise<{ readonly statusCode: number; readonly location: string | null }> {
    const url = new URL(input.url)
    const selected = input.addresses[0]
    if (!selected) throw new Error('ASSET_DNS_EMPTY')
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, selected.address, selected.family)
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(url, {
        agent: false,
        headers: {
          accept: '*/*',
          ...(input.method === 'GET' ? { range: 'bytes=0-0' } : {}),
          'user-agent': 'VibeCheck-AssetSafety/1.0',
        },
        lookup: pinnedLookup,
        method: input.method,
      }, (response) => {
        if (settled) return
        settled = true
        const locationHeader = response.headers.location
        const location = Array.isArray(locationHeader) ? locationHeader[0] ?? null : locationHeader ?? null
        const result = Object.freeze({ statusCode: response.statusCode ?? 0, location })
        response.destroy()
        resolve(result)
      })
      request.setTimeout(input.timeoutMs, () => request.destroy(new Error('ASSET_PROBE_TIMEOUT')))
      request.once('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      request.end()
    })
  }
}

export class AssetWebSafetyResolver {
  constructor(
    private readonly dns: AssetDnsResolver,
    private readonly http: AssetHttpProbe,
    private readonly options: Readonly<{
      timeoutMs: number
      maximumRedirects: number
    }> = Object.freeze({ timeoutMs: 3_000, maximumRedirects: 5 }),
  ) {
    if (options.timeoutMs < 100 || options.timeoutMs > 10_000 || options.maximumRedirects < 0 || options.maximumRedirects > 5) {
      throw new Error('ASSET_RESOLVER_CONFIG_INVALID')
    }
  }

  async resolve(rawUrl: string): Promise<AssetWebResolutionResult> {
    let current = rawUrl
    for (let redirectCount = 0; redirectCount <= this.options.maximumRedirects; redirectCount += 1) {
      const normalized = normalizeWebTarget(current)
      if (!normalized) return this.result('blocked', null, null, 'ASSET_URL_BLOCKED', redirectCount)
      let addresses: readonly ResolvedAddress[]
      if (normalized.literalAddress) {
        addresses = Object.freeze([normalized.literalAddress])
      } else {
        try {
          addresses = await this.dns.resolve(normalized.hostname)
        } catch {
          return this.result(
            'uncertain', normalized.url, normalized.hostname, 'ASSET_DNS_UNAVAILABLE', redirectCount,
          )
        }
      }
      if (addresses.length === 0) {
        return this.result(
          'uncertain', normalized.url, normalized.hostname, 'ASSET_DNS_UNAVAILABLE', redirectCount,
        )
      }
      if (addresses.some(({ address }) => !isPublicAssetAddress(address))) {
        return this.result('blocked', null, null, 'ASSET_ADDRESS_BLOCKED', redirectCount)
      }

      let probe: { readonly statusCode: number; readonly location: string | null }
      try {
        probe = await this.http.probe({
          url: normalized.url,
          addresses,
          method: 'HEAD',
          timeoutMs: this.options.timeoutMs,
        })
        if (probe.statusCode === 405 || probe.statusCode === 501) {
          probe = await this.http.probe({
            url: normalized.url,
            addresses,
            method: 'GET',
            timeoutMs: this.options.timeoutMs,
          })
        }
      } catch {
        return this.result(
          'uncertain', normalized.url, normalized.hostname, 'ASSET_PROBE_UNAVAILABLE', redirectCount,
        )
      }
      if ([301, 302, 303, 307, 308].includes(probe.statusCode)) {
        if (!probe.location || redirectCount >= this.options.maximumRedirects) {
          return this.result('blocked', null, null, 'ASSET_REDIRECT_BLOCKED', redirectCount)
        }
        try {
          current = new URL(probe.location, normalized.url).toString()
        } catch {
          return this.result('blocked', null, null, 'ASSET_REDIRECT_BLOCKED', redirectCount)
        }
        continue
      }
      if (probe.statusCode < 100 || probe.statusCode >= 500) {
        return this.result(
          'uncertain', normalized.url, normalized.hostname, 'ASSET_UPSTREAM_UNAVAILABLE', redirectCount,
        )
      }
      return this.result('allowed', normalized.url, normalized.hostname, null, redirectCount)
    }
    return this.result('blocked', null, null, 'ASSET_REDIRECT_BLOCKED', this.options.maximumRedirects)
  }

  private result(
    result: AssetWebResolutionResult['result'],
    safeWebUrl: string | null,
    targetDomain: string | null,
    reasonCode: string | null,
    redirectCount: number,
  ): AssetWebResolutionResult {
    return Object.freeze({ result, safeWebUrl, targetDomain, reasonCode, redirectCount })
  }
}

export class AssetResolutionService {
  private readonly now: () => Date

  constructor(private readonly dependencies: Readonly<{
    store: AssetResolutionStore
    webResolver: AssetWebSafetyResolver
    now?: () => Date
    rateLimit?: number
    rateWindowSeconds?: number
  }>) {
    this.now = dependencies.now ?? (() => new Date())
    const rateLimit = dependencies.rateLimit ?? 30
    const rateWindowSeconds = dependencies.rateWindowSeconds ?? 60
    if (
      !Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10_000 ||
      !Number.isInteger(rateWindowSeconds) || rateWindowSeconds < 1 || rateWindowSeconds > 86_400
    ) throw new Error('ASSET_RESOLUTION_CONFIG_INVALID')
  }

  async resolve(command: AssetResolutionCommand): Promise<AssetResolutionProjection> {
    const assetId = this.uuid(command.assetId, 'ASSET_ID_INVALID')
    const attemptId = this.uuid(command.attemptId, 'ATTEMPT_ID_INVALID')
    const subjectId = this.uuid(command.subject.id, 'ASSET_SUBJECT_INVALID')
    if (command.targetKind !== null && !['safe_web_url', 'contact_uri'].includes(command.targetKind)) {
      throw catalogError('ASSET_TARGET_KIND_INVALID', 422)
    }
    const subjectHash = createHash('sha256')
      .update(`${command.subject.kind}:${subjectId}`, 'utf8')
      .digest()
    const target = await this.dependencies.store.getTarget(assetId)
    if (target.kind === 'missing') throw catalogError('ASSET_NOT_FOUND', 404)
    if (target.kind === 'forbidden') throw catalogError('ASSET_FORBIDDEN', 403)
    if (target.kind === 'gone') throw catalogError('ASSET_GONE', 410)
    if (!target.targetHash || target.targetHash.length !== 32 || !target.projectId) {
      throw catalogError('ASSET_TARGET_STATE_INVALID', 500, true)
    }
    const targetKind = this.targetKind(command.targetKind, target)
    const requestHash = createHash('sha256').update(JSON.stringify({
      asset_id: assetId,
      attempt_id: attemptId,
      target_kind: command.targetKind,
      resolved_target_kind: targetKind,
      target_hash: target.targetHash.toString('hex'),
    })).digest('hex')
    const now = this.now()
    const replay = await this.dependencies.store.getReceipt(attemptId, subjectHash, requestHash, now)
    if (replay) return replay
    const windowSeconds = this.dependencies.rateWindowSeconds ?? 60
    const windowMilliseconds = windowSeconds * 1_000
    const windowStartedAt = new Date(Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds)
    const rate = await this.dependencies.store.consumeRateLimit({
      subjectHash,
      now,
      windowStartedAt,
      windowEndsAt: new Date(windowStartedAt.getTime() + windowMilliseconds),
      limit: this.dependencies.rateLimit ?? 30,
    })
    if (!rate.allowed) {
      throw catalogError('ASSET_RESOLUTION_RATE_LIMITED', 429, true, rate.retryAfterSeconds)
    }
    const targetHash = target.targetHash
    let projection: AssetResolutionProjection
    if (targetKind === 'contact_uri') {
      const contactUri = normalizeAssetContactUri(target.contactUri ?? '')
      projection = this.projection({
        attemptId,
        assetId,
        projectId: target.projectId!,
        targetKind,
        result: contactUri ? 'allowed' : 'blocked',
        safeWebUrl: null,
        contactUri,
        targetDomain: null,
        reasonCode: contactUri ? null : 'ASSET_CONTACT_URI_BLOCKED',
        redirectCount: 0,
        now,
      })
    } else {
      const resolved = await this.dependencies.webResolver.resolve(target.safeWebUrl ?? '')
      projection = this.projection({
        attemptId,
        assetId,
        projectId: target.projectId!,
        targetKind,
        result: resolved.result,
        safeWebUrl: resolved.safeWebUrl,
        contactUri: null,
        targetDomain: resolved.targetDomain,
        reasonCode: resolved.reasonCode,
        redirectCount: resolved.redirectCount,
        now,
      })
    }
    return this.dependencies.store.saveReceipt({
      projection,
      subject: command.subject,
      subjectHash,
      targetHash,
      requestHash,
      requestId: command.requestId,
    })
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw catalogError(code, 422)
    }
    return value.toLowerCase()
  }

  private targetKind(
    requested: AssetResolutionCommand['targetKind'],
    target: StoredAssetResolutionTarget,
  ): 'safe_web_url' | 'contact_uri' {
    const hasWeb = Boolean(target.safeWebUrl)
    const hasContact = Boolean(target.contactUri)
    if (requested === 'safe_web_url' && !hasWeb || requested === 'contact_uri' && !hasContact) {
      throw catalogError('ASSET_TARGET_KIND_UNAVAILABLE', 422)
    }
    if (requested) return requested
    if (hasWeb && hasContact) throw catalogError('ASSET_TARGET_KIND_REQUIRED', 422)
    if (hasWeb) return 'safe_web_url'
    if (hasContact) return 'contact_uri'
    throw catalogError('ASSET_TARGET_UNAVAILABLE', 410)
  }

  private projection(input: Readonly<{
    attemptId: string
    assetId: string
    projectId: string
    targetKind: 'safe_web_url' | 'contact_uri'
    result: 'allowed' | 'uncertain' | 'blocked'
    safeWebUrl: string | null
    contactUri: string | null
    targetDomain: string | null
    reasonCode: string | null
    redirectCount: number
    now: Date
  }>): AssetResolutionProjection {
    const ttlSeconds = input.result === 'uncertain' ? 60 : 300
    return Object.freeze({
      attempt_id: input.attemptId,
      asset_id: input.assetId,
      project_id: input.projectId,
      target_kind: input.targetKind,
      result: input.result,
      safe_web_url: input.safeWebUrl,
      contact_uri: input.contactUri,
      target_domain: input.targetDomain,
      reason_code: input.reasonCode,
      redirect_count: input.redirectCount,
      checked_at: input.now.toISOString(),
      expires_at: new Date(input.now.getTime() + ttlSeconds * 1_000).toISOString(),
    })
  }
}
