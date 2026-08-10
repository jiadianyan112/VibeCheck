export class CatalogError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(code)
    this.name = 'CatalogError'
  }
}

export function catalogError(code: string, httpStatus: number, retryable = false): CatalogError {
  return new CatalogError(code, httpStatus, retryable)
}
