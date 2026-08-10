import type { OutboxEvent } from '@vibecheck/database'
import { withSpan } from '@vibecheck/observability'

export type OutboxHandler = (event: OutboxEvent) => Promise<void>

export interface OutboxStore {
  readonly requeueExpired: () => Promise<number>
  readonly claim: (
    workerId: string,
    eventNames: readonly string[],
    limit: number,
  ) => Promise<readonly OutboxEvent[]>
  readonly markPublished: (outboxId: string) => Promise<void>
  readonly markRetry: (outboxId: string, errorCode: string) => Promise<void>
}

export interface WorkerCycleResult {
  readonly requeued: number
  readonly claimed: number
  readonly published: number
  readonly failed: number
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)) {
    return error.message
  }
  return 'OUTBOX_HANDLER_FAILED'
}

export async function runWorkerCycle(
  store: OutboxStore,
  workerId: string,
  handlers: ReadonlyMap<string, OutboxHandler>,
  batchSize: number,
): Promise<WorkerCycleResult> {
  const requeued = await store.requeueExpired()
  const eventNames = [...handlers.keys()].sort()
  if (eventNames.length === 0) {
    return Object.freeze({ requeued, claimed: 0, published: 0, failed: 0 })
  }

  const events = await store.claim(workerId, eventNames, batchSize)
  let published = 0
  let failed = 0

  for (const event of events) {
    const handler = handlers.get(event.eventName)
    if (handler === undefined) {
      await store.markRetry(event.outboxId, 'OUTBOX_HANDLER_NOT_REGISTERED')
      failed += 1
      continue
    }

    try {
      await withSpan(
        'vibecheck-worker',
        'outbox.consume',
        {
          'messaging.message.id': event.eventId,
          'messaging.destination.name': event.eventName,
          'vibecheck.aggregate.type': event.aggregateType,
        },
        async () => handler(event),
      )
      await store.markPublished(event.outboxId)
      published += 1
    } catch (error) {
      await store.markRetry(event.outboxId, errorCode(error))
      failed += 1
    }
  }

  return Object.freeze({ requeued, claimed: events.length, published, failed })
}
