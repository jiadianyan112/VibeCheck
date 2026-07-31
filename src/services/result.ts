export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }
