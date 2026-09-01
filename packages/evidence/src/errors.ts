export class EvidenceError extends Error {
  readonly retryAfterSeconds: number | undefined = undefined

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
    this.name = 'EvidenceError'
  }
}

export function evidenceError(
  code: string,
  httpStatus: number,
  retryable = false,
  details?: Readonly<Record<string, unknown>>,
): EvidenceError {
  return new EvidenceError(code, httpStatus, retryable, details)
}
