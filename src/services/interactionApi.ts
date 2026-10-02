import type { AuthSessionDto } from './authService'

export interface InteractionSnapshot {
  readonly project_id: string
  readonly states: {
    readonly favorite: boolean
    readonly like: boolean
    readonly follow: boolean
  }
  readonly counts: {
    readonly favorite_count: number
    readonly like_count: number
    readonly follower_count: number
  }
}

export class InteractionApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'InteractionApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const interactionBatchSize = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isInteractionSnapshot(value: unknown): value is InteractionSnapshot {
  if (!isRecord(value) || typeof value.project_id !== 'string' || value.project_id.length === 0) return false
  if (!isRecord(value.states) || !isRecord(value.counts)) return false
  return isBoolean(value.states.favorite) &&
    isBoolean(value.states.like) &&
    isBoolean(value.states.follow) &&
    isNonNegativeSafeInteger(value.counts.favorite_count) &&
    isNonNegativeSafeInteger(value.counts.like_count) &&
    isNonNegativeSafeInteger(value.counts.follower_count)
}

function snapshotFrom(value: unknown, status: number, expectedProjectId?: string): InteractionSnapshot {
  if (!isInteractionSnapshot(value) || (expectedProjectId !== undefined && value.project_id !== expectedProjectId)) {
    throw new InteractionApiError('INTERACTION_INVALID_RESPONSE', status)
  }
  return {
    project_id: value.project_id,
    states: {
      favorite: value.states.favorite,
      like: value.states.like,
      follow: value.states.follow,
    },
    counts: {
      favorite_count: value.counts.favorite_count,
      like_count: value.counts.like_count,
      follower_count: value.counts.follower_count,
    },
  }
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `vc-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function errorCode(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.code !== 'string') return null
  return payload.error.code
}

async function request(path: string, init: RequestInit): Promise<{ readonly payload: unknown; readonly status: number }> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...init.headers,
      },
    })
  } catch {
    throw new InteractionApiError('NETWORK_UNAVAILABLE', 0)
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new InteractionApiError(errorCode(payload) ?? 'INTERACTION_REQUEST_FAILED', response.status)
  }
  return { payload, status: response.status }
}

export const interactionApi = {
  async list(projectIds: readonly string[], signal?: AbortSignal): Promise<InteractionSnapshot[]> {
    if (projectIds.length === 0) return []

    const items: InteractionSnapshot[] = []
    const seenProjectIds = new Set<string>()
    for (let start = 0; start < projectIds.length; start += interactionBatchSize) {
      const ids = projectIds.slice(start, start + interactionBatchSize)
      const requestedProjectIds = new Set(ids)
      const params = new URLSearchParams({ project_ids: ids.join(',') })
      const { payload, status } = await request(`/api/v1/interactions/projects?${params.toString()}`, {
        method: 'GET',
        ...(signal === undefined ? {} : { signal }),
      })
      if (!isRecord(payload) || !Array.isArray(payload.items)) {
        throw new InteractionApiError('INTERACTION_INVALID_RESPONSE', status)
      }
      for (const item of payload.items) {
        const snapshot = snapshotFrom(item, status)
        if (!requestedProjectIds.has(snapshot.project_id) || seenProjectIds.has(snapshot.project_id)) {
          throw new InteractionApiError('INTERACTION_INVALID_RESPONSE', status)
        }
        seenProjectIds.add(snapshot.project_id)
        items.push(snapshot)
      }
    }
    return items
  },

  async setLike(projectId: string, state: boolean, session: AuthSessionDto): Promise<InteractionSnapshot> {
    const { payload, status } = await request(`/api/v1/interactions/like/project/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': session.csrf_token,
      },
      body: JSON.stringify({ state, client_request_id: requestId() }),
    })
    return snapshotFrom(payload, status, projectId)
  },
}
