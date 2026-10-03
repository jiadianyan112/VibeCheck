import type { AuthSessionDto } from './authService'

export interface ServerNotification {
  readonly notification_id: string
  readonly type: 'submission_published' | 'project_updated'
  readonly title: string
  readonly body_summary: string
  readonly target_type: 'project'
  readonly target_id: string
  readonly event_id: string | null
  readonly read_at: string | null
  readonly created_at: string
}

export interface ServerNotificationPage {
  readonly items: readonly ServerNotification[]
  readonly next_cursor: string | null
  readonly unread_count: number
}

export interface ServerNotificationReadResult {
  readonly read: true
  readonly changed_count: number
  readonly unread_count: number
  readonly read_at: string
}

export class ServerNotificationApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'ServerNotificationApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function request<T>(path: string, session?: AuthSessionDto, body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: body ? 'PUT' : 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'x-request-id': requestId(),
        ...(body ? { 'content-type': 'application/json', 'x-csrf-token': session?.csrf_token ?? '' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ServerNotificationApiError('NETWORK_UNAVAILABLE', 0)
  }
  const payload: unknown = await response.json().catch(() => null)
  if (response.ok) return payload as T
  const code = typeof payload === 'object' && payload !== null && 'error' in payload &&
    typeof payload.error === 'object' && payload.error !== null && 'code' in payload.error &&
    typeof payload.error.code === 'string' ? payload.error.code : 'NOTIFICATION_REQUEST_FAILED'
  throw new ServerNotificationApiError(code, response.status)
}

export const serverNotificationApi = {
  list(cursor: string | null = null): Promise<ServerNotificationPage> {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    return request(`/api/v1/notifications?${params}`)
  },

  markRead(session: AuthSessionDto, notificationIds: readonly string[]): Promise<ServerNotificationReadResult> {
    return request('/api/v1/notifications/read-state', session, {
      notification_ids: notificationIds,
      read: true,
      operation_id: requestId(),
    })
  },

  markAllRead(session: AuthSessionDto): Promise<ServerNotificationReadResult> {
    return request('/api/v1/notifications/read-state', session, {
      scope: 'all',
      read: true,
      operation_id: requestId(),
    })
  },
}
