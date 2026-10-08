import type { AuthSessionDto } from './authService'

export type DeveloperKind = 'individual' | 'team'
export type VerificationResolutionMode = 'use_existing_link' | 'create_new_creator' | 'claim_existing_creator'
export type RequestedLinkRole = 'owner' | 'manager'
export type VerificationStatus = 'draft' | 'pending' | 'changes_requested' | 'verified' | 'failed' | 'withdrawn'
export type ApplicantScanState = 'pending' | 'accepted' | 'rejected'

export interface NewDeveloperProfileInput {
  /** Frozen legacy requests may predate the developer/team discriminator. */
  readonly kind?: DeveloperKind
  readonly display_name: string
  readonly bio?: string
  readonly avatar_url?: string | null
  readonly website_url?: string | null
}

export interface VerificationMaterialSummary {
  readonly material_id: string
  readonly verification_id: string
  readonly applicant_scan_state: ApplicantScanState
  readonly reason_key: 'upload_expired' | 'file_rejected' | 'processing_unavailable' | null
  readonly next_action: 'complete_upload' | 'wait' | 'continue_submission' | 'upload_new_material' | 'none'
  readonly upload_expires_at: string | null
  readonly version: number
}

export interface VerificationRequestProjection {
  readonly verification_id: string
  readonly project_id: string
  readonly creator_resolution_mode: VerificationResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input: NewDeveloperProfileInput | null
  readonly requested_link_role: RequestedLinkRole | null
  readonly provisional_link_policy: ProvisionalLinkPolicy | null
  readonly link_policy_snapshot: LinkPolicySnapshot | null
  readonly method: string | null
  readonly public_summary: string | null
  readonly material_summaries: readonly VerificationMaterialSummary[]
  readonly status: VerificationStatus
  readonly status_history: readonly Readonly<{ readonly status: VerificationStatus; readonly at: string }>[]
  readonly latest_public_review_message: VerificationPublicReviewMessage | null
  readonly supersedes_verification_id: string | null
  readonly resulting_creator_id: string | null
  readonly resulting_link_id: string | null
  readonly resulting_author_relation_id: string | null
  readonly resulting_profile_version_id: string | null
  readonly approved_link_role: RequestedLinkRole | null
  readonly approved_permission_profile_ref: PermissionProfileRef | null
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface PermissionProfileRef {
  readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
  readonly profile_version: 1
  readonly config_hash: string
}

export interface ProvisionalLinkPolicy {
  readonly policy_version: 'creator_link.v1'
  readonly target_creator_aggregate_version: number | null
  readonly owner_link_set_version: number | null
  readonly allowed_link_roles: readonly RequestedLinkRole[]
  readonly default_link_role: RequestedLinkRole
  readonly allowed_permission_profile_refs: readonly PermissionProfileRef[]
}

export interface LinkPolicySnapshot extends ProvisionalLinkPolicy {
  readonly observed_owner_link_id: string | null
  readonly observed_owner_link_version: number | null
  readonly reused_link_id: string | null
  readonly reused_link_version: number | null
}

export interface VerificationPublicReviewMessage {
  readonly message_key: 'verification_changes_requested' | 'verification_rejected'
  readonly field_paths: readonly string[]
  readonly created_at: string
}

export interface CreatorAccountLink {
  readonly creator_account_link_id: string
  readonly creator_id: string
  readonly link_role: 'owner' | 'manager'
  readonly permission_profile_ref: PermissionProfileRef
  readonly status: 'active' | 'suspended' | 'terminated'
  readonly source_verification_id: string
  readonly version: number
  readonly effective_capabilities: readonly string[]
}

export interface PrepareMaterialProjection {
  readonly material: VerificationMaterialSummary
  readonly upload_url: string
  readonly upload_headers: Readonly<Record<string, string>>
  readonly upload_expires_at: string
}

export interface VerificationReviewerProjection {
  readonly viewer_schema: 'reviewer'
  readonly verification_id: string
  readonly project_id: string
  readonly creator_resolution_mode: VerificationResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input: NewDeveloperProfileInput | null
  readonly requested_link_role: RequestedLinkRole | null
  readonly link_policy_snapshot: LinkPolicySnapshot
  readonly method: string
  readonly public_summary: string
  readonly material_ids: readonly string[]
  readonly evidence_refs: readonly string[]
  readonly submission_revision: number
  readonly status: 'pending'
  readonly review_work_item_id: string
  readonly version: number
}

export interface MaterialReviewerProjection {
  readonly material_id: string
  readonly verification_id: string
  readonly status: 'ready'
  readonly scan_result: 'clean'
  readonly rejection_reason_code: null
  readonly pre_terminal_scan_result: null
  readonly scan_attempt_count: number
  readonly next_scan_at: null
  readonly processing_deadline_at: string | null
  readonly declared_mime: string
  readonly detected_mime: string | null
  readonly byte_size: number
  readonly checksum_match: boolean
  readonly read_grant_eligibility: 'eligible'
  readonly version: number
}

export interface MaterialReadGrantProjection {
  readonly read_url: string
  readonly expires_at: string
}

export class VerificationApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null = null,
  ) {
    super(code)
    this.name = 'VerificationApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function operationId(prefix: string) {
  return `${prefix}-${requestId()}`
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH'
  readonly body?: object
  readonly claimToken?: string
  readonly idempotencyKey?: string
}

