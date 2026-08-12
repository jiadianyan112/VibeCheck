import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import {
  CatalogError,
  eventTypes,
  type AssetPage,
  type AssetResolutionCommand,
  type AssetResolutionProjection,
  type CategoryId,
  type CreatorProjection,
  type EventPage,
  type EventType,
  type ProjectListProjection,
  type ProjectProjection,
} from '@vibecheck/catalog'
import type { ServiceConfig } from '@vibecheck/config'
import {
  ComparisonError,
  type CancelComparisonMergeConflictCommand,
  type ComparisonLoginMergeProjection,
  type ComparisonMergeCancellationProjection,
  type ComparisonMergeConflictProjection,
  type ComparisonMergeResolutionProjection,
  type ComparisonMutationProjection,
  type ComparisonProjection,
  type ComparisonSubject,
  type GetComparisonMergeConflictCommand,
  type PrepareComparisonLoginMergeCommand,
  type PutComparisonCommand,
  type ResolveComparisonMergeConflictCommand,
  type SetComparisonSavedCommand,
} from '@vibecheck/comparison'
import {
  CommunityError,
  type ProjectInteractionProjection,
  type SetProjectInteractionCommand,
} from '@vibecheck/community'
import type { ServiceHealth } from '@vibecheck/contracts'
import {
  IdentityError,
  type CancelPendingActionCommand,
  type ConsumePendingActionCommand,
  type CreatePendingActionCommand,
  type GetPendingActionCommand,
  type PendingActionProjection,
  type PendingActionSubject,
  type SessionProjection,
  type StartChallengeCommand,
  type StartChallengeResult,
  type VerifyChallengeCommand,
  type VerifyChallengeResult,
} from '@vibecheck/identity'
import { redactRecord, withSpan } from '@vibecheck/observability'
import {
  SearchError,
  type QueryInvalidationCommand,
  type QueryLinkCommand,
  type QueryLinkProjection,
  type QueryMutationCommand,
  type QuerySnapshotProjection,
  type SearchCommand,
  type SearchProjection,
  type SearchSubject,
} from '@vibecheck/search'

const serviceVersion = '0.1.0'
const maxJsonBodyBytes = 16 * 1024
const authCookieNames = Object.freeze({
  anonymous: 'vc_anon',
  browserBinding: 'vc_auth_flow',
  csrf: 'vc_csrf',
  session: 'vc_session',
})

export interface ApiIdentityService {
  startChallenge(command: StartChallengeCommand): Promise<StartChallengeResult>
  verifyChallenge(command: VerifyChallengeCommand): Promise<VerifyChallengeResult>
  getSession(sessionToken: string | null, csrfToken: string | null): Promise<SessionProjection>
  logout(
    sessionToken: string | null,
    csrfToken: string | null,
    expectedVersion: number,
    requestId: string,
  ): Promise<void>
}

export interface ApiPendingActionService {
  create(command: CreatePendingActionCommand): Promise<PendingActionProjection>
  get(command: GetPendingActionCommand): Promise<PendingActionProjection>
  consume(command: ConsumePendingActionCommand): Promise<PendingActionProjection>
  cancel(command: CancelPendingActionCommand): Promise<PendingActionProjection>
}

export interface ApiCatalogService {
  listProjects(input: {
    readonly categoryId: CategoryId | null
    readonly limit: number
    readonly cursor: string | null
  }): Promise<ProjectListProjection>
  getProject(projectId: string): Promise<ProjectProjection>
  getCreator(creatorId: string): Promise<CreatorProjection>
  listProjectEvents(input: {
    readonly projectId: string
    readonly eventTypes: readonly EventType[]
    readonly includeSuperseded: boolean
    readonly cursor: string | null
  }): Promise<EventPage>
  listProjectAssets(input: {
    readonly projectId: string
    readonly cursor: string | null
  }): Promise<AssetPage>
}

export interface ApiAssetResolutionService {
  resolve(command: AssetResolutionCommand): Promise<AssetResolutionProjection>
}

export interface ApiComparisonService {
  getComparison(
    comparisonId: string,
    subject: ComparisonSubject,
  ): Promise<ComparisonProjection>
  putComparison(command: PutComparisonCommand): Promise<ComparisonMutationProjection>
  setSaved(command: SetComparisonSavedCommand): Promise<ComparisonProjection>
  prepareLoginMerge(command: PrepareComparisonLoginMergeCommand): Promise<ComparisonLoginMergeProjection>
  getMergeConflict(command: GetComparisonMergeConflictCommand): Promise<ComparisonMergeConflictProjection>
  resolveMergeConflict(
    command: ResolveComparisonMergeConflictCommand,
  ): Promise<ComparisonMergeResolutionProjection>
  cancelMergeConflict(
    command: CancelComparisonMergeConflictCommand,
  ): Promise<ComparisonMergeCancellationProjection>
}

export interface ApiSearchService {
  search(command: SearchCommand, subject: SearchSubject): Promise<SearchProjection>
  getQuerySnapshot(
    queryId: string,
    subject: SearchSubject,
    requestId: string,
  ): Promise<QuerySnapshotProjection>
  linkQuery(
    queryId: string,
    command: QueryLinkCommand,
    subject: SearchSubject,
    requestId: string,
  ): Promise<QueryLinkProjection>
  unlinkQuery(
    queryId: string,
    command: QueryMutationCommand,
    subject: SearchSubject,
    requestId: string,
  ): Promise<void>
  invalidateQuery(
    queryId: string,
    command: QueryInvalidationCommand,
    subject: SearchSubject,
    requestId: string,
  ): Promise<void>
}

export interface ApiCommunityService {
  setProjectInteraction(
    command: SetProjectInteractionCommand,
  ): Promise<ProjectInteractionProjection>
}

export interface ApiServerDependencies {
  readonly checkReadiness: () => Promise<void>
  readonly catalog?: ApiCatalogService
  readonly assetResolver?: ApiAssetResolutionService
  readonly comparison?: ApiComparisonService
  readonly community?: ApiCommunityService
  readonly catalogDefaultPageSize?: number
  readonly catalogMaximumPageSize?: number
  readonly identity?: ApiIdentityService
  readonly pendingActions?: ApiPendingActionService
  readonly search?: ApiSearchService
  readonly authCookieSecure?: boolean
  readonly anonymousCookieSecret?: string
  readonly staticDirectory?: string
  readonly now?: () => Date
}

interface ErrorEnvelopeOptions {
  readonly retryable?: boolean
  readonly retryAfterSeconds?: number
  readonly details?: Readonly<Record<string, unknown>>
}

type JsonObject = Record<string, unknown>

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  requestId: string,
  cacheControl = 'no-store',
): void {
  const encoded = JSON.stringify(body)
  response.writeHead(statusCode, {
    'cache-control': cacheControl,
    'content-length': Buffer.byteLength(encoded),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  })
  response.end(encoded)
}

