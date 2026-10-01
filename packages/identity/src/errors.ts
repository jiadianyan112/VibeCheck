export class IdentityError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
    this.name = 'IdentityError'
  }
}

export function identityError(
  code: string,
  httpStatus: number,
  retryable = false,
  retryAfterSeconds?: number,
): IdentityError {
  return new IdentityError(code, httpStatus, retryable, retryAfterSeconds)
}
