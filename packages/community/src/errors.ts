export class CommunityError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
    this.name = 'CommunityError'
  }
}

export function communityError(
  code: string,
  httpStatus: number,
  retryable = false,
  retryAfterSeconds?: number,
  details?: Readonly<Record<string, unknown>>,
): CommunityError {
  return new CommunityError(code, httpStatus, retryable, retryAfterSeconds, details)
}
