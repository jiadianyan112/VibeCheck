import type { PrototypeEvent, PrototypeEventName } from './types'

let eventSequence = 0

export function createPrototypeEvent(
  name: PrototypeEventName,
  payload: PrototypeEvent['payload'] = {},
  happenedAt = new Date().toISOString(),
): PrototypeEvent {
  eventSequence += 1
  return {
    id: `prototype-event-${eventSequence}`,
    name,
    happenedAt,
    payload,
  }
}
