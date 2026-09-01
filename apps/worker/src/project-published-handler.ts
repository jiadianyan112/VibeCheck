import type { OutboxEvent } from '@vibecheck/database'

import type { OutboxHandler } from './runtime.js'

export interface PublishedProjectIndexer {
  readonly indexPublishedProject: (input: Readonly<{
    projectId: string
    versionId: string
    submissionId: string
    reviewDecisionId: string
  }>) => Promise<unknown>
}

export interface ProjectPublishedNotifier {
  readonly createProjectPublishedNotification: (input: Readonly<{
    projectId: string
    versionId: string
    submissionId: string
    reviewDecisionId: string
    eventId: string
    now: Date
  }>) => Promise<unknown>
}

export function createProjectPublishedHandler(
  indexer: PublishedProjectIndexer,
  notifier: ProjectPublishedNotifier,
  now: () => Date = () => new Date(),
): OutboxHandler {
  return async (event: OutboxEvent): Promise<void> => {
    const projectId = event.payload.project_id
    const versionId = event.payload.version_id
    const submissionId = event.payload.submission_id
    const reviewDecisionId = event.payload.review_decision_id
    const eventId = event.payload.event_id
    if (
      typeof projectId !== 'string' || typeof versionId !== 'string' ||
      typeof submissionId !== 'string' || typeof reviewDecisionId !== 'string' ||
      typeof eventId !== 'string' ||
      event.eventName !== 'project_published' || event.aggregateType !== 'project' ||
      event.aggregateId !== projectId
    ) throw new Error('PROJECT_PUBLISHED_EVENT_INVALID')
    await indexer.indexPublishedProject({ projectId, versionId, submissionId, reviewDecisionId })
    await notifier.createProjectPublishedNotification({
      projectId, versionId, submissionId, reviewDecisionId,
      eventId,
      now: now(),
    })
  }
}
