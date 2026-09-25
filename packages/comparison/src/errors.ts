export class ComparisonError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
    this.name = 'ComparisonError'
  }
}

export function comparisonError(
  code: string,
  httpStatus: number,
  retryable = false,
  retryAfterSeconds?: number,
  details?: Readonly<Record<string, unknown>>,
): ComparisonError {
  return new ComparisonError(code, httpStatus, retryable, retryAfterSeconds, details)
}
