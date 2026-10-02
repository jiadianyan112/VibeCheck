import type { AuthSessionDto } from './authService'

export interface DiscussionComment {
  readonly comment_id: string
  readonly project_id: string
  readonly parent_comment_id: string | null
  readonly body: string
  readonly moderation_state: 'visible' | 'collapsed'
  readonly created_at: string
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const id = () => crypto.randomUUID()

async function call<T>(path: string, options: { session?: AuthSessionDto; body?: object } = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.body ? 'POST' : 'GET', credentials: 'include',
    headers: { accept: 'application/json', 'x-request-id': id(), ...(options.body ? { 'content-type': 'application/json', 'x-csrf-token': options.session?.csrf_token ?? '' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`)
  }
  return await response.json() as T
}

export const discussionApi = {
  list(projectId: string) { return call<{ items: DiscussionComment[]; next_cursor: string | null }>(`/api/v1/projects/${encodeURIComponent(projectId)}/comments`) },
  create(projectId: string, session: AuthSessionDto, body: string, parentId: string | null, clientRequestId: string = id()) {
    return call(`/api/v1/projects/${encodeURIComponent(projectId)}/comments`, { session, body: { body, parent_comment_id: parentId, client_request_id: clientRequestId } })
  },
  report(commentId: string, session: AuthSessionDto) {
    return call(`/api/v1/comments/${encodeURIComponent(commentId)}/reports`, { session, body: { reason_code: 'unsafe_content', client_request_id: id() } })
  },
}
