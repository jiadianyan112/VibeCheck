import type { OutboxEvent } from '@vibecheck/database'

import type { OutboxHandler } from './runtime.js'

export interface PrivateMaterialScanProcessorPort {
  process(materialId: string): Promise<void>
}

export function createPrivateMaterialScanHandler(
  processor: PrivateMaterialScanProcessorPort,
): OutboxHandler {
  return async (event: OutboxEvent): Promise<void> => {
    const materialId = event.payload.material_id
    if (
      event.eventName!=='verification_material_scan_requested' ||
      event.aggregateType!=='verification_material' || event.eventVersion!==1 ||
      typeof materialId!=='string' || event.aggregateId!==materialId
    ) throw new Error('PRIVATE_MATERIAL_SCAN_EVENT_INVALID')
    await processor.process(materialId)
  }
}
