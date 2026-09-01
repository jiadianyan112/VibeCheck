import type { OutboxEvent } from '@vibecheck/database'

import type { OutboxHandler } from './runtime.js'

export interface SubmissionPublisher {
  readonly publishApprovedSubmission: (
    submissionId: string,
    reviewDecisionId: string,
  ) => Promise<unknown>
}

export function createSubmissionPublicationHandler(
  publisher: SubmissionPublisher,
): OutboxHandler {
  return async (event: OutboxEvent): Promise<void> => {
    const reviewDecisionId = event.payload.review_decision_id
    const submissionId = event.payload.submission_id
    if (typeof reviewDecisionId !== 'string' || typeof submissionId !== 'string') {
      throw new Error('SUBMISSION_PUBLICATION_EVENT_INVALID')
    }
    if (
      event.eventName !== 'submission_approved' || event.aggregateType !== 'submission' ||
      event.aggregateId !== submissionId
    ) throw new Error('SUBMISSION_PUBLICATION_EVENT_INVALID')
    await publisher.publishApprovedSubmission(submissionId, reviewDecisionId)
  }
}
