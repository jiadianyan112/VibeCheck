import type { OutboxEvent } from '@vibecheck/database'

import type { OutboxHandler } from './runtime.js'

export interface MediaScanProcessorPort { process(mediaResourceId: string): Promise<void> }

export function createMediaScanHandler(processor: MediaScanProcessorPort): OutboxHandler {
  return async (event: OutboxEvent): Promise<void> => {
    const id = event.payload.media_resource_id
    if (
      event.eventName !== 'media_scan_requested' || event.aggregateType !== 'media_resource' ||
      event.eventVersion !== 1 || typeof id !== 'string' || event.aggregateId !== id
    ) throw new Error('MEDIA_SCAN_EVENT_INVALID')
    await processor.process(id)
  }
}
