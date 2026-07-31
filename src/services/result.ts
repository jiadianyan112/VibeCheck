export type ServiceErrorKind =
  | 'network'
  | 'timeout'
  | 'server'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'aborted'

export interface ServiceError {
  code: string
  kind: ServiceErrorKind
  message: string
  retryable: boolean
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError }
