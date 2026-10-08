export type DeveloperKind = 'individual' | 'team'
export type DeveloperVerificationStatus = 'unverified' | 'verified' | 'disputed'
export type MyProjectVerificationStatus = 'draft' | 'pending' | 'changes_requested' | 'verified' | 'failed' | 'withdrawn'

export interface MyProjectDeveloper {
  readonly kind: DeveloperKind
  readonly display_name: string
  readonly avatar_url: string | null
  readonly website_url: string | null
  readonly creator_id: string | null
  readonly verification_status: DeveloperVerificationStatus
}

export interface MyProjectItem {
  readonly project_id: string
  readonly current_name: string
  readonly developer: MyProjectDeveloper | null
  readonly verification_id: string | null
  readonly verification_status: MyProjectVerificationStatus | null
  readonly can_manage: boolean
}

export interface MyProjectPage {
  readonly items: readonly MyProjectItem[]
  readonly next_cursor: string | null
}

export interface ListMyProjectsOptions {
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly cursor?: string | null
  readonly projectId?: string
}

interface ErrorBody {
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
    readonly message_key?: unknown
  }
}

export class DeveloperApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId: string | null = null,
  ) {
    super(code)
    this.name = 'DeveloperApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function readError(response: Response): Promise<DeveloperApiError> {
  let body: ErrorBody = {}
  try {
    body = await response.json() as ErrorBody
  } catch {
    // Keep a stable client error when an upstream proxy returns non-JSON.
  }
  const code = typeof body.error?.code === 'string' ? body.error.code : response.status === 401 ? 'AUTH_REQUIRED' : 'DEVELOPER_REQUEST_FAILED'
  return new DeveloperApiError(code, response.status, response.headers.get('x-request-id'))
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new DeveloperApiError('NETWORK_UNAVAILABLE', 0)
  }
  if (!response.ok) throw await readError(response)
  try {
    return await response.json() as T
  } catch {
    throw new DeveloperApiError('DEVELOPER_INVALID_RESPONSE', response.status)
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 50
  if (!Number.isInteger(value) || value < 1) return 1
  return Math.min(value, 50)
}

export const developerApi = {
  listMyProjects(options: ListMyProjectsOptions = {}): Promise<MyProjectPage> {
    const params = new URLSearchParams({ limit: String(normalizeLimit(options.limit)) })
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.projectId) params.set('project_id', options.projectId)
    return get<MyProjectPage>(`/api/v1/me/projects?${params.toString()}`, options.signal)
  },
}
