import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { WorkflowError } from './errors.js'
import { WorkflowService } from './service.js'
import type { WorkflowStore } from './store-port.js'
import type { ReviewActor, ReviewWorkItemProjection } from './types.js'

const now = new Date('2026-08-13T00:00:00.000Z')
const actor: ReviewActor = Object.freeze({
  userId: '91000000-0000-4000-8000-000000000001',
  roles: Object.freeze(['user', 'editor'] as const),
  permissions: Object.freeze(['admin:review'] as const),
})

function projection(overrides: Partial<ReviewWorkItemProjection> = {}): ReviewWorkItemProjection {
  return Object.freeze({
    work_item_id: '92000000-0000-4000-8000-000000000001',
    work_type: 'submission',
    target_type: 'submission',
    target_id: '93000000-0000-4000-8000-000000000001',
    work_item_status: 'queued',
    version: 1,
    assignee_user_id: null,
    lease_expires_at: null,
    domain_summary: Object.freeze({ status: 'pending_review' }),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  })
}

class FakeWorkflowStore implements WorkflowStore {
  listInput: Parameters<WorkflowStore['listWorkItems']>[0] | null = null
  claimInput: Parameters<WorkflowStore['claimWorkItem']>[0] | null = null
  heartbeatInput: Parameters<WorkflowStore['heartbeatWorkItem']>[0] | null = null
  releaseInput: Parameters<WorkflowStore['releaseWorkItem']>[0] | null = null

  async listWorkItems(input: Parameters<WorkflowStore['listWorkItems']>[0]) {
    this.listInput = input
    return Object.freeze({
      items: Object.freeze([projection()]),
      totalCount: 2,
      nextAnchor: Object.freeze({ createdAt: now, workItemId: projection().work_item_id }),
    })
  }

  async claimWorkItem(input: Parameters<WorkflowStore['claimWorkItem']>[0]) {
    this.claimInput = input
    return projection({
      work_item_status: 'claimed',
      version: 2,
      assignee_user_id: input.actor.userId,
      lease_expires_at: '2026-08-13T00:01:00.000Z',
    })
  }

  async heartbeatWorkItem(input: Parameters<WorkflowStore['heartbeatWorkItem']>[0]) {
    this.heartbeatInput = input
    return projection({
      work_item_status: 'claimed',
      version: 3,
      assignee_user_id: input.actor.userId,
      lease_expires_at: '2026-08-13T00:01:30.000Z',
    })
  }

  async releaseWorkItem(input: Parameters<WorkflowStore['releaseWorkItem']>[0]) {
    this.releaseInput = input
    return projection({ version: 4 })
  }

  async requeueExpiredClaims(): Promise<number> {
    return 0
  }
}

function service(store = new FakeWorkflowStore()): [WorkflowService, FakeWorkflowStore] {
  return [new WorkflowService(store, {
    cursorSecret: 'workflow-test-cursor-secret-at-least-thirty-two-characters',
    leaseSeconds: 60,
    maximumClaimSeconds: 900,
    queuePageSize: 1,
  }, () => now), store]
}

describe('WorkflowService', () => {
  it('signs queue cursors and rejects cross-filter reuse', async () => {
    const [workflow, store] = service()
    const page = await workflow.listWorkItems({
      actor, workType: 'submission', targetType: null, status: null, cursor: null,
      requestId: 'request-queue-1',
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.total_count, 2)
    assert.ok(page.next_cursor)

    await workflow.listWorkItems({
      actor, workType: 'submission', targetType: null, status: 'queued',
      cursor: page.next_cursor, requestId: 'request-queue-2',
    })
    assert.equal(store.listInput?.anchor?.workItemId, projection().work_item_id)

    await assert.rejects(
      workflow.listWorkItems({
        actor, workType: 'community', targetType: null, status: 'queued',
        cursor: page.next_cursor, requestId: 'request-queue-3',
      }),
      (error: unknown) => error instanceof WorkflowError && error.code === 'WORK_ITEM_CURSOR_INVALID',
    )
  })

  it('returns a one-time raw claim token while passing only its hash to persistence', async () => {
    const [workflow, store] = service()
    const claimed = await workflow.claimWorkItem({
      actor,
      workItemId: projection().work_item_id,
      expectedVersion: 1,
      expectedConflictPrincipalVersion: null,
      requestId: 'request-claim-1',
    })
    assert.match(claimed.claim_token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(store.claimInput?.claimTokenHash.length, 32)
    assert.equal(JSON.stringify(store.claimInput).includes(claimed.claim_token), false)
  })

  it('hashes heartbeat/release tokens and preserves admin override only for admins', async () => {
    const [workflow, store] = service()
    const claimed = await workflow.claimWorkItem({
      actor,
      workItemId: projection().work_item_id,
      expectedVersion: 1,
      expectedConflictPrincipalVersion: null,
      requestId: 'request-claim-2',
    })
    await workflow.heartbeatWorkItem({
      actor, workItemId: claimed.work_item_id, claimToken: claimed.claim_token,
      requestId: 'request-heartbeat-1',
    })
    await workflow.releaseWorkItem({
      actor, workItemId: claimed.work_item_id, claimToken: claimed.claim_token,
      reasonCode: 'manual_release', requestId: 'request-release-1',
    })
    assert.equal(store.heartbeatInput?.claimTokenHash.equals(store.releaseInput!.claimTokenHash), true)
    assert.equal(store.releaseInput?.allowAdminOverride, false)
  })

  it('denies identity queues without identity-review permission and creator profile to editors', async () => {
    const [workflow] = service()
    await assert.rejects(
      workflow.listWorkItems({
        actor, workType: 'verification', targetType: null, status: null, cursor: null,
        requestId: 'request-denied-1',
      }),
      (error: unknown) => error instanceof WorkflowError && error.code === 'WORK_ITEM_FORBIDDEN',
    )
    await assert.rejects(
      workflow.listWorkItems({
        actor, workType: 'creator_profile', targetType: null, status: null, cursor: null,
        requestId: 'request-denied-2',
      }),
      (error: unknown) => error instanceof WorkflowError && error.code === 'WORK_ITEM_FORBIDDEN',
    )
  })
})
