export type AuthRole = 'user' | 'verified_author' | 'editor' | 'admin'
export type AccountStatus = 'active' | 'restricted'

export interface AuthSessionDto {
  readonly authenticated: true
  readonly user_id: string
  readonly display_name: string
  readonly account_status: AccountStatus
  readonly roles: readonly AuthRole[]
  readonly primary_role: AuthRole
  readonly permissions: readonly string[]
  readonly session_version: number
  readonly csrf_token: string
  readonly recent_auth_at: string
  readonly expires_at: string
}

export interface AuthChallengeDto {
  readonly auth_flow_id: string
  readonly challenge_id: string
  readonly expires_at: string
  readonly resend_after: string
  readonly masked_email: string
}

export type AuthVerificationDto =
  | {
      readonly purpose: 'login'
      readonly session: AuthSessionDto
      readonly return_to: string
    }
  | {
      readonly purpose: 'admin_confirm'
      readonly reauth_grant_id: string
      readonly recent_auth_at: string
      readonly return_to: string
    }

interface ErrorBody {
  readonly error?: {
    readonly code?: unknown
    readonly message_key?: unknown
    readonly request_id?: unknown
    readonly retryable?: unknown
    readonly retry_after_ms?: unknown
  }
}

export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null,
  ) {
    super(code)
    this.name = 'AuthApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function authFetch<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'x-request-id': requestId(),
        ...init.headers,
      },
    })
  } catch {
    throw new AuthApiError('NETWORK_UNAVAILABLE', 0, null, true, null)
  }
  if (response.ok) {
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }
  let body: ErrorBody = {}
  try {
    body = await response.json() as ErrorBody
  } catch {
    // Non-JSON upstream errors are mapped to a stable client error.
  }
  const error = body.error
  throw new AuthApiError(
    typeof error?.code === 'string' ? error.code : 'AUTH_REQUEST_FAILED',
    response.status,
    typeof error?.request_id === 'string' ? error.request_id : response.headers.get('x-request-id'),
    typeof error?.retryable === 'boolean' ? error.retryable : response.status >= 500,
    typeof error?.retry_after_ms === 'number' ? error.retry_after_ms : null,
  )
}

export function createAuthRequestId(): string {
  return requestId()
}

export function startEmailChallenge(input: {
  readonly email: string
  readonly returnTo: string
  readonly clientRequestId: string
}): Promise<AuthChallengeDto> {
  return authFetch('/api/v1/auth/email-challenges', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      purpose: 'login',
      return_to: input.returnTo,
      client_request_id: input.clientRequestId,
    }),
  })
}

export function verifyEmailChallenge(input: {
  readonly challengeId: string
  readonly authFlowId: string
  readonly otp: string
  readonly clientRequestId: string
}): Promise<AuthVerificationDto> {
  return authFetch(`/api/v1/auth/email-challenges/${encodeURIComponent(input.challengeId)}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      auth_flow_id: input.authFlowId,
      otp: input.otp,
      client_request_id: input.clientRequestId,
    }),
  })
}

export function getAuthSession(): Promise<AuthSessionDto> {
  return authFetch('/api/v1/auth/session', { method: 'GET' })
}

export function revokeAuthSession(session: AuthSessionDto): Promise<void> {
  return authFetch('/api/v1/auth/session', {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': session.csrf_token,
    },
    body: JSON.stringify({ session_version: session.session_version }),
  })
}
