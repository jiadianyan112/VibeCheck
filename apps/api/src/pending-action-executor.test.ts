import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { IdentityError, type PendingActionExecutionProjection } from '@vibecheck/identity'

import { PendingActionExecutor } from './pending-action-executor.js'

const base = Object.freeze({
  pending_action_id: '63000000-0000-4000-8000-000000000001',
  return_to: '/projects/63000000-0000-4000-8000-000000000002',
  status: 'pending' as const,
  expires_at: '2026-08-13T08:15:00.000Z',
  consumed_at: null,
  cancelled_at: null,
  cancel_reason: null,
  client_request_id: '63000000-0000-4000-8000-000000000003',
})

function action(
  payload: PendingActionExecutionProjection['payload'],
): PendingActionExecutionProjection {
  return Object.freeze({ ...base, action_type: payload.action_type, payload })
}

describe('PendingActionExecutor', () => {
  it('uses the stored request id for interaction and comment domain writes', async () => {
    const commands: unknown[] = []
    const executor = new PendingActionExecutor({
      community: {
        async setProjectInteraction(command) {
          commands.push(command)
          return {} as never
        },
        async createComment(command) {
          commands.push(command)
          return {} as never
        },
      },
    })
    await executor.execute({
      action: action({
        action_type: 'set_project_follow',
        project_id: '63000000-0000-4000-8000-000000000002',
        state: true,
      }),
      userId: '63000000-0000-4000-8000-000000000004',
      identityLinkId: '63000000-0000-4000-8000-000000000006',
      requestId: 'request-replay-1',
    })
    await executor.execute({
      action: action({
        action_type: 'create_comment',
        project_id: '63000000-0000-4000-8000-000000000002',
        body: '登录后只创建一次',
        parent_comment_id: null,
      }),
      userId: '63000000-0000-4000-8000-000000000004',
      identityLinkId: '63000000-0000-4000-8000-000000000006',
      requestId: 'request-replay-2',
    })
    assert.deepEqual(commands, [
      {
        userId: '63000000-0000-4000-8000-000000000004',
        projectId: '63000000-0000-4000-8000-000000000002',
        targetType: 'project',
        interactionType: 'follow',
        state: true,
        clientRequestId: '63000000-0000-4000-8000-000000000003',
      },
      {
        userId: '63000000-0000-4000-8000-000000000004',
        projectId: '63000000-0000-4000-8000-000000000002',
        body: '登录后只创建一次',
        parentCommentId: null,
        clientRequestId: '63000000-0000-4000-8000-000000000003',
      },
    ])
  })

  it('cancels a guest comparison save while preserving the account comparison', async () => {
    const executor = new PendingActionExecutor({})
    const result = await executor.execute({
      action: action({
        action_type: 'save_comparison',
        comparison_id: '63000000-0000-4000-8000-000000000005',
        comparison_version: 2,
        state: true,
      }),
      userId: '63000000-0000-4000-8000-000000000004',
      identityLinkId: '63000000-0000-4000-8000-000000000006',
      requestId: 'request-replay-3',
    })
    assert.deepEqual(result, { status: 'cancelled', reason: 'account_comparison_preserved' })
  })

  it('does not consume unimplemented submission or unavailable domain actions', async () => {
    const executor = new PendingActionExecutor({})
    await assert.rejects(
      () => executor.execute({
        action: action({ action_type: 'start_submission', category_id: 'ai_learning_quiz' }),
        userId: '63000000-0000-4000-8000-000000000004',
        identityLinkId: '63000000-0000-4000-8000-000000000006',
        requestId: 'request-replay-4',
      }),
      (error: unknown) => error instanceof IdentityError &&
        error.code === 'PENDING_ACTION_EXECUTION_NOT_IMPLEMENTED' && error.httpStatus === 501,
    )
    await assert.rejects(
      () => executor.execute({
        action: action({
          action_type: 'set_project_like',
          project_id: '63000000-0000-4000-8000-000000000002',
          state: true,
        }),
        userId: '63000000-0000-4000-8000-000000000004',
        identityLinkId: '63000000-0000-4000-8000-000000000006',
        requestId: 'request-replay-5',
      }),
      (error: unknown) => error instanceof IdentityError &&
        error.code === 'PENDING_ACTION_EXECUTION_UNAVAILABLE' && error.httpStatus === 503,
    )
  })
})
