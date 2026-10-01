import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AnalyticsConfig } from '@vibecheck/config'

import { AnalyticsError } from './errors.js'
import { AnalyticsService } from './service.js'
import type {
  AnalyticsStore,
  ExistingAnalyticsEvent,
  PersistAnalyticsEventInput,
  PersistAnalyticsReceiptInput,
} from './store-port.js'
import type { AnalyticsEventHandler, RecordComparisonDimensionInput } from './types.js'

const now = new Date('2026-08-13T08:00:00.000Z')
const config: AnalyticsConfig = Object.freeze({
  enabled: true,
  sessionSecret: 'analytics-session-secret-at-least-thirty-two-characters',
  subjectHashPepper: 'analytics-subject-pepper-at-least-thirty-two-characters',
  sessionTtlSeconds: 3_600,
  consentState: 'not_required',
})
const context = Object.freeze({
  subject: Object.freeze({ kind: 'anonymous' as const, id: 'a012e556-892e-4b2c-a993-c4417b9bcde7' }),
  bindingMaterial: 'signed-http-only-anonymous-cookie',
})

class MemoryStore implements AnalyticsStore {
  readonly events = new Map<string, PersistAnalyticsEventInput>()
  readonly receipts: PersistAnalyticsReceiptInput[] = []

  async getEvent(eventId: string): Promise<ExistingAnalyticsEvent | null> {
    const event = this.events.get(eventId)
    return event ? Object.freeze({ payloadHash: event.payloadHash }) : null
  }

  async persistEvent(input: PersistAnalyticsEventInput): Promise<{
    readonly inserted: boolean
    readonly payloadHash: string
  }> {
    const existing = this.events.get(input.event.eventId)
    if (existing) return Object.freeze({ inserted: false, payloadHash: existing.payloadHash })
    this.events.set(input.event.eventId, input)
    return Object.freeze({ inserted: true, payloadHash: input.payloadHash })
  }

  async persistReceipt(input: PersistAnalyticsReceiptInput): Promise<void> {
    this.receipts.push(input)
  }
}

class Handler implements AnalyticsEventHandler {
  readonly calls: RecordComparisonDimensionInput[] = []
  error: unknown = null

  async recordComparisonDimension(input: RecordComparisonDimensionInput): Promise<void> {
    if (this.error !== null) throw this.error
    this.calls.push(input)
  }
}

function event(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    event_id: 'e012e556-892e-4b2c-a993-c4417b9bcde7',
    event_name: 'comparison_dimension_viewed',
    event_version: 1,
    occurred_at: '2026-08-13T07:59:58.000Z',
    app_version: '0.2.0',
    page_id: 'P09',
    payload: Object.freeze({
      comparison_id: 'c012e556-892e-4b2c-a993-c4417b9bcde7',
      comparison_version: 2,
      dimension_group: 'workflow',
      visible_ms: 1_500,
      project_count: 3,
      view_sequence: 1,
    }),
    ...overrides,
  })
}

