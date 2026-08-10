export const apiVersion = 'v1' as const

export const errorResponseSchema = {
  $id: 'https://vibecheck.app/schemas/common/error-response.v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['error_code', 'message_key', 'request_id', 'retryable'],
  properties: {
    error_code: { type: 'string', minLength: 1, maxLength: 64 },
    message_key: { type: 'string', minLength: 1, maxLength: 128 },
    request_id: { type: 'string', minLength: 1, maxLength: 64 },
    retryable: { type: 'boolean' },
    field_errors: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field_path', 'error_code'],
        properties: {
          field_path: { type: 'string', minLength: 1, maxLength: 256 },
          error_code: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
    conflict: { type: 'object', additionalProperties: true },
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
  readonly error_code: string
  readonly message_key: string
  readonly request_id: string
  readonly retryable: boolean
  readonly field_errors?: readonly {
    readonly field_path: string
    readonly error_code: string
  }[]
  readonly conflict?: Readonly<Record<string, unknown>>
}

export interface ServiceHealth {
  readonly status: 'ok' | 'degraded'
  readonly service: string
  readonly version: string
  readonly commit: string
  readonly checked_at: string
  readonly checks?: Readonly<Record<string, 'ok' | 'failed'>>
}
