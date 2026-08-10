import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

import type { ServiceConfig } from '@vibecheck/config'
import type { ServiceHealth } from '@vibecheck/contracts'
import {
  IdentityError,
  type SessionProjection,
  type StartChallengeCommand,
  type StartChallengeResult,
  type VerifyChallengeCommand,
  type VerifyChallengeResult,
} from '@vibecheck/identity'
import { redactRecord, withSpan } from '@vibecheck/observability'

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

export interface ApiServerDependencies {
  readonly checkReadiness: () => Promise<void>
  readonly identity?: ApiIdentityService
  readonly authCookieSecure?: boolean
  readonly anonymousCookieSecret?: string
  readonly staticDirectory?: string
  readonly now?: () => Date
}

interface ErrorEnvelopeOptions {
  readonly retryable?: boolean
  readonly retryAfterSeconds?: number
}

type JsonObject = Record<string, unknown>

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  requestId: string,
): void {
  const encoded = JSON.stringify(body)
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(encoded),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  })
  response.end(encoded)
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
    exactKeys(body, ['email', 'purpose', 'return_to', 'client_request_id', 'preview_token'])
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

export function createApiServer(
  config: ServiceConfig,
  dependencies: ApiServerDependencies,
): Server {
  const now = dependencies.now ?? (() => new Date())

  return createServer((request, response) => {
    const requestId = requestIdFor(request)
    const startedAt = performance.now()
    const method = request.method ?? 'GET'
    let path = '/'
    try {
      path = new URL(request.url ?? '/', 'http://localhost').pathname
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
        } catch (error) {
          const identityError = error instanceof IdentityError
            ? error
            : new IdentityError('INTERNAL_ERROR', 500, true)
          statusCode = identityError.httpStatus
          if (identityError.retryAfterSeconds !== undefined) {
            response.setHeader('retry-after', String(identityError.retryAfterSeconds))
          }
          if (!response.headersSent) {
            writeJson(
              response,
              statusCode,
              errorEnvelope(identityError.code, requestId, {
                retryable: identityError.retryable,
                ...(identityError.retryAfterSeconds === undefined
                  ? {}
                  : { retryAfterSeconds: identityError.retryAfterSeconds }),
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
