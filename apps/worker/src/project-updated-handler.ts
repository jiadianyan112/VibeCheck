import type { OutboxEvent } from '@vibecheck/database'

import type { OutboxHandler } from './runtime.js'

export interface UpdatedProjectIndexer {
  readonly indexUpdatedProject: (input: Readonly<{
    projectId: string
    versionId: string
    updateId: string
    reviewDecisionId: string
    eventId: string
  }>) => Promise<unknown>
}

export interface ProjectUpdatedNotifier {
  readonly createProjectUpdatedNotifications: (input: Readonly<{
    projectId: string
    versionId: string
    updateId: string
    reviewDecisionId: string
    eventId: string
    now: Date
  }>) => Promise<unknown>
}

export function createProjectUpdatedHandler(
  indexer: UpdatedProjectIndexer,
  notifier: ProjectUpdatedNotifier,
  now: () => Date = () => new Date(),
): OutboxHandler {
  return async (event: OutboxEvent): Promise<void> => {
    const projectId = event.payload.project_id
    const versionId = event.payload.version_id
    const updateId = event.payload.update_id
    const reviewDecisionId = event.payload.review_decision_id
    const eventId = event.payload.event_id
    if (
      event.eventName !== 'project_updated' || event.eventVersion !== 2 ||
      event.aggregateType !== 'project' || event.aggregateId !== projectId ||
      typeof projectId !== 'string' || typeof versionId !== 'string' ||
      typeof updateId !== 'string' || typeof reviewDecisionId !== 'string' ||
      typeof eventId !== 'string' || event.payload.source_type !== 'project_update' ||
      event.payload.initiator_type !== 'verified_author' ||
      event.payload.update_type !== 'author_content_update' || event.payload.result !== 'success'
    ) throw new Error('PROJECT_UPDATED_EVENT_INVALID')
    const command = { projectId, versionId, updateId, reviewDecisionId, eventId }
    await indexer.indexUpdatedProject(command)
    await notifier.createProjectUpdatedNotifications({ ...command, now: now() })
  }
}
