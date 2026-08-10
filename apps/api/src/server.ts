import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { ServiceConfig } from '@vibecheck/config'
import type { ServiceHealth } from '@vibecheck/contracts'
import { redactRecord, withSpan } from '@vibecheck/observability'

const serviceVersion = '0.1.0'

export interface ApiServerDependencies {
  readonly checkReadiness: () => Promise<void>
  readonly now?: () => Date
}

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
          statusCode = 404
          writeJson(
            response,
            statusCode,
            {
              error_code: 'ROUTE_NOT_FOUND',
              message_key: 'error.route_not_found',
              request_id: requestId,
              retryable: false,
            },
            requestId,
          )
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
          {
            error_code: 'INTERNAL_ERROR',
            message_key: 'error.internal',
            request_id: requestId,
            retryable: true,
          },
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
