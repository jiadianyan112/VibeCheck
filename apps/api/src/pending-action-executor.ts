import {
  ComparisonError,
  type ComparisonProjection,
  type SetComparisonSavedAfterLoginReplayCommand,
} from '@vibecheck/comparison'
import type {
  CommentProjection,
  CreateCommentCommand,
  ProjectInteractionProjection,
  SetProjectInteractionCommand,
} from '@vibecheck/community'
import { IdentityError, type PendingActionExecutionProjection } from '@vibecheck/identity'

interface InteractionDomain {
  setProjectInteraction(command: SetProjectInteractionCommand): Promise<ProjectInteractionProjection>
  createComment(command: CreateCommentCommand): Promise<CommentProjection>
}

interface ComparisonDomain {
  setSavedAfterLoginReplay(
    command: SetComparisonSavedAfterLoginReplayCommand,
  ): Promise<ComparisonProjection>
}

export interface PendingActionExecutorDependencies {
  readonly community?: InteractionDomain
  readonly comparison?: ComparisonDomain
}

export type PendingActionExecutionResult =
  | { readonly status: 'executed' }
  | { readonly status: 'cancelled'; readonly reason: 'account_comparison_preserved' }

export class PendingActionExecutor {
  constructor(private readonly dependencies: PendingActionExecutorDependencies) {}

  async execute(input: {
    readonly action: PendingActionExecutionProjection
    readonly userId: string
    readonly identityLinkId: string
    readonly requestId: string
  }): Promise<PendingActionExecutionResult> {
    const { action } = input
    if (
      action.payload.action_type === 'set_project_favorite' ||
      action.payload.action_type === 'set_project_like' ||
      action.payload.action_type === 'set_project_follow'
    ) {
      const community = this.requireCommunity()
      await community.setProjectInteraction({
        userId: input.userId,
        projectId: action.payload.project_id,
        targetType: 'project',
        interactionType: action.payload.action_type.replace('set_project_', ''),
        state: action.payload.state,
        clientRequestId: action.client_request_id,
      })
      return Object.freeze({ status: 'executed' })
    }
    if (action.payload.action_type === 'create_comment') {
      const community = this.requireCommunity()
      await community.createComment({
        userId: input.userId,
        projectId: action.payload.project_id,
        body: action.payload.body,
        parentCommentId: action.payload.parent_comment_id,
        clientRequestId: action.client_request_id,
      })
      return Object.freeze({ status: 'executed' })
    }
    if (action.payload.action_type === 'save_comparison') {
      if (!this.dependencies.comparison) {
        throw new IdentityError('PENDING_ACTION_EXECUTION_UNAVAILABLE', 503, true)
      }
      try {
        await this.dependencies.comparison.setSavedAfterLoginReplay({
          sourceComparisonId: action.payload.comparison_id,
          sourceComparisonVersion: action.payload.comparison_version,
          state: action.payload.state,
          identityLinkId: input.identityLinkId,
          subject: { kind: 'user', id: input.userId },
          requestId: input.requestId,
        })
        return Object.freeze({ status: 'executed' })
      } catch (error) {
        if (error instanceof ComparisonError && error.code === 'COMPARISON_REPLAY_TARGET_NOT_ADOPTED') {
          return Object.freeze({ status: 'cancelled', reason: 'account_comparison_preserved' })
        }
        throw error
      }
    }
    throw new IdentityError('PENDING_ACTION_EXECUTION_NOT_IMPLEMENTED', 501, false)
  }

  private requireCommunity(): InteractionDomain {
    if (!this.dependencies.community) {
      throw new IdentityError('PENDING_ACTION_EXECUTION_UNAVAILABLE', 503, true)
    }
    return this.dependencies.community
  }
}
