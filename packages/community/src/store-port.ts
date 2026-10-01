import type {
  CommentProjection,
  CommentReportProjection,
  CommentModerationState,
  InteractionChangeSource,
  PublicCommentProjection,
  ProjectInteractionProjection,
  ProjectInteractionType,
} from './types.js'

export interface SetStoredProjectInteractionInput {
  readonly userId: string
  readonly projectId: string
  readonly interactionType: ProjectInteractionType
  readonly state: boolean
  readonly clientRequestId: string
  readonly requestHash: string
  readonly now: Date
}

export interface ProjectInteractionStore {
  setProjectInteraction(
    input: SetStoredProjectInteractionInput,
  ): Promise<ProjectInteractionProjection>
}

export interface PublicCommentPageAnchor {
  readonly createdAt: Date
  readonly commentId: string
}

export interface StoredPublicCommentPage {
  readonly items: readonly PublicCommentProjection[]
  readonly nextAnchor: PublicCommentPageAnchor | null
}

export interface CommunityStore extends ProjectInteractionStore {
  createComment(input: {
    readonly userId: string
    readonly projectId: string
    readonly parentCommentId: string | null
    readonly body: string
    readonly clientRequestId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection>
  listComments(input: {
    readonly projectId: string
    readonly after: PublicCommentPageAnchor | null
    readonly limit: number
  }): Promise<StoredPublicCommentPage>
  withdrawComment(input: {
    readonly userId: string
    readonly commentId: string
    readonly expectedVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection>
  reportComment(input: {
    readonly userId: string
    readonly commentId: string
    readonly reasonCode: string
    readonly noteCiphertext: Buffer | null
    readonly noteKeyVersion: string | null
    readonly clientRequestId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentReportProjection>
  moderateComment(input: {
    readonly commentId: string
    readonly expectedVersion: number
    readonly resultingState: Exclude<CommentModerationState, 'author_withdrawn'>
    readonly decisionId: string
    readonly actorType: 'system' | 'platform_editor' | 'admin'
    readonly reasonCode: string
    readonly ruleVersion: string | null
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection>
}

export interface ProjectInteractionFactChange {
  readonly interactionType: ProjectInteractionType
  readonly state: boolean
  readonly source: InteractionChangeSource
}
