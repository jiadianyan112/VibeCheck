export class AnalyticsError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
    this.name = 'AnalyticsError'
  }
}

export function analyticsError(
  code: string,
  httpStatus: number,
  retryable = false,
): AnalyticsError {
  return new AnalyticsError(code, httpStatus, retryable)
}