function batch(events: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, unknown>> {
  return Object.freeze({
    batch_version: 1,
    sent_at: '2026-08-13T08:00:00.000Z',
    sdk_version: 'web-1',
    events: Object.freeze([...events]),
  })
}

function harness(): { readonly service: AnalyticsService; readonly store: MemoryStore; readonly handler: Handler } {
  const store = new MemoryStore()
  const handler = new Handler()
  return Object.freeze({
    service: new AnalyticsService({ config, store, eventHandler: handler, now: () => now }),
    store,
    handler,
  })
}

describe('AnalyticsService', () => {
  it('issues a context-bound token and accepts only a validated comparison dimension input', async () => {
    const { service, store, handler } = harness()
    const token = service.issueSession(context)
    const receipt = await service.ingestClientBatch({
      body: batch([event()]),
      sessionHeader: token,
      context,
      environment: 'test',
    })

    assert.equal(receipt.items[0]?.status, 'accepted')
    assert.equal(handler.calls.length, 1)
    assert.equal(handler.calls[0]?.dimensionGroup, 'workflow')
    assert.equal(store.events.size, 1)
    const stored = [...store.events.values()][0]!
    assert.equal(stored.subject.kind, 'anonymous')
    assert.equal(stored.bridgeVersion, 1)
    assert.equal((stored as unknown as Record<string, unknown>).userId, undefined)
    assert.equal(store.receipts[0]?.items[0]?.status, 'accepted')
  })

  it('rejects an expired or cross-context session per item without touching comparison progress', async () => {
    const { service, store, handler } = harness()
    const token = service.issueSession(context)
    const receipt = await service.ingestClientBatch({
      body: batch([event()]),
      sessionHeader: token,
      context: Object.freeze({ ...context, bindingMaterial: 'another-browser-session' }),
      environment: 'test',
    })

    assert.deepEqual(receipt.items[0], {
      event_id: 'e012e556-892e-4b2c-a993-c4417b9bcde7',
      status: 'rejected',
      error_code: 'ACTOR_IDENTITY_INVALID',
    })
    assert.equal(handler.calls.length, 0)
    assert.equal(store.events.size, 0)
  })

  it('rejects protected identity and sensitive query fields without persisting their values', async () => {
    const { service, store, handler } = harness()
    const token = service.issueSession(context)
    const receipt = await service.ingestClientBatch({
      body: batch([
        event({ user_id: 'forged-user' }),
        event({
          event_id: 'f012e556-892e-4b2c-a993-c4417b9bcde7',
          payload: { ...(event().payload as object), raw_query: 'private text' },
        }),
      ]),
      sessionHeader: token,
      context,
      environment: 'test',
    })

    assert.equal(receipt.items[0]?.error_code, 'IDENTITY_FIELD_FORBIDDEN')
    assert.equal(receipt.items[1]?.error_code, 'SENSITIVE_FIELD_FORBIDDEN')
    assert.equal(handler.calls.length, 0)
    assert.equal(store.events.size, 0)
    assert.equal(JSON.stringify(store.receipts).includes('private text'), false)
  })

  it('rejects header and item session ambiguity for the whole batch', async () => {
    const { service } = harness()
    const token = service.issueSession(context)
    await assert.rejects(
      service.ingestClientBatch({
        body: batch([event({ session_id: token })]),
        sessionHeader: token,
        context,
        environment: 'test',
      }),
      (error: unknown) => error instanceof AnalyticsError &&
        error.code === 'SESSION_BINDING_AMBIGUOUS' && error.httpStatus === 422,
    )
  })

  it('accepts one body-bound session and rejects a multi-session batch before any item write', async () => {
    const { service, store, handler } = harness()
    const token = service.issueSession(context)
    const accepted = await service.ingestClientBatch({
      body: batch([event({ session_id: token })]),
      sessionHeader: null,
      context,
      environment: 'test',
    })
    assert.equal(accepted.items[0]?.status, 'accepted')

    await assert.rejects(
      service.ingestClientBatch({
        body: batch([
          event({ event_id: 'a112e556-892e-4b2c-a993-c4417b9bcde7', session_id: token }),
          event({
            event_id: 'b112e556-892e-4b2c-a993-c4417b9bcde7',
            session_id: 'a-different-session',
          }),
        ]),
        sessionHeader: null,
        context,
        environment: 'test',
      }),
      (error: unknown) => error instanceof AnalyticsError &&
        error.code === 'MULTI_SESSION_BATCH_FORBIDDEN' && error.httpStatus === 422,
    )
    assert.equal(handler.calls.length, 1)
    assert.equal(store.events.size, 1)
  })

  it('deduplicates the same event id and rejects a client-authored completion event', async () => {
    const { service, handler } = harness()
    const token = service.issueSession(context)
    const command = { body: batch([event()]), sessionHeader: token, context, environment: 'test' as const }
    await service.ingestClientBatch(command)
    const duplicate = await service.ingestClientBatch(command)
    const completion = await service.ingestClientBatch({
      ...command,
      body: batch([event({
        event_id: 'd012e556-892e-4b2c-a993-c4417b9bcde7',
        event_name: 'comparison_completed',
      })]),
    })

    assert.equal(duplicate.items[0]?.status, 'deduplicated')
    assert.equal(completion.items[0]?.error_code, 'SCHEMA_INVALID')
    assert.equal(handler.calls.length, 1)
  })

  it('turns comparison ownership/version failures into item rejection rather than a false completion', async () => {
    const { service, handler, store } = harness()
    handler.error = Object.freeze({ code: 'COMPARISON_ACCESS_DENIED', httpStatus: 403 })
    const receipt = await service.ingestClientBatch({
      body: batch([event()]),
      sessionHeader: service.issueSession(context),
      context,
      environment: 'test',
    })
    assert.equal(receipt.items[0]?.error_code, 'COMPARISON_ACCESS_DENIED')
    assert.equal(store.events.size, 0)
  })
})