function exactQueryKeys(searchParams: URLSearchParams, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  for (const key of searchParams.keys()) {
    if (!allowedSet.has(key) || searchParams.getAll(key).length !== 1) {
      throw new CatalogError('QUERY_PARAMETER_INVALID', 400)
    }
  }
}

function errorEnvelope(
  code: string,
  requestId: string,
  options: ErrorEnvelopeOptions = {},
): { readonly error: JsonObject } {
  return Object.freeze({
    error: Object.freeze({
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: requestId,
      retryable: options.retryable ?? false,
      retry_after_ms: options.retryAfterSeconds === undefined
        ? null
        : options.retryAfterSeconds * 1_000,
      ...(options.details === undefined ? {} : { details: options.details }),
    }),
  })
}

function requestIdFor(request: IncomingMessage): string {
  const supplied = request.headers['x-request-id']
  if (typeof supplied === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)) {
    return supplied
  }
  return randomUUID()
}

function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServiceConfig,
): void {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || !config.webOrigins.includes(origin)) return

  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader(
    'access-control-allow-headers',
    'content-type,idempotency-key,x-analytics-session,x-csrf-token,x-request-id',
  )
  response.setHeader('access-control-allow-methods', 'DELETE,GET,OPTIONS,PATCH,POST,PUT')
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('access-control-max-age', '600')
  response.setHeader('vary', 'Origin')
}

function healthBody(
  config: ServiceConfig,
  now: () => Date,
  status: ServiceHealth['status'],
  checks?: ServiceHealth['checks'],
): ServiceHealth {
  return Object.freeze({
    status,
    service: config.serviceName,
    version: serviceVersion,
    commit: config.gitCommit,
    checked_at: now().toISOString(),
    ...(checks === undefined ? {} : { checks }),
  })
}

function parseCookies(request: IncomingMessage): Readonly<Record<string, string>> {
  const header = request.headers.cookie
  if (!header) return Object.freeze({})
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const name = part.slice(0, separator).trim()
    const rawValue = part.slice(separator + 1).trim()
    try {
      cookies[name] = decodeURIComponent(rawValue)
    } catch {
      // Ignore malformed cookies. They are treated as absent and overwritten when needed.
    }
  }
  return Object.freeze(cookies)
}

function cookie(
  name: string,
  value: string,
  secure: boolean,
  options: { readonly httpOnly: boolean; readonly maxAgeSeconds: number },
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    'SameSite=Lax',
  ]
  if (options.httpOnly) attributes.push('HttpOnly')
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

function appendCookies(response: ServerResponse, values: readonly string[]): void {
  if (values.length) response.setHeader('set-cookie', values)
}

function signAnonymousSubject(subjectId: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(subjectId, 'utf8').digest('base64url')
  return `${subjectId}.${signature}`
}

function verifiedAnonymousSubject(value: string | undefined, secret: string): string | null {
  if (!value || secret.length < 32) return null
  const separator = value.indexOf('.')
  if (separator < 1) return null
  const subjectId = value.slice(0, separator)
  const supplied = Buffer.from(value.slice(separator + 1), 'utf8')
  const expected = Buffer.from(
    createHmac('sha256', secret).update(subjectId, 'utf8').digest('base64url'),
    'utf8',
  )
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subjectId)
    ? subjectId.toLowerCase()
    : null
}

function requestOriginAllowed(request: IncomingMessage, config: ServiceConfig): boolean {
  const origin = request.headers.origin
  if (typeof origin !== 'string') return false
  if (config.webOrigins.includes(origin)) return true
  const host = request.headers.host
  if (!host) return false
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol = typeof forwardedProto === 'string'
    ? forwardedProto.split(',')[0]!.trim()
    : config.environment === 'production' ? 'https' : 'http'
  return origin === `${protocol}://${host}`
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new IdentityError('CONTENT_TYPE_INVALID', 415, false)
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > maxJsonBodyBytes) throw new IdentityError('REQUEST_BODY_TOO_LARGE', 413, false)
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new IdentityError('REQUEST_JSON_INVALID', 400, false)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdentityError('REQUEST_BODY_INVALID', 422, false)
  }
  return value as JsonObject
}

function exactKeys(value: JsonObject, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new IdentityError('REQUEST_FIELD_UNKNOWN', 422, false)
  }
}

function stringField(
  value: JsonObject,
  key: string,
  options: { readonly minimum?: number; readonly maximum: number; readonly optional?: boolean },
): string | null {
  const field = value[key]
  if (field === undefined && options.optional) return null
  if (typeof field !== 'string') throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  const minimum = options.minimum ?? 1
  if (field.length < minimum || field.length > options.maximum) {
    throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  }
  return field
}

function integerField(value: JsonObject, key: string, minimum: number): number {
  const field = value[key]
  if (!Number.isSafeInteger(field) || (field as number) < minimum) {
    throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  }
  return field as number
}

function booleanField(value: JsonObject, key: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') {
    throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  }
  return field
}

function objectField(value: JsonObject, key: string): Readonly<Record<string, unknown>> {
  const field = value[key]
  if (field === null || typeof field !== 'object' || Array.isArray(field)) {
    throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  }
  return Object.freeze({ ...(field as Record<string, unknown>) })
}

function stringArrayField(
  value: JsonObject,
  key: string,
  maximumItems: number,
  maximumLength: number,
): readonly string[] {
  const field = value[key]
  if (!Array.isArray(field) || field.length > maximumItems) {
    throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  }
  if (field.some((item) => typeof item !== 'string' || item.length < 1 || item.length > maximumLength)) {
    throw new IdentityError(`REQUEST_${key.toUpperCase()}_INVALID`, 422, false)
  }
  return Object.freeze([...field]) as readonly string[]
}

function sessionResponse(session: SessionProjection): JsonObject {
  return Object.freeze({
    authenticated: true,
    user_id: session.userId,
    display_name: session.displayName,
    account_status: session.accountStatus,
    roles: session.roles,
    primary_role: session.primaryRole,
    permissions: session.permissions,
    session_version: session.sessionVersion,
    csrf_token: session.csrfToken,
    recent_auth_at: session.recentAuthAt,
    expires_at: session.expiresAt,
  })
}

function clientIp(request: IncomingMessage): string | null {
  return request.socket.remoteAddress ?? null
}

const staticContentTypes: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
})

