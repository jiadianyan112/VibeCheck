export class SubmissionError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
    this.name = 'SubmissionError'
  }
}

export function submissionError(
  code: string,
  httpStatus: number,
  retryable = false,
  details?: Readonly<Record<string, unknown>>,
): SubmissionError {
  return new SubmissionError(code, httpStatus, retryable, undefined, details)
}
