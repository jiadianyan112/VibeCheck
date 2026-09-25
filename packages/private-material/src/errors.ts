export class PrivateMaterialError extends Error {
  readonly retryAfterSeconds: number | undefined = undefined

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
    this.name = 'PrivateMaterialError'
  }
}

export function privateMaterialError(
  code: string,
  httpStatus: number,
  retryable = false,
  details?: Readonly<Record<string, unknown>>,
): PrivateMaterialError {
  return new PrivateMaterialError(code, httpStatus, retryable, details)
}
