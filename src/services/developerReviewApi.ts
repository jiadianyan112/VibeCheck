import { createAuthRequestId, type AuthSessionDto } from './authService'
import { authorContentP0V1FieldPaths } from '@vibecheck/contracts'
import {
  verificationApi,
  type PermissionProfileRef,
  type VerificationReviewerProjection,
} from './verificationApi'

export interface DeveloperVerificationWorkItem {
  readonly work_item_id: string
  readonly work_type?: 'verification'
  readonly target_type?: 'verification_request'
  readonly target_id: string
  readonly work_item_status: 'queued' | 'claimed' | 'decided' | 'cancelled'
  readonly version: number
  readonly assignee_user_id?: string | null
  readonly lease_expires_at?: string | null
  readonly domain_summary: { readonly status: string; readonly version?: number; readonly current_name?: string }
  readonly created_at: string
  readonly updated_at?: string
}

export interface ClaimedDeveloperVerificationWorkItem extends DeveloperVerificationWorkItem {
  readonly claim_token: string
}

export interface ReviewPreview {
  readonly preview_token: string
  readonly confirmation_summary_hash: string
  readonly conflict_principal_version: number | null
  readonly expires_at?: string
}

export class DeveloperReviewApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryable: boolean, readonly requestId: string | null = null) {
    super(code)
    this.name = 'DeveloperReviewApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function requestId() {
  return createAuthRequestId()
}

async function request<T>(path: string, session?: AuthSessionDto, options: { readonly body?: object; readonly claimToken?: string } = {}): Promise<T> {
  const id = requestId()
  const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': id }
  if (options.claimToken) headers['x-review-claim-token'] = options.claimToken
  if (options.body) {
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session?.csrf_token ?? ''
  }
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, { method: options.body ? 'POST' : 'GET', credentials: 'include', headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}) })
  } catch {
    throw new DeveloperReviewApiError('NETWORK_UNAVAILABLE', 0, true, id)
  }
  if (response.ok) return await response.json() as T
  const body = await response.json().catch(() => null) as { error?: { code?: unknown; retryable?: unknown; request_id?: unknown } } | null
  const error = body?.error
  const code = typeof error?.code === 'string' ? error.code : 'REVIEW_REQUEST_FAILED'
  throw new DeveloperReviewApiError(code, response.status, typeof error?.retryable === 'boolean' ? error.retryable : response.status >= 500 || response.status === 409, typeof error?.request_id === 'string' ? error.request_id : response.headers.get('x-request-id'))
}