async function handleStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  method: string,
  requestId: string,
  staticDirectory: string | undefined,
): Promise<number | null> {
  if (!staticDirectory || (method !== 'GET' && method !== 'HEAD') || path.startsWith('/api/')) {
    return null
  }
  const root = resolve(staticDirectory)
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(path)
  } catch {
    throw new IdentityError('ROUTE_PATH_INVALID', 400, false)
  }
  const requestedRelative = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  let candidate = resolve(root, requestedRelative)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new IdentityError('ROUTE_PATH_INVALID', 400, false)
  }
  let fileExists = false
  try {
    fileExists = (await stat(candidate)).isFile()
  } catch {
    fileExists = false
  }
  if (!fileExists && extname(decodedPath) === '') {
    candidate = resolve(root, 'index.html')
    try {
      fileExists = (await stat(candidate)).isFile()
    } catch {
      fileExists = false
    }
  }
  if (!fileExists) return null

  const body = method === 'HEAD' ? null : await readFile(candidate)
  const isIndex = candidate === resolve(root, 'index.html')
  const headers: Record<string, string | number> = {
    'cache-control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable',
    'content-type': staticContentTypes[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-request-id': requestId,
  }
  if (body !== null) headers['content-length'] = body.length
  response.writeHead(200, headers)
  response.end(body)
  return 200
}

function requireIdentity(dependencies: ApiServerDependencies): ApiIdentityService {
  if (!dependencies.identity) throw new IdentityError('AUTH_SERVICE_UNAVAILABLE', 503, true)
  return dependencies.identity
}

async function handleAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  method: string,
  requestId: string,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const startPath = '/api/v1/auth/email-challenges'
  const verification = path.match(/^\/api\/v1\/auth\/email-challenges\/([^/]+)\/verify$/)
  const sessionPath = '/api/v1/auth/session'
  if (path !== startPath && verification === null && path !== sessionPath) return null

  const identity = requireIdentity(dependencies)
  const secure = dependencies.authCookieSecure ?? config.environment === 'production'
  const anonymousSecret = dependencies.anonymousCookieSecret ?? ''
  if (anonymousSecret.length < 32) {
    throw new IdentityError('AUTH_SERVICE_UNAVAILABLE', 503, true)
  }
  const cookies = parseCookies(request)

  if ((method === 'POST' || method === 'DELETE') && !requestOriginAllowed(request, config)) {
    throw new IdentityError('ORIGIN_INVALID', 403, false)
  }

  if (method === 'POST' && path === startPath) {
    const body = await readJsonBody(request)
    exactKeys(body, [
      'email', 'purpose', 'return_to', 'client_request_id', 'preview_token', 'pending_action_id',
    ])
    const purpose = stringField(body, 'purpose', { maximum: 32 })
    if (purpose !== 'login' && purpose !== 'admin_confirm') {
      throw new IdentityError('REQUEST_PURPOSE_INVALID', 422, false)
    }
    const anonymousSubjectId = verifiedAnonymousSubject(cookies[authCookieNames.anonymous], anonymousSecret)
      ?? randomUUID()
    const result = await identity.startChallenge({
      email: stringField(body, 'email', { maximum: 254 })!,
      purpose,
      returnTo: stringField(body, 'return_to', { maximum: 2_048 })!,
      clientRequestId: stringField(body, 'client_request_id', { maximum: 64 })!,
      anonymousSubjectId,
      browserBindingToken: cookies[authCookieNames.browserBinding] ?? null,
      sessionToken: cookies[authCookieNames.session] ?? null,
      previewToken: stringField(body, 'preview_token', { minimum: 32, maximum: 512, optional: true }),
      pendingActionId: stringField(body, 'pending_action_id', { maximum: 64, optional: true }),
      ipAddress: clientIp(request),
      userAgent: request.headers['user-agent'] ?? null,
      requestId,
    })
    appendCookies(response, [
      cookie(
        authCookieNames.anonymous,
        signAnonymousSubject(anonymousSubjectId, anonymousSecret),
        secure,
        { httpOnly: true, maxAgeSeconds: 31_536_000 },
      ),
      cookie(
        authCookieNames.browserBinding,
        result.browserBindingToken,
        secure,
        { httpOnly: true, maxAgeSeconds: 600 },
      ),
    ])
    writeJson(response, 202, {
      auth_flow_id: result.authFlowId,
      challenge_id: result.challengeId,
      expires_at: result.expiresAt,
      resend_after: result.resendAfter,
      masked_email: result.maskedEmail,
    }, requestId)
    return 202
  }

  if (method === 'POST' && verification !== null) {
    const body = await readJsonBody(request)
    exactKeys(body, ['auth_flow_id', 'otp', 'client_request_id'])
    const result = await identity.verifyChallenge({
      challengeId: verification[1]!,
      authFlowId: stringField(body, 'auth_flow_id', { maximum: 64 })!,
      otp: stringField(body, 'otp', { minimum: 6, maximum: 6 })!,
      clientRequestId: stringField(body, 'client_request_id', { maximum: 64 })!,
      browserBindingToken: cookies[authCookieNames.browserBinding] ?? null,
      currentSessionToken: cookies[authCookieNames.session] ?? null,
      ipAddress: clientIp(request),
      userAgent: request.headers['user-agent'] ?? null,
      requestId,
    })
    if (result.purpose === 'login') {
      const mergeIdentityLink = result.identityLinks.find(({ purpose }) => purpose === 'comparison_merge')
      const comparisonMerge = dependencies.comparison && mergeIdentityLink
        ? await dependencies.comparison.prepareLoginMerge({
          userId: result.session.userId,
          anonymousSubjectId: result.anonymousSubjectId,
          identityLinkId: mergeIdentityLink.identityLinkId,
          operationId: stringField(body, 'client_request_id', { maximum: 64 })!,
          pendingActionId: result.pendingActionId,
        })
        : null
      const maxAgeSeconds = Math.max(
        0,
        Math.floor((Date.parse(result.session.expiresAt) - (dependencies.now?.() ?? new Date()).getTime()) / 1_000),
      )
      appendCookies(response, [
        cookie(authCookieNames.session, result.sessionToken, secure, {
          httpOnly: true,
          maxAgeSeconds,
        }),
        cookie(authCookieNames.csrf, result.session.csrfToken, secure, {
          httpOnly: false,
          maxAgeSeconds,
        }),
        cookie(authCookieNames.browserBinding, '', secure, { httpOnly: true, maxAgeSeconds: 0 }),
      ])
      writeJson(response, 200, {
        purpose: 'login',
        session: sessionResponse(result.session),
        return_to: result.returnTo,
        identity_links: result.identityLinks.map((link) => Object.freeze({
          identity_link_id: link.identityLinkId,
          purpose: link.purpose,
          expires_at: link.expiresAt,
        })),
        comparison_merge: comparisonMerge,
        pending_action_id: result.pendingActionId,
      }, requestId)
    } else {
      appendCookies(response, [
        cookie(authCookieNames.browserBinding, '', secure, { httpOnly: true, maxAgeSeconds: 0 }),
      ])
      writeJson(response, 200, {
        purpose: 'admin_confirm',
        reauth_grant_id: result.reauthGrantId,
        recent_auth_at: result.recentAuthAt,
        return_to: result.returnTo,
      }, requestId)
    }
    return 200
  }

  if (method === 'GET' && path === sessionPath) {
    const session = await identity.getSession(
      cookies[authCookieNames.session] ?? null,
      cookies[authCookieNames.csrf] ?? null,
    )
    writeJson(response, 200, sessionResponse(session), requestId)
    return 200
  }

  if (method === 'DELETE' && path === sessionPath) {
    const body = await readJsonBody(request)
    exactKeys(body, ['session_version'])
    const csrfHeader = request.headers['x-csrf-token']
    const csrfCookie = cookies[authCookieNames.csrf]
    if (typeof csrfHeader !== 'string' || !csrfCookie || csrfHeader !== csrfCookie) {
      throw new IdentityError('CSRF_INVALID', 403, false)
    }
    await identity.logout(
      cookies[authCookieNames.session] ?? null,
      csrfHeader,
      integerField(body, 'session_version', 1),
      requestId,
    )
    appendCookies(response, [
      cookie(authCookieNames.session, '', secure, { httpOnly: true, maxAgeSeconds: 0 }),
      cookie(authCookieNames.csrf, '', secure, { httpOnly: false, maxAgeSeconds: 0 }),
    ])
    response.writeHead(204, {
      'cache-control': 'no-store',
      'x-request-id': requestId,
    })
    response.end()
    return 204
  }

  return null
}

