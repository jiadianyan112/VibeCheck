export const apiVersion = 'v1' as const

export const errorResponseSchema = {
  $id: 'https://vibecheck.app/schemas/common/error-response.v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message_key', 'request_id', 'retryable', 'retry_after_ms'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 64 },
        message_key: { type: 'string', minLength: 1, maxLength: 128 },
        request_id: { type: 'string', minLength: 1, maxLength: 64 },
        retryable: { type: 'boolean' },
        retry_after_ms: { type: ['integer', 'null'], minimum: 0 },
        field_errors: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'code'],
            properties: {
              path: { type: 'string', minLength: 1, maxLength: 256 },
              code: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
        },
        conflict: { type: ['object', 'null'], additionalProperties: true },
      },
    },
  },
} as const

export const serviceHealthSchema = {
  $id: 'https://vibecheck.app/schemas/platform/service-health.v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['status', 'service', 'version', 'commit', 'checked_at'],
  properties: {
    status: { enum: ['ok', 'degraded'] },
    service: { type: 'string', minLength: 1, maxLength: 64 },
    version: { type: 'string', minLength: 1, maxLength: 32 },
    commit: { type: 'string', minLength: 1, maxLength: 64 },
    checked_at: { type: 'string', format: 'date-time' },
    checks: {
      type: 'object',
      additionalProperties: { enum: ['ok', 'failed'] },
    },
  },
} as const

export interface ErrorResponse {
  readonly error: {
    readonly code: string
    readonly message_key: string
    readonly request_id: string
    readonly retryable: boolean
    readonly retry_after_ms: number | null
    readonly details?: Readonly<Record<string, unknown>>
    readonly field_errors?: readonly {
      readonly path: string
      readonly code: string
    }[]
    readonly conflict?: Readonly<Record<string, unknown>> | null
  }
}

export interface ServiceHealth {
  readonly status: 'ok' | 'degraded'
  readonly service: string
  readonly version: string
  readonly commit: string
  readonly checked_at: string
  readonly checks?: Readonly<Record<string, 'ok' | 'failed'>>
}

export interface AuthChallengeAccepted {
  readonly auth_flow_id: string
  readonly challenge_id: string
  readonly expires_at: string
  readonly resend_after: string
  readonly masked_email: string
}

export interface AuthSessionProjection {
  readonly authenticated: true
  readonly user_id: string
  readonly display_name: string
  readonly account_status: 'active' | 'restricted'
  readonly roles: readonly ('user' | 'verified_author' | 'editor' | 'admin')[]
  readonly primary_role: 'user' | 'verified_author' | 'editor' | 'admin'
  readonly permissions: readonly string[]
  readonly session_version: number
  readonly csrf_token: string
  readonly recent_auth_at: string
  readonly expires_at: string
}

export type AuthVerificationResponse =
  | {
      readonly purpose: 'login'
      readonly session: AuthSessionProjection
      readonly return_to: string
      readonly identity_links: readonly {
        readonly identity_link_id: string
        readonly purpose: 'pending_action_replay' | 'query_continuation' | 'comparison_merge'
        readonly expires_at: string
      }[]
      readonly comparison_merge: {
        readonly result: 'not_required' | 'adopted' | 'merged' | 'conflict'
        readonly comparison_id: string | null
        readonly comparison_version: number | null
        readonly conflict_id: string | null
        readonly conflict_version: number | null
        readonly expires_at: string | null
      } | null
      readonly pending_action_id: string | null
    }
  | {
      readonly purpose: 'admin_confirm'
      readonly reauth_grant_id: string
      readonly recent_auth_at: string
      readonly return_to: string
    }
