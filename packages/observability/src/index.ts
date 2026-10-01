import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api'

const sensitiveKeyPattern =
  /(^|_)(authorization|cookie|token|secret|password|otp|email|raw_query|material|storage_key)($|_)/i

export function redactRecord(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        sensitiveKeyPattern.test(key) ? '[REDACTED]' : value,
      ]),
    ),
  )
}

export function currentTraceIds(): Readonly<{
  traceId: string | null
  spanId: string | null
}> {
  const spanContext = trace.getSpan(context.active())?.spanContext()
  return Object.freeze({
    traceId: spanContext?.traceId ?? null,
    spanId: spanContext?.spanId ?? null,
  })
}

export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(tracerName)
  return tracer.startActiveSpan(spanName, { attributes }, async (span) => {
    try {
      const result = await operation(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })
}