function requirePendingActions(dependencies: ApiServerDependencies): ApiPendingActionService {
  if (!dependencies.pendingActions) throw new IdentityError('AUTH_SERVICE_UNAVAILABLE', 503, true)
  return dependencies.pendingActions
}

function requireIdentityMutationCsrf(request: IncomingMessage): void {
  const cookies = parseCookies(request)
  const csrfHeader = request.headers['x-csrf-token']
  const csrfCookie = cookies[authCookieNames.csrf]
  if (typeof csrfHeader !== 'string' || !csrfCookie || csrfHeader !== csrfCookie) {
    throw new IdentityError('CSRF_INVALID', 403, false)
  }
}

async function resolvePendingActionSubject(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
  createAnonymous: boolean,
): Promise<{ readonly subject: PendingActionSubject; readonly session: SessionProjection | null }> {
  const cookies = parseCookies(request)
  if (cookies[authCookieNames.session]) {
    const session = await requireIdentity(dependencies).getSession(
      cookies[authCookieNames.session] ?? null,
      cookies[authCookieNames.csrf] ?? null,
    )
    return Object.freeze({
      subject: Object.freeze({ kind: 'user' as const, id: session.userId }),
      session,
    })
  }
  const secret = dependencies.anonymousCookieSecret ?? ''
  if (secret.length < 32) throw new IdentityError('AUTH_SERVICE_UNAVAILABLE', 503, true)
  const existing = verifiedAnonymousSubject(cookies[authCookieNames.anonymous], secret)
  if (existing === null && !createAnonymous) throw new IdentityError('PENDING_ACTION_FORBIDDEN', 403, false)
  const subjectId = existing ?? randomUUID()
  if (existing === null) {
    appendCookies(response, [
      cookie(
        authCookieNames.anonymous,
        signAnonymousSubject(subjectId, secret),
        dependencies.authCookieSecure ?? config.environment === 'production',
        { httpOnly: true, maxAgeSeconds: 31_536_000 },
      ),
    ])
  }
  return Object.freeze({
    subject: Object.freeze({ kind: 'anonymous' as const, id: subjectId }),
    session: null,
  })
}

async function handlePendingActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  method: string,
  requestId: string,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const collectionPath = '/api/v1/auth/pending-actions'
  const itemMatch = path.match(/^\/api\/v1\/auth\/pending-actions\/([^/]+)$/)
  const consumeMatch = path.match(/^\/api\/v1\/auth\/pending-actions\/([^/]+)\/consume$/)
  const cancelMatch = path.match(/^\/api\/v1\/auth\/pending-actions\/([^/]+)\/cancel$/)
  if (path !== collectionPath && itemMatch === null && consumeMatch === null && cancelMatch === null) {
    return null
  }
  const service = requirePendingActions(dependencies)

  if (method === 'POST' && path === collectionPath) {
    if (!requestOriginAllowed(request, config)) throw new IdentityError('ORIGIN_INVALID', 403, false)
    if ([...url.searchParams.keys()].length > 0) throw new IdentityError('QUERY_PARAMETER_INVALID', 400, false)
    const owner = await resolvePendingActionSubject(request, response, config, dependencies, true)
    if (owner.session?.accountStatus === 'restricted') {
      throw new IdentityError('ACCOUNT_RESTRICTED', 403, false)
    }
    if (owner.subject.kind === 'user') requireIdentityMutationCsrf(request)
    const body = await readJsonBody(request)
    exactKeys(body, ['action_type', 'parameters', 'return_to', 'client_request_id'])
    const result = await service.create({
      subject: owner.subject,
      actionType: stringField(body, 'action_type', { maximum: 32 })!,
      parameters: objectField(body, 'parameters'),
      returnTo: stringField(body, 'return_to', { maximum: 2_048 })!,
      clientRequestId: stringField(body, 'client_request_id', { maximum: 64 })!,
      requestId,
    })
    writeJson(response, 201, result, requestId)
    return 201
  }

  if (method === 'GET' && itemMatch !== null) {
    for (const key of url.searchParams.keys()) {
      if (key !== 'identity_link_id' || url.searchParams.getAll(key).length !== 1) {
        throw new IdentityError('QUERY_PARAMETER_INVALID', 400, false)
      }
    }
    const owner = await resolvePendingActionSubject(request, response, config, dependencies, false)
    const identityLinkId = url.searchParams.get('identity_link_id')
    const result = await service.get({
      pendingActionId: itemMatch[1]!,
      subject: owner.subject,
      identityLinkId,
      requestId,
    })
    writeJson(response, 200, result, requestId)
    return 200
  }

  if (method === 'POST' && consumeMatch !== null) {
    if (!requestOriginAllowed(request, config)) throw new IdentityError('ORIGIN_INVALID', 403, false)
    if ([...url.searchParams.keys()].length > 0) throw new IdentityError('QUERY_PARAMETER_INVALID', 400, false)
    const owner = await resolvePendingActionSubject(request, response, config, dependencies, false)
    if (owner.subject.kind !== 'user') throw new IdentityError('AUTHENTICATION_REQUIRED', 401, false)
    requireIdentityMutationCsrf(request)
    const body = await readJsonBody(request)
    exactKeys(body, [
      'identity_link_id', 'execution_receipt', 'client_request_id', 'expected_status',
    ])
    const expectedStatus = stringField(body, 'expected_status', { maximum: 16 })
    if (expectedStatus !== 'pending') throw new IdentityError('EXPECTED_STATUS_INVALID', 422, false)
    const result = await service.consume({
      pendingActionId: consumeMatch[1]!,
      subject: owner.subject,
      identityLinkId: stringField(body, 'identity_link_id', { maximum: 64 })!,
      executionReceipt: stringField(body, 'execution_receipt', { maximum: 2_048 })!,
      clientRequestId: stringField(body, 'client_request_id', { maximum: 64 })!,
      expectedStatus,
      requestId,
    })
    writeJson(response, 200, result, requestId)
    return 200
  }

  if (method === 'POST' && cancelMatch !== null) {
    if (!requestOriginAllowed(request, config)) throw new IdentityError('ORIGIN_INVALID', 403, false)
    if ([...url.searchParams.keys()].length > 0) throw new IdentityError('QUERY_PARAMETER_INVALID', 400, false)
    const owner = await resolvePendingActionSubject(request, response, config, dependencies, false)
    if (owner.subject.kind === 'user') requireIdentityMutationCsrf(request)
    const body = await readJsonBody(request)
    exactKeys(body, ['identity_link_id', 'cancel_reason', 'client_request_id'])
    const result = await service.cancel({
      pendingActionId: cancelMatch[1]!,
      subject: owner.subject,
      identityLinkId: stringField(body, 'identity_link_id', { maximum: 64, optional: true }),
      cancelReason: stringField(body, 'cancel_reason', { maximum: 128 })!,
      clientRequestId: stringField(body, 'client_request_id', { maximum: 64 })!,
      requestId,
    })
    writeJson(response, 200, result, requestId)
    return 200
  }

  return null
}