async function request<T>(path: string, session: AuthSessionDto, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const id = requestId()
  const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': id }
  if (options.claimToken) headers['x-review-claim-token'] = options.claimToken
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey
  if (options.body) {
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session.csrf_token
  }
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      credentials: 'include',
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch {
    throw new VerificationApiError('NETWORK_UNAVAILABLE', 0, true, id)
  }
  if (response.ok) return await response.json() as T
  const body = await response.json().catch(() => null) as { error?: { code?: unknown; retryable?: unknown; request_id?: unknown } } | null
  const error = body?.error
  const code = typeof error?.code === 'string' ? error.code : 'VERIFICATION_REQUEST_FAILED'
  throw new VerificationApiError(
    code,
    response.status,
    typeof error?.retryable === 'boolean' ? error.retryable : response.status >= 500 || response.status === 409,
    typeof error?.request_id === 'string' ? error.request_id : response.headers.get('x-request-id'),
  )
}

async function upload(prepared: PrepareMaterialProjection, file: Blob): Promise<void> {
  let response: Response
  try {
    response = await fetch(prepared.upload_url, {
      method: 'PUT',
      headers: prepared.upload_headers,
      body: file,
    })
  } catch {
    throw new VerificationApiError('UPLOAD_NETWORK_UNAVAILABLE', 0, true)
  }
  if (!response.ok) throw new VerificationApiError('MATERIAL_UPLOAD_FAILED', response.status, response.status >= 500)
}

