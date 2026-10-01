import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createSubmissionPublicationHandler } from './submission-publication-handler.js'

const submissionId = '96000000-0000-4000-8000-000000000011'
const reviewDecisionId = '96000000-0000-4000-8000-000000000012'

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return Object.freeze({
    outboxId: '97000000-0000-4000-8000-000000000001',
    eventId: '97000000-0000-4000-8000-000000000002',
    aggregateType: 'submission',
    aggregateId: submissionId,
    eventName: 'submission_approved',
    eventVersion: 2,
    payload: Object.freeze({ submission_id: submissionId, review_decision_id: reviewDecisionId }),
    transactionId: '97000000-0000-4000-8000-000000000003',
    attemptCount: 1,
    ...overrides,
  })
}

test('submission publication handler binds the approved event to its aggregate', async () => {
  const calls: string[][] = []
  const handler = createSubmissionPublicationHandler({
    async publishApprovedSubmission(receivedSubmissionId, receivedReviewDecisionId) {
      calls.push([receivedSubmissionId, receivedReviewDecisionId])
    },
  })
  await handler(event())
  assert.deepEqual(calls, [[submissionId, reviewDecisionId]])
})

test('submission publication handler rejects malformed and cross-aggregate events', async () => {
  const handler = createSubmissionPublicationHandler({
    async publishApprovedSubmission() {
      assert.fail('publisher must not receive an invalid event')
    },
  })
  await assert.rejects(
    () => handler(event({ aggregateId: '97000000-0000-4000-8000-000000000099' })),
    (error: unknown) => error instanceof Error &&
      error.message === 'SUBMISSION_PUBLICATION_EVENT_INVALID',
  )
  await assert.rejects(
    () => handler(event({ payload: Object.freeze({ submission_id: submissionId }) })),
    (error: unknown) => error instanceof Error &&
      error.message === 'SUBMISSION_PUBLICATION_EVENT_INVALID',
  )
})
