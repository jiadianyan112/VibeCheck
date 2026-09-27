import type { AuthSessionDto } from './authService'

export interface SubmissionWorkItem {
  readonly work_item_id: string
  readonly target_id: string
  readonly work_item_status: 'queued' | 'claimed' | 'decided' | 'cancelled'
  readonly version: number
  readonly domain_summary: {
    readonly status: string
    readonly version?: number
    readonly current_name?: string
    readonly public_url?: string
    readonly one_line_definition?: string
  }
  readonly created_at: string
}

export interface ClaimedSubmissionWorkItem extends SubmissionWorkItem {
  readonly claim_token: string
}

export class ReviewApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'ReviewApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function request<T>(path: string, session?: AuthSessionDto, body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'x-request-id': requestId(),
        ...(body ? { 'content-type': 'application/json', 'x-csrf-token': session?.csrf_token ?? '' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ReviewApiError('NETWORK_UNAVAILABLE', 0)
  }
  if (response.ok) return await response.json() as T
  const error = await response.json().catch(() => null) as { error?: { code?: string } } | null
  throw new ReviewApiError(error?.error?.code ?? 'REVIEW_REQUEST_FAILED', response.status)
}

export const reviewApi = {
  async listPending(): Promise<SubmissionWorkItem[]> {
    const result: SubmissionWorkItem[] = []
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ work_type: 'submission', status: 'queued' })
      if (cursor) params.set('cursor', cursor)
      const page: { items: SubmissionWorkItem[]; next_cursor: string | null } = await request(`/api/v1/admin/work-items?${params}`)
      result.push(...page.items)
      cursor = page.next_cursor
    } while (cursor)
    return result
  },

  claim(item: SubmissionWorkItem, session: AuthSessionDto) {
    return request<ClaimedSubmissionWorkItem>(`/api/v1/admin/work-items/${encodeURIComponent(item.work_item_id)}/claim`, session, {
      expected_version: item.version,
      expected_conflict_principal_version: null,
    })
  },

  heartbeat(item: ClaimedSubmissionWorkItem, session: AuthSessionDto) {
    return request<SubmissionWorkItem>(`/api/v1/admin/work-items/${encodeURIComponent(item.work_item_id)}/heartbeat`, session, {
      claim_token: item.claim_token,
    })
  },

  preview(item: ClaimedSubmissionWorkItem, session: AuthSessionDto, decision: 'approve' | 'changes_requested' | 'reject', reasonCode: string) {
    return request<{ preview_token: string; confirmation_summary_hash: string; conflict_principal_version: number | null }>(
      '/api/v1/admin/operations/preview', session, {
        operation_type: 'submission_review',
        targets: [{ target_type: 'submission', target_id: item.target_id }],
        expected_versions: { submission: item.domain_summary.version, work_item: item.version },
        proposed_diff: { review_status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'changes_requested' },
        reason_code: reasonCode,
        claim_token: item.claim_token,
        expected_conflict_principal_version: null,
      },
    )
  },

  confirm(preview: { preview_token: string; confirmation_summary_hash: string }, session: AuthSessionDto, reauthGrantId: string | null, confirmRequestId: string) {
    return request<{ confirm_token: string }>('/api/v1/admin/operations/confirm', session, {
      preview_token: preview.preview_token,
      confirmation_summary_hash: preview.confirmation_summary_hash,
      confirm_request_id: confirmRequestId,
      reauth_grant_id: reauthGrantId,
      expected_conflict_principal_version: null,
    })
  },

  decide(item: ClaimedSubmissionWorkItem, previewToken: string, confirmToken: string, session: AuthSessionDto, decision: 'approve' | 'changes_requested' | 'reject', reasonCode: string, fieldPaths: string[], decisionRequestId: string) {
    return request<{ review_decision_id: string; resulting_status: string; project_id: string | null }>(
      `/api/v1/admin/work-items/${encodeURIComponent(item.work_item_id)}/decision`, session, {
        preview_token: previewToken,
        claim_token: item.claim_token,
        confirm_token: confirmToken,
        decision,
        reason_code: reasonCode,
        field_paths: fieldPaths,
        decision_evidence_refs: [],
        expected_version: item.version,
        decision_request_id: decisionRequestId,
        decision_payload: {},
      },
    )
  },
}
