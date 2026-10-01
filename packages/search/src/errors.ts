export class SearchError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
    this.name = 'SearchError'
  }
}

export function searchError(
  code: string,
  httpStatus: number,
  retryable = false,
  retryAfterSeconds?: number,
): SearchError {
  return new SearchError(code, httpStatus, retryable, retryAfterSeconds)
}
