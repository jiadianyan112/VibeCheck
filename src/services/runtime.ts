import type { ServiceError, ServiceResult } from './result'

export const serviceScenarioIds = [
  'default',
  'network_error',
  'service_error',
  'timeout',
  'empty_results',
  'sparse_results',
  'parse_failure',
  'extraction_partial',
  'review_changes_requested',
  'review_approved',
  'review_rejected',
  'verification_disputed',
  'permission_expired',
  'duplicate_project',
  'external_link_risk',
] as const

export type ServiceScenarioId = (typeof serviceScenarioIds)[number]

export interface ServiceOptions {
  scenario?: ServiceScenarioId
  delayMs?: number
  signal?: AbortSignal
}

interface ServiceRuntimeConfig {
  defaultDelayMs: number
}

const runtimeConfig: ServiceRuntimeConfig = {
  // Automated browser runs exercise the same branches without synthetic waiting.
  defaultDelayMs: typeof navigator !== 'undefined' && navigator.webdriver ? 0 : 140,
}

export function configureServiceRuntime(config: Partial<ServiceRuntimeConfig>) {
  Object.assign(runtimeConfig, config)
}

function failure(error: ServiceError): ServiceResult<never> {
  return { ok: false, error }
}

async function wait(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms)
    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(new DOMException('Request aborted', 'AbortError'))
    }

    if (signal?.aborted) {
      onAbort()
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export async function runService<T>(
  options: ServiceOptions | undefined,
  task: () => T | Promise<T>,
): Promise<ServiceResult<T>> {
  const scenario = options?.scenario ?? 'default'

  try {
    await wait(options?.delayMs ?? runtimeConfig.defaultDelayMs, options?.signal)

    if (scenario === 'network_error') {
      return failure({
        code: 'VC_NETWORK_UNAVAILABLE',
        kind: 'network',
        message: '网络连接不可用，已保留当前内容。',
        retryable: true,
      })
    }
    if (scenario === 'service_error') {
      return failure({
        code: 'VC_SERVICE_UNAVAILABLE',
        kind: 'server',
        message: '服务暂时不可用，请稍后重试。',
        retryable: true,
      })
    }
    if (scenario === 'timeout') {
      return failure({
        code: 'VC_REQUEST_TIMEOUT',
        kind: 'timeout',
        message: '请求超时，原有输入没有被清空。',
        retryable: true,
      })
    }

    return { ok: true, data: clone(await task()) }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return failure({
        code: 'VC_REQUEST_ABORTED',
        kind: 'aborted',
        message: '请求已取消。',
        retryable: false,
      })
    }

    return failure({
      code: 'VC_UNEXPECTED_SERVICE_ERROR',
      kind: 'server',
      message: error instanceof Error ? error.message : '服务出现未知错误，请稍后重试。',
      retryable: true,
    })
  }
}

export function notFound(code: string, message: string): ServiceResult<never> {
  return {
    ok: false,
    error: { code, kind: 'not_found', message, retryable: false },
  }
}

export function validationFailure(
  code: string,
  message: string,
): ServiceResult<never> {
  return {
    ok: false,
    error: { code, kind: 'validation', message, retryable: false },
  }
}