function requireCatalog(dependencies: ApiServerDependencies): ApiCatalogService {
  if (!dependencies.catalog) throw new CatalogError('CATALOG_SERVICE_UNAVAILABLE', 503, true)
  return dependencies.catalog
}

function requireSearch(dependencies: ApiServerDependencies): ApiSearchService {
  if (!dependencies.search) throw new SearchError('SEARCH_SERVICE_UNAVAILABLE', 503, true)
  return dependencies.search
}

async function resolveBrowserSubject(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
  unavailableError: () => Error,
): Promise<SearchSubject> {
  const cookies = parseCookies(request)
  if (dependencies.identity && cookies[authCookieNames.session]) {
    try {
      const session = await dependencies.identity.getSession(
        cookies[authCookieNames.session] ?? null,
        cookies[authCookieNames.csrf] ?? null,
      )
      return Object.freeze({ kind: 'user', id: session.userId })
    } catch (error) {
      if (!(error instanceof IdentityError) || ![
        'AUTHENTICATION_REQUIRED', 'SESSION_INVALID', 'CSRF_INVALID',
      ].includes(error.code)) throw error
    }
  }
  const secret = dependencies.anonymousCookieSecret ?? ''
  if (secret.length < 32) throw unavailableError()
  const subjectId = verifiedAnonymousSubject(cookies[authCookieNames.anonymous], secret) ?? randomUUID()
  appendCookies(response, [
    cookie(
      authCookieNames.anonymous,
      signAnonymousSubject(subjectId, secret),
      dependencies.authCookieSecure ?? config.environment === 'production',
      { httpOnly: true, maxAgeSeconds: 31_536_000 },
    ),
  ])
  return Object.freeze({ kind: 'anonymous', id: subjectId })
}

function resolveSearchSubject(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<SearchSubject> {
  return resolveBrowserSubject(
    request, response, config, dependencies,
    () => new SearchError('SEARCH_SERVICE_UNAVAILABLE', 503, true),
  )
}

function resolveAssetSubject(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<SearchSubject> {
  return resolveBrowserSubject(
    request, response, config, dependencies,
    () => new CatalogError('ASSET_RESOLUTION_SERVICE_UNAVAILABLE', 503, true),
  )
}

function resolveComparisonSubject(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<ComparisonSubject> {
  return resolveBrowserSubject(
    request, response, config, dependencies,
    () => new ComparisonError('COMPARISON_SERVICE_UNAVAILABLE', 503, true),
  )
}

async function resolveAuthenticatedSearchSubject(
  request: IncomingMessage,
  dependencies: ApiServerDependencies,
): Promise<SearchSubject> {
  const session = await resolveAuthenticatedSession(request, dependencies)
  return Object.freeze({ kind: 'user', id: session.userId })
}

async function resolveAuthenticatedSession(
  request: IncomingMessage,
  dependencies: ApiServerDependencies,
): Promise<SessionProjection> {
  const identity = requireIdentity(dependencies)
  const cookies = parseCookies(request)
  return identity.getSession(
    cookies[authCookieNames.session] ?? null,
    cookies[authCookieNames.csrf] ?? null,
  )
}

function requireSearchMutationCsrf(request: IncomingMessage): void {
  const cookies = parseCookies(request)
  const csrfHeader = request.headers['x-csrf-token']
  const csrfCookie = cookies[authCookieNames.csrf]
  if (typeof csrfHeader !== 'string' || !csrfCookie || csrfHeader !== csrfCookie) {
    throw new SearchError('CSRF_INVALID', 403)
  }
}

function requireComparisonMutationCsrf(request: IncomingMessage): void {
  const cookies = parseCookies(request)
  const csrfHeader = request.headers['x-csrf-token']
  const csrfCookie = cookies[authCookieNames.csrf]
  if (typeof csrfHeader !== 'string' || !csrfCookie || csrfHeader !== csrfCookie) {
    throw new ComparisonError('CSRF_INVALID', 403)
  }
}

function requireCommunityMutationCsrf(request: IncomingMessage): void {
  const cookies = parseCookies(request)
  const csrfHeader = request.headers['x-csrf-token']
  const csrfCookie = cookies[authCookieNames.csrf]
  if (typeof csrfHeader !== 'string' || !csrfCookie || csrfHeader !== csrfCookie) {
    throw new CommunityError('CSRF_INVALID', 403)
  }
}

async function handleSearchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  method: string,
  requestId: string,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const queryPath = path.match(/^\/api\/v1\/query-snapshots\/([^/]+)$/)
  const queryLinkPath = path.match(/^\/api\/v1\/query-snapshots\/([^/]+)\/authorized-subjects$/)
  const queryUnlinkPath = path.match(/^\/api\/v1\/query-snapshots\/([^/]+)\/authorized-subjects\/me$/)
  if (
    path !== '/api/v1/search' && queryPath === null &&
    queryLinkPath === null && queryUnlinkPath === null
  ) return null
  const search = requireSearch(dependencies)

  if (queryPath !== null && method === 'GET') {
    const subject = await resolveSearchSubject(request, response, config, dependencies)
    const projection = await search.getQuerySnapshot(queryPath[1]!, subject, requestId)
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (queryLinkPath !== null && method === 'POST') {
    if (!requestOriginAllowed(request, config)) throw new SearchError('ORIGIN_INVALID', 403)
    const subject = await resolveAuthenticatedSearchSubject(request, dependencies)
    requireSearchMutationCsrf(request)
    const body = await readJsonBody(request)
    exactKeys(body, ['identity_link_id', 'expected_version', 'operation_id'])
    const projection = await search.linkQuery(queryLinkPath[1]!, {
      identityLinkId: stringField(body, 'identity_link_id', { maximum: 64 })!,
      expectedVersion: integerField(body, 'expected_version', 1),
      operationId: stringField(body, 'operation_id', { maximum: 64 })!,
    }, subject, requestId)
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (queryUnlinkPath !== null && method === 'DELETE') {
    if (!requestOriginAllowed(request, config)) throw new SearchError('ORIGIN_INVALID', 403)
    const subject = await resolveAuthenticatedSearchSubject(request, dependencies)
    requireSearchMutationCsrf(request)
    const body = await readJsonBody(request)
    exactKeys(body, ['expected_version', 'operation_id'])
    await search.unlinkQuery(queryUnlinkPath[1]!, {
      expectedVersion: integerField(body, 'expected_version', 1),
      operationId: stringField(body, 'operation_id', { maximum: 64 })!,
    }, subject, requestId)
    response.writeHead(204, { 'cache-control': 'no-store', 'x-request-id': requestId })
    response.end()
    return 204
  }

  if (queryPath !== null && method === 'DELETE') {
    if (!requestOriginAllowed(request, config)) throw new SearchError('ORIGIN_INVALID', 403)
    const body = await readJsonBody(request)
    exactKeys(body, ['operation_id'])
    const subject = await resolveSearchSubject(request, response, config, dependencies)
    if (subject.kind === 'user') requireSearchMutationCsrf(request)
    await search.invalidateQuery(queryPath[1]!, {
      operationId: stringField(body, 'operation_id', { maximum: 64 })!,
    }, subject, requestId)
    response.writeHead(204, { 'cache-control': 'no-store', 'x-request-id': requestId })
    response.end()
    return 204
  }

  if (path !== '/api/v1/search' || method !== 'POST') return null
  if (!requestOriginAllowed(request, config)) throw new SearchError('ORIGIN_INVALID', 403)
  const body = await readJsonBody(request)
  exactKeys(body, ['query', 'query_id', 'mode', 'category_id', 'filters', 'sort', 'cursor', 'locale'])
  const query = body.query === null ? null : stringField(body, 'query', { maximum: 500, optional: true })
  const queryId = body.query_id === null
    ? null
    : stringField(body, 'query_id', { maximum: 64, optional: true })
  const mode = stringField(body, 'mode', { maximum: 16 })!
  const categoryId = body.category_id === null
    ? null
    : stringField(body, 'category_id', { maximum: 64, optional: true })
  const sort = stringField(body, 'sort', { maximum: 32, optional: true }) ?? 'relevance'
  const cursor = body.cursor === null
    ? null
    : stringField(body, 'cursor', { maximum: 2_048, optional: true })
  const locale = stringField(body, 'locale', { maximum: 35, optional: true }) ?? 'zh-CN'
  const subject = await resolveSearchSubject(request, response, config, dependencies)
  const result = await search.search({
    query,
    queryId,
    mode: mode as SearchCommand['mode'],
    categoryId: categoryId as SearchCommand['categoryId'],
    filters: body.filters,
    sort: sort as SearchCommand['sort'],
    cursor,
    locale,
    rateLimitKey: clientIp(request) ?? 'unknown',
  }, subject)
  writeJson(response, 200, result, requestId)
  return 200
}

async function handleCatalogRequest(
  response: ServerResponse,
  url: URL,
  path: string,
  method: string,
  requestId: string,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const projectsPath = '/api/v1/projects'
  const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)$/)
  const projectEventsMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/events$/)
  const projectAssetsMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/assets$/)
  const creatorMatch = path.match(/^\/api\/v1\/creators\/([^/]+)$/)
  if (
    path !== projectsPath && projectMatch === null && projectEventsMatch === null &&
    projectAssetsMatch === null && creatorMatch === null
  ) return null
  if (method !== 'GET') return null
  const catalog = requireCatalog(dependencies)

  if (path === projectsPath) {
    exactQueryKeys(url.searchParams, ['category_id', 'limit', 'cursor'])
    const categoryValue = url.searchParams.get('category_id')
    const limitValue = url.searchParams.get('limit')
    const defaultPageSize = dependencies.catalogDefaultPageSize ?? 24
    const maximumPageSize = dependencies.catalogMaximumPageSize ?? 50
    let limit = defaultPageSize
    if (limitValue !== null) {
      if (!/^\d{1,3}$/.test(limitValue)) throw new CatalogError('LIMIT_INVALID', 400)
      limit = Number(limitValue)
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageSize) {
      throw new CatalogError('LIMIT_INVALID', 400)
    }
    const result = await catalog.listProjects({
      categoryId: categoryValue as CategoryId | null,
      limit,
      cursor: url.searchParams.get('cursor'),
    })
    writeJson(response, 200, result, requestId, 'public, max-age=30, stale-while-revalidate=60')
    return 200
  }

  if (projectEventsMatch !== null) {
    exactQueryKeys(url.searchParams, ['event_types', 'include_superseded', 'cursor'])
    const rawTypes = url.searchParams.get('event_types')
    const parsedTypes = rawTypes === null
      ? []
      : rawTypes.split(',')
    if (
      parsedTypes.some((value) => !eventTypes.includes(value as EventType)) ||
      new Set(parsedTypes).size !== parsedTypes.length
    ) throw new CatalogError('EVENT_TYPES_INVALID', 400)
    const rawIncludeSuperseded = url.searchParams.get('include_superseded')
    if (rawIncludeSuperseded !== null && rawIncludeSuperseded !== 'true' && rawIncludeSuperseded !== 'false') {
      throw new CatalogError('INCLUDE_SUPERSEDED_INVALID', 400)
    }
    const result = await catalog.listProjectEvents({
      projectId: projectEventsMatch[1]!,
      eventTypes: parsedTypes as EventType[],
      includeSuperseded: rawIncludeSuperseded === 'true',
      cursor: url.searchParams.get('cursor'),
    })
    writeJson(response, 200, result, requestId, 'public, max-age=30, stale-while-revalidate=60')
    return 200
  }
  if (projectAssetsMatch !== null) {
    exactQueryKeys(url.searchParams, ['cursor'])
    const result = await catalog.listProjectAssets({
      projectId: projectAssetsMatch[1]!,
      cursor: url.searchParams.get('cursor'),
    })
    writeJson(response, 200, result, requestId, 'public, max-age=30, stale-while-revalidate=60')
    return 200
  }
  if (projectMatch !== null) {
    exactQueryKeys(url.searchParams, [])
    const result = await catalog.getProject(projectMatch[1]!)
    response.setHeader('etag', `W/"project-${result.project_id}-${result.read_version}"`)
    writeJson(response, 200, result, requestId, 'public, max-age=60, stale-while-revalidate=120')
    return 200
  }
  exactQueryKeys(url.searchParams, [])
  const result = await catalog.getCreator(creatorMatch![1]!)
  response.setHeader('etag', `W/"creator-${result.creator_id}-${result.read_version}"`)
  writeJson(response, 200, result, requestId, 'public, max-age=60, stale-while-revalidate=120')
  return 200
}

