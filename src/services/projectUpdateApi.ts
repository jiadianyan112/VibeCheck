export type ProjectUpdateType = 'version' | 'address' | 'status' | 'asset' | 'description'
export type ProjectUpdateStatus = 'editing' | 'update_pending' | 'changes_requested' | 'approved' | 'applying' | 'apply_failed' | 'rejected' | 'withdrawn' | 'applied'
export type ProjectUpdateCapability = 'ownership.view' | 'project_update.create' | 'project_update.submit'

export interface ProjectUpdateDiff {
  readonly field_path: string
  readonly after_value: unknown
}

export interface ProjectUpdateBeforeAfter {
  readonly field_path: string
  readonly before_value: unknown
  readonly after_value: unknown
}

export interface ProjectUpdateAuthorizationSnapshot {
  readonly creator_account_link_id: string
  readonly creator_id: string
  readonly author_relation_id: string
  readonly permission_profile_id: 'OWNER_V1' | 'MANAGER_V1'
  readonly permission_profile_version: 1
  readonly permission_profile_config_hash: string
  readonly link_version: number
  readonly author_relation_version: number
  readonly capabilities: readonly ProjectUpdateCapability[]
  readonly field_paths: readonly string[]
}

export interface ProjectUpdateProjection {
  readonly update_id: string
  readonly project_id: string
  readonly owner_user_id: string
  readonly origin_review_status: 'published_author'
  readonly base_version_id: string
  readonly current_version_id: string
  readonly update_type: ProjectUpdateType
  readonly category_change_type: string | null
  readonly payload_diff: readonly ProjectUpdateDiff[]
  readonly before_after: readonly ProjectUpdateBeforeAfter[]
  readonly evidence_draft_ids: readonly string[]
  readonly media_reference_ids: readonly string[]
  readonly authorization_snapshot: ProjectUpdateAuthorizationSnapshot
  readonly effective_capabilities: readonly ProjectUpdateCapability[]
  readonly effective_field_paths: readonly string[]
  readonly authorization_state: 'active' | 'revoked'
  readonly status: ProjectUpdateStatus
  readonly review_work_item_id: string | null
  readonly apply_attempt_count: number
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface ProjectUpdatePreview {
  readonly update_id: string
  readonly version: number
  readonly preview_hash: string
  readonly base_version_id: string
  readonly current_version_id: string
  readonly before_after: readonly ProjectUpdateBeforeAfter[]
  readonly authorization_snapshot: ProjectUpdateAuthorizationSnapshot
  readonly validation: {
    readonly ready_for_submit: true
    readonly changed_field_count: number
    readonly evidence_draft_count: number
    readonly media_reference_count: number
  }
}

export interface ProjectUpdateSubmission {
  readonly update_id: string
  readonly status: 'update_pending'
  readonly version: number
  readonly review_work_item_id: string
  readonly work_item_status: 'queued'
  readonly submitted_at: string
}

export interface ProjectUpdateWithdrawal {
  readonly update_id: string
  readonly from_status: 'editing' | 'update_pending' | 'changes_requested' | 'apply_failed'
  readonly status: 'withdrawn'
  readonly version: number
  readonly review_work_item_id: string | null
  readonly work_item_status: 'cancelled' | null
  readonly withdrawn_at: string
}

export interface ProjectUpdateSession {
  readonly csrf_token: string
}

export class ProjectUpdateApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId: string | null = null,
  ) {
    super(code)
    this.name = 'ProjectUpdateApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

interface ErrorBody {
  readonly error?: { readonly code?: unknown }
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function parseError(response: Response): Promise<ProjectUpdateApiError> {
  let body: ErrorBody = {}
  try {
    body = await response.json() as ErrorBody
  } catch {
    // Preserve the HTTP status when an upstream proxy returns no JSON body.
  }
  return new ProjectUpdateApiError(
    typeof body.error?.code === 'string' ? body.error.code : 'PROJECT_UPDATE_REQUEST_FAILED',
    response.status,
    response.headers.get('x-request-id'),
  )
}

async function request<T>(path: string, options: {
  readonly method?: 'GET' | 'POST' | 'PATCH'
  readonly session?: ProjectUpdateSession
  readonly body?: unknown
  readonly signal?: AbortSignal
} = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': requestId() }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.session) headers['x-csrf-token'] = options.session.csrf_token
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ProjectUpdateApiError('NETWORK_UNAVAILABLE', 0)
  }
  if (!response.ok) throw await parseError(response)
  try {
    return await response.json() as T
  } catch {
    throw new ProjectUpdateApiError('PROJECT_UPDATE_INVALID_RESPONSE', response.status)
  }
}

export const projectUpdateApi = {
  create(input: {
    readonly session: ProjectUpdateSession
    readonly projectId: string
    readonly updateType: ProjectUpdateType
    readonly baseVersionId: string
    readonly clientRequestId: string
    readonly signal?: AbortSignal
  }): Promise<ProjectUpdateProjection> {
    return request('/api/v1/project-updates', {
      method: 'POST', session: input.session, signal: input.signal,
      body: { project_id: input.projectId, update_type: input.updateType, base_version_id: input.baseVersionId, client_request_id: input.clientRequestId },
    })
  },

  get(input: { readonly updateId: string; readonly signal?: AbortSignal }): Promise<ProjectUpdateProjection> {
    return request(`/api/v1/project-updates/${encodeURIComponent(input.updateId)}`, { signal: input.signal })
  },

  patch(input: {
    readonly session: ProjectUpdateSession
    readonly updateId: string
    readonly expectedVersion: number
    readonly diff: readonly ProjectUpdateDiff[]
    readonly evidenceDraftIds: readonly string[]
    readonly mediaReferenceIds: readonly string[]
    readonly operationId: string
    readonly signal?: AbortSignal
  }): Promise<ProjectUpdateProjection> {
    return request(`/api/v1/project-updates/${encodeURIComponent(input.updateId)}`, {
      method: 'PATCH', session: input.session, signal: input.signal,
      body: { expected_version: input.expectedVersion, diff: input.diff, evidence_draft_ids: input.evidenceDraftIds, media_reference_ids: input.mediaReferenceIds, operation_id: input.operationId },
    })
  },

  preview(input: { readonly session: ProjectUpdateSession; readonly updateId: string; readonly expectedVersion: number; readonly signal?: AbortSignal }): Promise<ProjectUpdatePreview> {
    return request(`/api/v1/project-updates/${encodeURIComponent(input.updateId)}/preview`, {
      method: 'POST', session: input.session, signal: input.signal, body: { expected_version: input.expectedVersion },
    })
  },

  submit(input: { readonly session: ProjectUpdateSession; readonly updateId: string; readonly version: number; readonly previewHash: string; readonly submissionKey: string; readonly signal?: AbortSignal }): Promise<ProjectUpdateSubmission> {
    return request(`/api/v1/project-updates/${encodeURIComponent(input.updateId)}/submit`, {
      method: 'POST', session: input.session, signal: input.signal, body: { version: input.version, preview_hash: input.previewHash, submission_key: input.submissionKey },
    })
  },

  withdraw(input: { readonly session: ProjectUpdateSession; readonly updateId: string; readonly expectedVersion: number; readonly operationId: string; readonly reasonCode?: string | null; readonly signal?: AbortSignal }): Promise<ProjectUpdateWithdrawal> {
    return request(`/api/v1/project-updates/${encodeURIComponent(input.updateId)}/withdraw`, {
      method: 'POST', session: input.session, signal: input.signal,
      body: { expected_version: input.expectedVersion, operation_id: input.operationId, reason_code: input.reasonCode ?? null },
    })
  },
}
