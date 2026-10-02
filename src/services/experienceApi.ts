import type { AuthSessionDto } from './authService'

export interface Experience {
  readonly comment_id: string
  readonly project_id: string
  readonly task: string
  readonly outcome: string
  readonly scenario: string | null
  readonly limitation: string | null
  readonly screenshot_media_resource_ids: readonly string[]
  readonly author_label: string
  readonly author_reply: string | null
  readonly author_reply_at: string | null
  readonly replies: readonly { comment_id: string; body: string; created_at: string; moderation_state: 'visible' | 'collapsed' }[]
  readonly created_at: string
}

export interface ExperiencePage {
  readonly items: readonly Experience[]
  readonly next_cursor: string | null
}

export class ExperienceApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'ExperienceApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `vc-${Date.now()}-${Math.random().toString(36).slice(2)}`

async function request<T>(path: string, options: {
  session?: AuthSessionDto | null
  body?: object
  method?: 'POST'
  requestId?: string
} = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? 'GET', credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json', 'x-request-id': requestId(),
        ...(options.method ? {
          'content-type': 'application/json',
          'x-csrf-token': options.session?.csrf_token ?? '',
        } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch { throw new ExperienceApiError('NETWORK_UNAVAILABLE', 0) }
  if (response.ok) return await response.json() as T
  const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null
  throw new ExperienceApiError(payload?.error?.code ?? 'EXPERIENCE_REQUEST_FAILED', response.status)
}

export const experienceApi = {
  list(projectId: string, cursor: string | null = null) {
    const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return request<ExperiencePage>(`/api/v1/projects/${encodeURIComponent(projectId)}/experiences${params}`)
  },
  create(projectId: string, session: AuthSessionDto, data: {
    task: string; outcome: string; scenario: string | null; limitation: string | null;
    screenshot_media_resource_ids: readonly string[]; client_request_id: string
  }) {
    return request<Experience>(`/api/v1/projects/${encodeURIComponent(projectId)}/experiences`, {
      session, method: 'POST', body: data,
    })
  },
  reply(experienceId: string, session: AuthSessionDto, body: string) {
    return request(`/api/v1/experiences/${encodeURIComponent(experienceId)}/replies`, {
      session, method: 'POST', body: { body, client_request_id: requestId() },
    })
  },
  report(experienceId: string, session: AuthSessionDto) {
    return request(`/api/v1/comments/${encodeURIComponent(experienceId)}/reports`, {
      session, method: 'POST', body: { reason_code: 'unsafe_content', client_request_id: requestId() },
    })
  },
  screenshotUrl(experienceId: string, mediaResourceId: string) {
    return `${apiBase}/api/v1/experiences/${encodeURIComponent(experienceId)}/screenshots/${encodeURIComponent(mediaResourceId)}/content`
  },
}