export const verificationApi = {
  get(session: AuthSessionDto, verificationId: string) {
    return request<VerificationRequestProjection>(`/api/v1/verification-requests/${encodeURIComponent(verificationId)}`, session)
  },

  listMyCreatorLinks(session: AuthSessionDto) {
    return request<readonly CreatorAccountLink[]>('/api/v1/me/creator-account-links', session)
  },

  create(session: AuthSessionDto, body: {
    readonly project_id: string
    readonly supersedes_verification_id: string | null
    readonly creator_resolution_mode: VerificationResolutionMode
    readonly creator_account_link_id: string | null
    readonly target_creator_id: string | null
    readonly new_creator_profile_input: NewDeveloperProfileInput | null
    readonly requested_link_role: RequestedLinkRole | null
    readonly idempotency_key?: string
  }) {
    return request<VerificationRequestProjection>('/api/v1/verification-requests', session, {
      method: 'POST',
      body: { ...body, idempotency_key: body.idempotency_key ?? operationId('verification-create') },
    })
  },

  patch(session: AuthSessionDto, verificationId: string, body: {
    readonly expected_version: number
    readonly creator_resolution_mode: VerificationResolutionMode
    readonly creator_account_link_id: string | null
    readonly target_creator_id: string | null
    readonly new_creator_profile_input: NewDeveloperProfileInput | null
    readonly requested_link_role: RequestedLinkRole | null
    readonly method: string | null
    readonly public_summary: string | null
    readonly idempotency_key?: string
  }) {
    const idempotencyKey = body.idempotency_key ?? operationId('verification-patch')
    const patchBody = {
      expected_version: body.expected_version,
      creator_resolution_mode: body.creator_resolution_mode,
      creator_account_link_id: body.creator_account_link_id,
      target_creator_id: body.target_creator_id,
      new_creator_profile_input: body.new_creator_profile_input,
      requested_link_role: body.requested_link_role,
      method: body.method,
      public_summary: body.public_summary,
    }
    return request<VerificationRequestProjection>(`/api/v1/verification-requests/${encodeURIComponent(verificationId)}`, session, {
      method: 'PATCH',
      body: patchBody,
      idempotencyKey,
    })
  },

  submit(session: AuthSessionDto, verificationId: string, expectedVersion: number, materialIds: readonly string[], submissionKey = operationId('verification-submit')) {
    return request<VerificationRequestProjection>(`/api/v1/verification-requests/${encodeURIComponent(verificationId)}/submit`, session, {
      method: 'POST',
      body: { expected_version: expectedVersion, material_ids: materialIds, submission_key: submissionKey },
    })
  },

  supplement(session: AuthSessionDto, verificationId: string, expectedVersion: number, materialIds: readonly string[], evidenceRefs: readonly string[] = [], operation = operationId('verification-supplement')) {
    return request<VerificationRequestProjection>(`/api/v1/verification-requests/${encodeURIComponent(verificationId)}/supplements`, session, {
      method: 'POST',
      body: { expected_version: expectedVersion, material_ids: materialIds, evidence_refs: evidenceRefs, operation_id: operation },
    })
  },

  withdraw(session: AuthSessionDto, verificationId: string, expectedVersion: number, reasonCode: string | null = 'applicant_withdrawn', operation = operationId('verification-withdraw')) {
    return request<VerificationRequestProjection>(`/api/v1/verification-requests/${encodeURIComponent(verificationId)}/withdraw`, session, {
      method: 'POST',
      body: { expected_version: expectedVersion, operation_id: operation, reason_code: reasonCode },
    })
  },

  prepareMaterial(session: AuthSessionDto, body: {
    readonly verification_id: string
    readonly declared_mime: string
    readonly byte_size: number
    readonly checksum: string
    readonly idempotency_key?: string
  }) {
    return request<PrepareMaterialProjection>('/api/v1/verification-materials', session, {
      method: 'POST',
      body: { ...body, idempotency_key: body.idempotency_key ?? operationId('material-prepare') },
    })
  },

  uploadMaterial: upload,

  completeMaterial(session: AuthSessionDto, materialId: string, body: { readonly checksum: string; readonly upload_receipt: string; readonly operation_id?: string }) {
    return request<{ readonly material: VerificationMaterialSummary; readonly scan_queued: true }>(`/api/v1/verification-materials/${encodeURIComponent(materialId)}/complete`, session, {
      method: 'POST',
      body: { ...body, operation_id: body.operation_id ?? operationId('material-complete') },
    })
  },

  getMaterial(session: AuthSessionDto, materialId: string) {
    return request<VerificationMaterialSummary>(`/api/v1/verification-materials/${encodeURIComponent(materialId)}`, session)
  },

  revokeMaterial(session: AuthSessionDto, materialId: string, expectedVersion: number, reasonCode = 'applicant_replaced') {
    return request<{ readonly material: VerificationMaterialSummary }>(`/api/v1/verification-materials/${encodeURIComponent(materialId)}/revoke`, session, {
      method: 'POST',
      body: { expected_version: expectedVersion, reason_code: reasonCode, operation_id: operationId('material-revoke') },
    })
  },

  getReviewerDetail(session: AuthSessionDto, verificationId: string, claimToken: string) {
    return request<VerificationReviewerProjection>(`/api/v1/verification-requests/${encodeURIComponent(verificationId)}`, session, { claimToken })
  },

  getReviewerMaterial(session: AuthSessionDto, materialId: string, claimToken: string) {
    return request<MaterialReviewerProjection>(`/api/v1/verification-materials/${encodeURIComponent(materialId)}`, session, { claimToken })
  },

  createMaterialReadGrant(session: AuthSessionDto, materialId: string, claimToken: string, purpose = 'author_verification_review') {
    return request<MaterialReadGrantProjection>(`/api/v1/verification-materials/${encodeURIComponent(materialId)}/read-grants`, session, {
      method: 'POST',
      claimToken,
      body: { purpose, operation_id: operationId('material-read-grant') },
    })
  },
}

export type VerificationApi = typeof verificationApi
