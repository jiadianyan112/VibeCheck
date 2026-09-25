export class WorkflowError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
    this.name = 'WorkflowError'
  }
}

export function workflowError(
  code: string,
  httpStatus: number,
  retryable = false,
  details?: Readonly<Record<string, unknown>>,
  retryAfterSeconds?: number,
): WorkflowError {
  return new WorkflowError(code, httpStatus, retryable, details, retryAfterSeconds)
}