async function handleAssetResolutionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  method: string,
  requestId: string,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const match = path.match(/^\/api\/v1\/assets\/([^/]+)\/resolve$/)
  if (match === null || method !== 'POST') return null
  if (!dependencies.assetResolver) {
    throw new CatalogError('ASSET_RESOLUTION_SERVICE_UNAVAILABLE', 503, true)
  }
  if (!requestOriginAllowed(request, config)) throw new CatalogError('ORIGIN_INVALID', 403)
  exactQueryKeys(url.searchParams, [])
  const body = await readJsonBody(request)
  exactKeys(body, ['attempt_id', 'target_kind'])
  const rawTargetKind = body.target_kind
  if (
    rawTargetKind !== undefined && rawTargetKind !== null &&
    rawTargetKind !== 'safe_web_url' && rawTargetKind !== 'contact_uri'
  ) throw new CatalogError('REQUEST_TARGET_KIND_INVALID', 422)
  const subject = await resolveAssetSubject(request, response, config, dependencies)
  const projection = await dependencies.assetResolver.resolve({
    assetId: match[1]!,
    attemptId: stringField(body, 'attempt_id', { maximum: 64 })!,
    targetKind: rawTargetKind ?? null,
    subject,
    requestId,
  })
  writeJson(response, 200, projection, requestId)
  return 200
}

