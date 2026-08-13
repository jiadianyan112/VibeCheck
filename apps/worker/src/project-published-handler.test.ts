import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutboxEvent } from '@vibecheck/database'

import { createProjectPublishedHandler } from './project-published-handler.js'

const projectId = '98000000-0000-4000-8000-000000000001'
const versionId = '98000000-0000-4000-8000-000000000002'
const submissionId = '98000000-0000-4000-8000-000000000003'
const reviewDecisionId = '98000000-0000-4000-8000-000000000004'

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return Object.freeze({
    outboxId: '98000000-0000-4000-8000-000000000005',
    eventId: '98000000-0000-4000-8000-000000000006',
    aggregateType: 'project', aggregateId: projectId, eventName: 'project_published',
    eventVersion: 1, transactionId: '98000000-0000-4000-8000-000000000007', attemptCount: 1,
    payload: Object.freeze({
      project_id: projectId, version_id: versionId, submission_id: submissionId,
      review_decision_id: reviewDecisionId,
    }),
    ...overrides,
  })
}

test('project published handler forwards one fully bound projection command', async () => {
  const received: unknown[] = []
  const handler = createProjectPublishedHandler({
    async indexPublishedProject(input) { received.push(input) },
  })
  await handler(event())
  assert.deepEqual(received, [{ projectId, versionId, submissionId, reviewDecisionId }])
})

test('project published handler rejects a cross-project aggregate', async () => {
  const handler = createProjectPublishedHandler({
    async indexPublishedProject() { assert.fail('invalid event reached indexer') },
  })
  await assert.rejects(
    () => handler(event({ aggregateId: '98000000-0000-4000-8000-000000000099' })),
    (error: unknown) => error instanceof Error && error.message === 'PROJECT_PUBLISHED_EVENT_INVALID',
  )
})
