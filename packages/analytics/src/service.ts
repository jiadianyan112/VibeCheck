import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import type { AnalyticsConfig, RuntimeEnvironment } from '@vibecheck/config'

import { analyticsError } from './errors.js'
import type { AnalyticsStore } from './store-port.js'
import type {
  AnalyticsBatchReceipt,
  AnalyticsBrowserContext,
  AnalyticsEventHandler,
  AnalyticsItemReceipt,
  AnalyticsSubject,
  ComparisonDimensionViewedPayload,
  IngestClientBatchCommand,
  ValidatedClientAnalyticsEvent,
} from './types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pagePattern = /^(P(?:0[1-9]|1[0-8])|A(?:0[1-9]|1[0-4]))$/
const dimensionPattern = /^[a-z][a-z0-9_]{0,63}$/
const protectedFields = new Set([
  'received_at', 'environment', 'actor_type', 'consent_state', 'metric_subject_id',
  'subject_kind', 'bridge_version', 'clock_skew_flag', 'user_id', 'anonymous_id',
  'device_id_hash', 'service_actor_id', 'transaction_id',
])
const sensitiveFields = new Set([
  'raw_query', 'query_text', 'comment_body', 'report_note', 'email', 'otp',
  'verification_material',
])

export interface AnalyticsServiceDependencies {
  readonly config: AnalyticsConfig
  readonly store: AnalyticsStore
  readonly eventHandler: AnalyticsEventHandler
  readonly now?: () => Date
}

interface RawEvent {
  readonly eventId: string
  readonly value: Readonly<Record<string, unknown>>
  readonly sessionId: string | null
}

export class AnalyticsService {
  private readonly now: () => Date

  constructor(private readonly dependencies: AnalyticsServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  issueSession(context: AnalyticsBrowserContext): string {
    const expiresAt = Math.floor(this.now().getTime() / 1_000) + this.dependencies.config.sessionTtlSeconds
    const bindingDigest = this.hmac(
      this.dependencies.config.sessionSecret,
      `binding:${context.subject.kind}:${context.bindingMaterial}`,
      'base64url',
    )
    const unsigned = `v1.${expiresAt}.${bindingDigest}`
    return `${unsigned}.${this.hmac(this.dependencies.config.sessionSecret, unsigned, 'base64url')}`
  }

  async ingestClientBatch(command: IngestClientBatchCommand): Promise<AnalyticsBatchReceipt> {
    const now = this.now()
    const envelope = this.envelope(command.body)
    const rawEvents = envelope.events.map((event) => this.rawEvent(event))
    const token = this.boundSession(command.sessionHeader, rawEvents)
    const validSession = token !== null && this.verifySession(token, command.context, now)
    const sessionHash = this.digestBuffer(`session:${token ?? 'missing'}`)
    const receiptId = randomUUID()
    const items: AnalyticsItemReceipt[] = []
    const itemPayloadHashes: string[] = []

    for (const raw of rawEvents) {
      const payloadHash = this.hmac(
        this.dependencies.config.sessionSecret,
        this.canonical(raw.value),
        'hex',
      )
      itemPayloadHashes.push(payloadHash)
      if (!validSession || raw.sessionId === null && command.sessionHeader === null) {
        items.push(this.rejected(raw.eventId, 'ACTOR_IDENTITY_INVALID'))
        continue
      }
      const validation = this.validateEvent(raw.value, now)
      if (typeof validation === 'string') {
        items.push(this.rejected(raw.eventId, validation))
        continue
      }
      const existing = await this.dependencies.store.getEvent(validation.eventId)
      if (existing !== null) {
        items.push(existing.payloadHash === payloadHash
          ? Object.freeze({ event_id: validation.eventId, status: 'deduplicated' })
          : this.rejected(validation.eventId, 'EVENT_ID_REUSED'))
        continue
      }

      try {
        await this.dependencies.eventHandler.recordComparisonDimension({
          eventId: validation.eventId,
          comparisonId: validation.payload.comparison_id,
          comparisonVersion: validation.payload.comparison_version,
          dimensionGroup: validation.payload.dimension_group,
          visibleMs: validation.payload.visible_ms,
          projectCount: validation.payload.project_count,
          viewSequence: validation.payload.view_sequence,
          occurredAt: validation.occurredAt.toISOString(),
          subject: command.context.subject,
        })
      } catch (error) {
        const code = this.domainRejection(error)
        if (code === null) throw error
        items.push(this.rejected(validation.eventId, code))
        continue
      }

      const identity = this.identity(command.context.subject)
      const persisted = await this.dependencies.store.persistEvent({
        event: validation,
        payloadHash,
        receivedAt: now,
        environment: command.environment as RuntimeEnvironment,
        consentState: this.dependencies.config.consentState,
        sessionHash,
        ...identity,
        subject: command.context.subject,
        bridgeVersion: 1,
        clockSkewFlag: Math.abs(now.getTime() - validation.occurredAt.getTime()) > 300_000,
      })
      items.push(persisted.inserted
        ? Object.freeze({ event_id: validation.eventId, status: 'accepted' })
        : persisted.payloadHash === payloadHash
          ? Object.freeze({ event_id: validation.eventId, status: 'deduplicated' })
          : this.rejected(validation.eventId, 'EVENT_ID_REUSED'))
    }

    await this.dependencies.store.persistReceipt({
      receiptId,
      batchHash: this.hmac(
        this.dependencies.config.sessionSecret,
        this.canonical(command.body),
        'hex',
      ),
      sessionHash,
      items,
      itemPayloadHashes,
      createdAt: now,
    })
    return Object.freeze({ receipt_id: receiptId, items: Object.freeze(items) })
  }

  private envelope(body: Readonly<Record<string, unknown>>): {
    readonly events: readonly unknown[]
  } {
    if (!this.exactKeys(body, ['batch_version', 'sent_at', 'sdk_version', 'events'])) {
      throw analyticsError('BATCH_SCHEMA_INVALID', 422)
    }
    if (body.batch_version !== 1 || !this.date(body.sent_at) || !this.boundedString(body.sdk_version, 1, 32)) {
      throw analyticsError('BATCH_SCHEMA_INVALID', 422)
    }
    if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 100) {
      throw analyticsError('BATCH_SCHEMA_INVALID', 422)
    }
    if (body.events.some((event) => event === null || typeof event !== 'object' || Array.isArray(event))) {
      throw analyticsError('BATCH_SCHEMA_INVALID', 422)
    }
    return Object.freeze({ events: Object.freeze([...body.events]) })
  }

