export class MediaError extends Error {
  readonly retryAfterSeconds: number | undefined = undefined

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
    this.name = 'MediaError'
  }
}

export function mediaError(
  code: string,
  httpStatus: number,
  retryable = false,
  details?: Readonly<Record<string, unknown>>,
): MediaError {
  return new MediaError(code, httpStatus, retryable, details)
}