export const developerReviewApi = {
  async listPending(): Promise<DeveloperVerificationWorkItem[]> {
    const result: DeveloperVerificationWorkItem[] = []
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ work_type: 'verification', status: 'queued' })
      if (cursor) params.set('cursor', cursor)
      const page = await request<{ readonly items: readonly DeveloperVerificationWorkItem[]; readonly next_cursor: string | null }>(`/api/v1/admin/work-items?${params.toString()}`)
      result.push(...page.items)
      cursor = page.next_cursor
    } while (cursor)
    return result
  },

  claim(item: DeveloperVerificationWorkItem, session: AuthSessionDto) {
    return request<ClaimedDeveloperVerificationWorkItem>(`/api/v1/admin/work-items/${encodeURIComponent(item.work_item_id)}/claim`, session, {
      body: { expected_version: item.version, expected_conflict_principal_version: null },
    })
  },

  heartbeat(item: ClaimedDeveloperVerificationWorkItem, session: AuthSessionDto) {
    return request<DeveloperVerificationWorkItem>(`/api/v1/admin/work-items/${encodeURIComponent(item.work_item_id)}/heartbeat`, session, { body: { claim_token: item.claim_token } })
  },

  release(item: ClaimedDeveloperVerificationWorkItem, session: AuthSessionDto, reasonCode = 'reviewer_released') {
    return request<DeveloperVerificationWorkItem>(`/api/v1/admin/work-items/${encodeURIComponent(item.work_item_id)}/release`, session, { body: { claim_token: item.claim_token, reason_code: reasonCode } })
  },

  getClaimedDetail(item: ClaimedDeveloperVerificationWorkItem, session: AuthSessionDto) {
    return verificationApi.getReviewerDetail(session, item.target_id, item.claim_token)
  },

  getReviewerMaterial(item: ClaimedDeveloperVerificationWorkItem, session: AuthSessionDto, materialId: string) {
    return verificationApi.getReviewerMaterial(session, materialId, item.claim_token)
  },

  createMaterialReadGrant(item: ClaimedDeveloperVerificationWorkItem, session: AuthSessionDto, materialId: string) {
    return verificationApi.createMaterialReadGrant(session, materialId, item.claim_token)
  },

  preview(item: ClaimedDeveloperVerificationWorkItem, detail: VerificationReviewerProjection, session: AuthSessionDto, decision: 'approve' | 'changes_requested' | 'reject', reasonCode: string) {
    return request<ReviewPreview>('/api/v1/admin/operations/preview', session, {
      body: {
        operation_type: 'verification_review',
        targets: [{ target_type: 'verification_request', target_id: detail.verification_id }],
        expected_versions: { verification_request: detail.version, work_item: item.version },
        proposed_diff: { status: decision === 'approve' ? 'verified' : decision === 'reject' ? 'failed' : 'changes_requested' },
        reason_code: reasonCode,
        claim_token: item.claim_token,
        expected_conflict_principal_version: null,
      },
    })
  },

  confirm(preview: ReviewPreview, session: AuthSessionDto, confirmRequestId = requestId()) {
    return request<{ readonly confirm_token: string }>('/api/v1/admin/operations/confirm', session, {
      body: {
        preview_token: preview.preview_token,
        confirmation_summary_hash: preview.confirmation_summary_hash,
        confirm_request_id: confirmRequestId,
        reauth_grant_id: null,
        expected_conflict_principal_version: preview.conflict_principal_version,
      },
    })
  },

  decide(item: ClaimedDeveloperVerificationWorkItem, detail: VerificationReviewerProjection, previewToken: string, confirmToken: string, session: AuthSessionDto, decision: 'approve' | 'changes_requested' | 'reject', reasonCode: string, decisionRequestId = requestId()) {
    if (decision === 'approve' && detail.requested_link_role === 'manager') {
      throw new DeveloperReviewApiError('LEGACY_MANAGER_APPROVAL_UNSUPPORTED', 409, false)
    }
    const snapshot = detail.link_policy_snapshot
    const requestedRole = detail.requested_link_role
    const approvedProfileId = requestedRole === 'manager' ? 'MANAGER_V1' : 'OWNER_V1'
    const approvedProfile: PermissionProfileRef | undefined = snapshot.allowed_permission_profile_refs.find((ref) => ref.profile_id === approvedProfileId)
    const decisionPayload = decision === 'approve'
      ? {
          author_role: 'owner' as const,
          field_permissions: [...authorContentP0V1FieldPaths],
          policy_version: snapshot.policy_version,
          expected_creator_aggregate_version: snapshot.target_creator_aggregate_version,
          expected_owner_link_set_version: snapshot.owner_link_set_version,
          expected_reused_link_version: snapshot.reused_link_version,
          ...(detail.creator_resolution_mode === 'claim_existing_creator' && requestedRole && approvedProfile
            ? { approved_link_role: requestedRole, approved_permission_profile_ref: approvedProfile }
            : {}),
        }
      : {}
    return request<{ readonly review_decision_id: string; readonly resulting_status: string; readonly project_id: string | null }>('/api/v1/admin/work-items/' + encodeURIComponent(item.work_item_id) + '/decision', session, {
      body: {
        preview_token: previewToken,
        claim_token: item.claim_token,
        confirm_token: confirmToken,
        decision,
        reason_code: reasonCode,
        field_paths: decision === 'changes_requested' ? ['/new_creator_profile_input', '/material_ids'] : [],
        decision_evidence_refs: detail.evidence_refs,
        expected_version: item.version,
        decision_request_id: decisionRequestId,
        decision_payload: decisionPayload,
      },
    })
  },
}

export type DeveloperReviewApi = typeof developerReviewApi
