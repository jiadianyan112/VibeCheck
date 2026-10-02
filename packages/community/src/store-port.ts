import type {
  CommentProjection,
  CommentReportProjection,
  ExperienceProjection,
  PublicExperienceProjection,
  CommentModerationState,
  InteractionChangeSource,
  PublicCommentProjection,
  ProjectInteractionProjection,
  ProjectInteractionsProjection,
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

export interface GetStoredProjectInteractionsInput {
  readonly userId: string
  readonly projectIds: readonly string[]
}

export interface ProjectInteractionStore {
  setProjectInteraction(
    input: SetStoredProjectInteractionInput,
  ): Promise<ProjectInteractionProjection>
  getProjectInteractions?(
    input: GetStoredProjectInteractionsInput,
  ): Promise<ProjectInteractionsProjection>
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
  createExperience(input: {
    readonly userId: string
    readonly projectId: string
    readonly task: string
    readonly outcome: string
    readonly scenario: string | null
    readonly limitation: string | null
    readonly screenshotMediaResourceIds: readonly string[]
    readonly clientRequestId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<ExperienceProjection>
  listExperiences(input: {
    readonly projectId: string
    readonly after: PublicCommentPageAnchor | null
    readonly limit: number
  }): Promise<{ readonly items: readonly PublicExperienceProjection[]; readonly nextAnchor: PublicCommentPageAnchor | null }>
  replyToExperience(input: {
    readonly userId: string
    readonly experienceId: string
    readonly body: string
    readonly clientRequestId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<CommentProjection>
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
    readonly reviewContext?: { readonly actorUserId: string; readonly workItemId: string; readonly claimTokenHash: Buffer }
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