  private rawEvent(value: unknown): RawEvent {
    const event = value as Readonly<Record<string, unknown>>
    if (typeof event.event_id !== 'string' || event.event_id.length < 1 || event.event_id.length > 128) {
      throw analyticsError('BATCH_EVENT_ID_INVALID', 422)
    }
    return Object.freeze({
      eventId: event.event_id,
      value: event,
      sessionId: typeof event.session_id === 'string' ? event.session_id : null,
    })
  }

  private boundSession(header: string | null, events: readonly RawEvent[]): string | null {
    const hasItemSession = events.some(({ value }) => Object.hasOwn(value, 'session_id'))
    if (header !== null && hasItemSession) {
      throw analyticsError('SESSION_BINDING_AMBIGUOUS', 422)
    }
    if (header !== null) return this.boundedString(header, 1, 512) ? header : null
    const distinct = new Set(events.map(({ sessionId }) => sessionId).filter((value) => value !== null))
    if (distinct.size > 1) throw analyticsError('MULTI_SESSION_BATCH_FORBIDDEN', 422)
    return distinct.values().next().value ?? null
  }

  private validateEvent(
    value: Readonly<Record<string, unknown>>,
    now: Date,
  ): ValidatedClientAnalyticsEvent | string {
    if (this.containsNamedField(value, protectedFields)) return 'IDENTITY_FIELD_FORBIDDEN'
    if (this.containsSensitiveField(value)) return 'SENSITIVE_FIELD_FORBIDDEN'
    if (!this.exactKeys(value, [
      'event_id', 'event_name', 'event_version', 'occurred_at', 'app_version', 'page_id',
      'source_page', 'request_id', 'payload', 'session_id',
    ])) return 'SCHEMA_INVALID'
    if (
      !uuidPattern.test(String(value.event_id)) ||
      value.event_name !== 'comparison_dimension_viewed' ||
      value.event_version !== 1 ||
      !this.boundedString(value.app_version, 1, 32) ||
      value.page_id !== 'P09' ||
      value.source_page !== undefined && !this.page(value.source_page) ||
      value.request_id !== undefined && !this.boundedString(value.request_id, 1, 64) ||
      value.session_id !== undefined && !this.boundedString(value.session_id, 1, 512) ||
      !this.date(value.occurred_at)
    ) return 'SCHEMA_INVALID'
    const occurredAt = new Date(value.occurred_at as string)
    if (
      occurredAt.getTime() > now.getTime() + 300_000 ||
      occurredAt.getTime() < now.getTime() - 7 * 86_400_000
    ) return 'EVENT_TIME_INVALID'
    const payload = this.dimensionPayload(value.payload)
    if (payload === null) return 'SCHEMA_INVALID'
    return Object.freeze({
      eventId: (value.event_id as string).toLowerCase(),
      eventName: 'comparison_dimension_viewed',
      eventVersion: 1,
      occurredAt,
      appVersion: value.app_version as string,
      pageId: 'P09',
      sourcePage: value.source_page as string | undefined ?? null,
      requestId: value.request_id as string | undefined ?? null,
      payload,
    })
  }

