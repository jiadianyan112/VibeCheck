export class CatalogError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
    this.name = 'CatalogError'
  }
}

export function catalogError(
  code: string,
  httpStatus: number,
  retryable = false,
  retryAfterSeconds?: number,
): CatalogError {
  return new CatalogError(code, httpStatus, retryable, retryAfterSeconds)
}