async function handleComparisonRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  method: string,
  requestId: string,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const comparisonMatch = path.match(/^\/api\/v1\/comparisons\/([^/]+)$/)
  const savedMatch = path.match(/^\/api\/v1\/comparisons\/([^/]+)\/saved$/)
  const mergeConflictMatch = path.match(
    /^\/api\/v1\/auth\/comparison-merge-conflicts\/([^/]+)$/,
  )
  const mergeResolveMatch = path.match(
    /^\/api\/v1\/auth\/comparison-merge-conflicts\/([^/]+)\/resolve$/,
  )
  const mergeCancelMatch = path.match(
    /^\/api\/v1\/auth\/comparison-merge-conflicts\/([^/]+)\/cancel$/,
  )
  if (
    comparisonMatch === null && savedMatch === null && mergeConflictMatch === null &&
    mergeResolveMatch === null && mergeCancelMatch === null
  ) return null
  if (!dependencies.comparison) {
    throw new ComparisonError('COMPARISON_SERVICE_UNAVAILABLE', 503, true)
  }
  exactQueryKeys(url.searchParams, [])

  if (mergeConflictMatch !== null && method === 'GET') {
    const subject = await resolveAuthenticatedSearchSubject(request, dependencies)
    const projection = await dependencies.comparison.getMergeConflict({
      conflictId: mergeConflictMatch[1]!,
      subject,
    })
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (mergeResolveMatch !== null && method === 'POST') {
    if (!requestOriginAllowed(request, config)) throw new ComparisonError('ORIGIN_INVALID', 403)
    const body = await readJsonBody(request)
    exactKeys(body, [
      'selected_project_ids',
      'account_version',
      'anonymous_version',
      'expected_conflict_version',
      'operation_id',
    ])
    const subject = await resolveAuthenticatedSearchSubject(request, dependencies)
    requireComparisonMutationCsrf(request)
    const projection = await dependencies.comparison.resolveMergeConflict({
      conflictId: mergeResolveMatch[1]!,
      selectedProjectIds: stringArrayField(body, 'selected_project_ids', 5, 64),
      accountVersion: integerField(body, 'account_version', 1),
      anonymousVersion: integerField(body, 'anonymous_version', 1),
      expectedConflictVersion: integerField(body, 'expected_conflict_version', 1),
      operationId: stringField(body, 'operation_id', { maximum: 64 })!,
      subject,
    })
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (mergeCancelMatch !== null && method === 'POST') {
    if (!requestOriginAllowed(request, config)) throw new ComparisonError('ORIGIN_INVALID', 403)
    const body = await readJsonBody(request)
    exactKeys(body, ['cancel_reason', 'expected_conflict_version', 'operation_id'])
    const subject = await resolveAuthenticatedSearchSubject(request, dependencies)
    requireComparisonMutationCsrf(request)
    const projection = await dependencies.comparison.cancelMergeConflict({
      conflictId: mergeCancelMatch[1]!,
      cancelReason: stringField(body, 'cancel_reason', { maximum: 128 })!,
      expectedConflictVersion: integerField(body, 'expected_conflict_version', 1),
      operationId: stringField(body, 'operation_id', { maximum: 64 })!,
      subject,
    })
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (comparisonMatch !== null && method === 'GET') {
    const subject = await resolveComparisonSubject(request, response, config, dependencies)
    const projection = await dependencies.comparison.getComparison(comparisonMatch[1]!, subject)
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (!requestOriginAllowed(request, config)) throw new ComparisonError('ORIGIN_INVALID', 403)
  if (comparisonMatch !== null && method === 'PUT') {
    const body = await readJsonBody(request)
    exactKeys(body, ['ordered_project_ids', 'comparison_version', 'client_request_id'])
    const subject = await resolveComparisonSubject(request, response, config, dependencies)
    if (subject.kind === 'user') requireComparisonMutationCsrf(request)
    const projection = await dependencies.comparison.putComparison({
      comparisonId: comparisonMatch[1]!,
      orderedProjectIds: stringArrayField(body, 'ordered_project_ids', 6, 64),
      expectedVersion: integerField(body, 'comparison_version', 0),
      clientRequestId: stringField(body, 'client_request_id', { maximum: 64 })!,
      subject,
    })
    writeJson(response, 200, projection, requestId)
    return 200
  }

  if (savedMatch !== null && method === 'PUT') {
    const body = await readJsonBody(request)
    exactKeys(body, ['state', 'comparison_version'])
    const subject = await resolveAuthenticatedSearchSubject(request, dependencies)
    requireComparisonMutationCsrf(request)
    const projection = await dependencies.comparison.setSaved({
      comparisonId: savedMatch[1]!,
      comparisonVersion: integerField(body, 'comparison_version', 1),
      state: booleanField(body, 'state'),
      subject,
      requestId,
    })
    writeJson(response, 200, projection, requestId)
    return 200
  }

  return null
}

async function handleCommunityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  method: string,
  requestId: string,
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Promise<number | null> {
  const match = path.match(/^\/api\/v1\/interactions\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (match === null) return null
  if (method !== 'PUT') return null
  if (!dependencies.community) {
    throw new CommunityError('COMMUNITY_SERVICE_UNAVAILABLE', 503, true)
  }
  if (!requestOriginAllowed(request, config)) throw new CommunityError('ORIGIN_INVALID', 403)
  exactQueryKeys(url.searchParams, [])
  const body = await readJsonBody(request)
  exactKeys(body, ['state', 'client_request_id'])
  const session = await resolveAuthenticatedSession(request, dependencies)
  if (session.accountStatus === 'restricted') {
    throw new CommunityError('ACCOUNT_WRITE_RESTRICTED', 403)
  }
  requireCommunityMutationCsrf(request)
  const projection = await dependencies.community.setProjectInteraction({
    userId: session.userId,
    projectId: match[3]!,
    targetType: match[2]!,
    interactionType: match[1]!,
    state: booleanField(body, 'state'),
    clientRequestId: stringField(body, 'client_request_id', { maximum: 128 })!,
  })
  writeJson(response, 200, projection, requestId)
  return 200
}

export function createApiServer(
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Server {
  const now = dependencies.now ?? (() => new Date())

  return createServer((request, response) => {
    const requestId = requestIdFor(request)
    const startedAt = performance.now()
    const method = request.method ?? 'GET'
    let url = new URL('http://localhost/')
    let path = '/'
    try {
      url = new URL(request.url ?? '/', 'http://localhost')
      path = url.pathname
    } catch {
      path = '/'
    }
    applyCorsHeaders(request, response, config)

    void withSpan(
      'vibecheck-api',
      'http.request',
      {
        'http.request.method': method,
        'url.path': path,
      },
      async () => {
        let statusCode = 404
        try {
          if (
            method === 'OPTIONS' &&
            (path === '/api/v1' || path.startsWith('/api/v1/'))
          ) {
            statusCode = 204
            response.writeHead(statusCode, {
              'cache-control': 'no-store',
              'x-request-id': requestId,
            })
            response.end()
          } else if (method === 'GET' && path === '/health/live') {
            statusCode = 200
            writeJson(response, statusCode, healthBody(config, now, 'ok'), requestId)
          } else if (method === 'GET' && path === '/health/ready') {
            try {
              await dependencies.checkReadiness()
              statusCode = 200
              writeJson(
                response,
                statusCode,
                healthBody(config, now, 'ok', { database: 'ok' }),
                requestId,
              )
            } catch {
              statusCode = 503
              writeJson(
                response,
                statusCode,
                healthBody(config, now, 'degraded', { database: 'failed' }),
                requestId,
              )
            }
          } else {
            const authStatus = await handleAuthRequest(
              request,
              response,
              path,
              method,
              requestId,
              config,
              dependencies,
            )
            if (authStatus !== null) {
              statusCode = authStatus
            } else {
              const pendingActionStatus = await handlePendingActionRequest(
                request, response, url, path, method, requestId, config, dependencies,
              )
              if (pendingActionStatus !== null) {
                statusCode = pendingActionStatus
              } else {
                const communityStatus = await handleCommunityRequest(
                  request, response, url, path, method, requestId, config, dependencies,
                )
                if (communityStatus !== null) {
                  statusCode = communityStatus
                } else {
                  const comparisonStatus = await handleComparisonRequest(
                    request, response, url, path, method, requestId, config, dependencies,
                  )
                  if (comparisonStatus !== null) {
                    statusCode = comparisonStatus
                  } else {
                    const assetResolutionStatus = await handleAssetResolutionRequest(
                      request, response, url, path, method, requestId, config, dependencies,
                    )
                    if (assetResolutionStatus !== null) {
                      statusCode = assetResolutionStatus
                    } else {
                      const searchStatus = await handleSearchRequest(
                        request, response, path, method, requestId, config, dependencies,
                      )
                      if (searchStatus !== null) {
                        statusCode = searchStatus
                      } else {
                        const catalogStatus = await handleCatalogRequest(
                          response, url, path, method, requestId, dependencies,
                        )
                        if (catalogStatus !== null) {
                          statusCode = catalogStatus
                        } else {
                          const staticStatus = await handleStaticRequest(
                            request,
                            response,
                            path,
                            method,
                            requestId,
                            dependencies.staticDirectory,
                          )
                          if (staticStatus !== null) {
                            statusCode = staticStatus
                          } else {
                            statusCode = 404
                            writeJson(
                              response,
                              statusCode,
                              errorEnvelope('ROUTE_NOT_FOUND', requestId),
                              requestId,
                            )
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          const apiError = error instanceof IdentityError || error instanceof CatalogError ||
            error instanceof SearchError || error instanceof ComparisonError ||
            error instanceof CommunityError
            ? error
            : new IdentityError('INTERNAL_ERROR', 500, true)
          statusCode = apiError.httpStatus
          const retryAfterSeconds = apiError.retryAfterSeconds
          if (retryAfterSeconds !== undefined) {
            response.setHeader('retry-after', String(retryAfterSeconds))
          }
          if (!response.headersSent) {
            writeJson(
              response,
              statusCode,
              errorEnvelope(apiError.code, requestId, {
                retryable: apiError.retryable,
                ...(retryAfterSeconds === undefined
                  ? {}
                  : { retryAfterSeconds }),
                ...((apiError instanceof ComparisonError || apiError instanceof CommunityError) &&
                    apiError.details !== undefined
                  ? { details: apiError.details }
                  : {}),
              }),
              requestId,
            )
          } else {
            response.destroy()
          }
        }

        console.info(
          JSON.stringify(
            redactRecord({
              timestamp: now().toISOString(),
              level: 'info',
              service: config.serviceName,
              environment: config.environment,
              request_id: requestId,
              method,
              path,
              status_code: statusCode,
              duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
            }),
          ),
        )
      },
    ).catch((error: unknown) => {
      if (!response.headersSent) {
        writeJson(
          response,
          500,
          errorEnvelope('INTERNAL_ERROR', requestId, { retryable: true }),
          requestId,
        )
      } else {
        response.destroy(error instanceof Error ? error : undefined)
      }
    })
  })
}

export async function listen(server: Server, config: ServiceConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: config.host, port: config.port }, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

export async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