  private dimensionPayload(value: unknown): ComparisonDimensionViewedPayload | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const payload = value as Readonly<Record<string, unknown>>
    if (!this.exactKeys(payload, [
      'comparison_id', 'comparison_version', 'dimension_group', 'visible_ms',
      'project_count', 'view_sequence', 'interaction_type',
    ])) return null
    if (
      !uuidPattern.test(String(payload.comparison_id)) ||
      !this.integer(payload.comparison_version, 1) ||
      typeof payload.dimension_group !== 'string' || !dimensionPattern.test(payload.dimension_group) ||
      !this.integer(payload.visible_ms, 1_000) || payload.visible_ms > 60_000 ||
      !this.integer(payload.project_count, 2) || payload.project_count > 5 ||
      !this.integer(payload.view_sequence, 1) ||
      payload.interaction_type !== undefined && !this.boundedString(payload.interaction_type, 1, 32)
    ) return null
    return Object.freeze({
      comparison_id: (payload.comparison_id as string).toLowerCase(),
      comparison_version: payload.comparison_version as number,
      dimension_group: payload.dimension_group,
      visible_ms: payload.visible_ms as number,
      project_count: payload.project_count as number,
      view_sequence: payload.view_sequence as number,
      ...(payload.interaction_type === undefined
        ? {}
        : { interaction_type: payload.interaction_type as string }),
    })
  }

  private verifySession(token: string, context: AnalyticsBrowserContext, now: Date): boolean {
    const parts = token.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d{10}$/.test(parts[1]!)) return false
    const expiresAt = Number(parts[1])
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now.getTime() / 1_000)) return false
    const expectedBinding = this.hmac(
      this.dependencies.config.sessionSecret,
      `binding:${context.subject.kind}:${context.bindingMaterial}`,
      'base64url',
    )
    if (!this.safeEqual(parts[2]!, expectedBinding)) return false
    const unsigned = parts.slice(0, 3).join('.')
    return this.safeEqual(
      parts[3]!,
      this.hmac(this.dependencies.config.sessionSecret, unsigned, 'base64url'),
    )
  }

  private identity(subject: AnalyticsSubject): {
    readonly metricSubjectId: string
    readonly subjectRefHash: Buffer
  } {
    const digest = createHmac('sha256', this.dependencies.config.subjectHashPepper)
      .update(`metric:${subject.kind}:${subject.id}`, 'utf8')
      .digest()
    const uuidBytes = Buffer.from(digest.subarray(0, 16))
    uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40
    uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80
    const hex = uuidBytes.toString('hex')
    return Object.freeze({
      metricSubjectId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      subjectRefHash: this.digestBuffer(`subject:${subject.kind}:${subject.id}`),
    })
  }

  private rejected(eventId: string, errorCode: string): AnalyticsItemReceipt {
    return Object.freeze({ event_id: eventId, status: 'rejected', error_code: errorCode })
  }

  private domainRejection(error: unknown): string | null {
    if (error === null || typeof error !== 'object') return null
    const candidate = error as { readonly code?: unknown; readonly httpStatus?: unknown }
    return typeof candidate.code === 'string' && typeof candidate.httpStatus === 'number' &&
      candidate.httpStatus >= 400 && candidate.httpStatus < 500
      ? candidate.code
      : null
  }

  private containsSensitiveField(value: unknown): boolean {
    return this.containsNamedField(value, sensitiveFields)
  }

  private containsNamedField(value: unknown, forbidden: ReadonlySet<string>): boolean {
    if (value === null || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some((item) => this.containsNamedField(item, forbidden))
    return Object.entries(value as Readonly<Record<string, unknown>>).some(
      ([key, child]) => forbidden.has(key) || this.containsNamedField(child, forbidden),
    )
  }

  private exactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
    const allowedSet = new Set(allowed)
    return Object.keys(value).every((key) => allowedSet.has(key))
  }

  private page(value: unknown): boolean {
    return typeof value === 'string' && pagePattern.test(value)
  }

  private date(value: unknown): boolean {
    return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value))
  }

  private boundedString(value: unknown, minimum: number, maximum: number): value is string {
    return typeof value === 'string' && value.length >= minimum && value.length <= maximum
  }

  private integer(value: unknown, minimum: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum
  }

  private canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonical(item)).join(',')}]`
    if (value !== null && typeof value === 'object') {
      return `{${Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${this.canonical(child)}`)
        .join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
  }

  private hmac(secret: string, value: string, encoding: 'base64url' | 'hex'): string {
    return createHmac('sha256', secret).update(value, 'utf8').digest(encoding)
  }

  private digestBuffer(value: string): Buffer {
    return createHmac('sha256', this.dependencies.config.subjectHashPepper)
      .update(value, 'utf8')
      .digest()
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8')
    const rightBuffer = Buffer.from(right, 'utf8')
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  }
}
