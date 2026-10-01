import type { OutboxEvent } from '@vibecheck/database'

import type { OutboxHandler } from './runtime.js'

export interface ProjectUpdateApplier {
  readonly applyApprovedUpdate: (
    updateId: string,
    reviewDecisionId: string,
  ) => Promise<unknown>
}

export function createProjectUpdateApplicationHandler(
  applier: ProjectUpdateApplier,
): OutboxHandler {
  return async (event: OutboxEvent): Promise<void> => {
    const updateId = event.payload.project_update_id
    const reviewDecisionId = event.payload.review_decision_id
    if (
      event.eventName !== 'project_update_approved' || event.aggregateType !== 'project_update' ||
      typeof updateId !== 'string' || typeof reviewDecisionId !== 'string' ||
      event.aggregateId !== updateId
    ) throw new Error('PROJECT_UPDATE_APPLICATION_EVENT_INVALID')
    await applier.applyApprovedUpdate(updateId, reviewDecisionId)
  }
}
