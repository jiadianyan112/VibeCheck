export const projectInteractionTypes = Object.freeze(['favorite', 'like', 'follow'] as const)
export type ProjectInteractionType = typeof projectInteractionTypes[number]
export type InteractionChangeSource = 'explicit' | 'follow_cascade' | 'favorite_cascade'

export interface InteractionStates {
  readonly favorite: boolean
  readonly like: boolean
  readonly follow: boolean
}

export interface InteractionCounts {
  readonly favorite_count: number
  readonly like_count: number
  readonly follower_count: number
}

export interface InteractionChangeSources {
  readonly favorite: InteractionChangeSource | null
  readonly like: InteractionChangeSource | null
  readonly follow: InteractionChangeSource | null
}

export interface ProjectInteractionProjection {
  readonly project_id: string
  readonly result: 'changed' | 'no_change'
  readonly states: InteractionStates
  readonly counts: InteractionCounts
  readonly count_deltas: InteractionCounts
  readonly change_sources: InteractionChangeSources
  readonly updated_at: string
}

export interface ProjectInteractionReadProjection {
  readonly project_id: string
  readonly states: InteractionStates
  readonly counts: InteractionCounts
}

export interface ProjectInteractionsProjection {
  readonly items: readonly ProjectInteractionReadProjection[]
}

export interface FavoriteProjectInteractionsPage {
  readonly items: readonly ProjectInteractionReadProjection[]
  readonly next_cursor: string | null
}

export interface GetProjectInteractionsCommand {
  readonly userId: string
  readonly projectIds: readonly string[]
}

export interface ListFavoriteProjectInteractionsCommand {
  readonly userId: string
  readonly limit: number
  readonly cursor: string | null
}

export interface SetProjectInteractionCommand {
  readonly userId: string
  readonly projectId: string
  readonly targetType: string
  readonly interactionType: string
  readonly state: boolean
  readonly clientRequestId: string
}

export const commentModerationStates = Object.freeze([
  'pending',
  'under_review',
  'visible',
  'collapsed',
  'hidden',
  'rejected',
  'author_withdrawn',
] as const)
export type CommentModerationState = typeof commentModerationStates[number]

export interface CommentProjection {
  readonly comment_id: string
  readonly project_id: string
  readonly parent_comment_id: string | null
  readonly body: string
  readonly moderation_state: CommentModerationState
  readonly version: number
  readonly result: 'created' | 'deduplicated' | 'changed' | 'no_change'
  readonly created_at: string
  readonly updated_at: string
  readonly author_withdrawn_at: string | null
}

export interface PublicCommentProjection {
  readonly comment_id: string
  readonly project_id: string
  readonly parent_comment_id: string | null
  readonly body: string
  readonly moderation_state: 'visible' | 'collapsed'
  readonly default_collapsed: boolean
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface CommentPage {
  readonly items: readonly PublicCommentProjection[]
  readonly next_cursor: string | null
}

export interface ExperienceProjection {
  readonly comment_id: string
  readonly project_id: string
  readonly author_user_id: string
  readonly task: string
  readonly outcome: string
  readonly scenario: string | null
  readonly limitation: string | null
  readonly screenshot_media_resource_ids: readonly string[]
  readonly moderation_state: CommentModerationState
  readonly version: number
  readonly result: 'created' | 'deduplicated'
  readonly created_at: string
}

export interface PublicExperienceProjection extends Omit<ExperienceProjection, 'author_user_id' | 'result' | 'moderation_state'> {
  readonly author_label: string
  readonly moderation_state: 'visible' | 'collapsed'
  readonly author_reply: string | null
  readonly author_reply_at: string | null
  readonly replies: readonly {
    readonly comment_id: string
    readonly body: string
    readonly created_at: string
    readonly moderation_state: 'visible' | 'collapsed'
  }[]
}

export interface ExperiencePage {
  readonly items: readonly PublicExperienceProjection[]
  readonly next_cursor: string | null
}

export interface CreateExperienceCommand {
  readonly userId: string
  readonly projectId: string
  readonly task: string
  readonly outcome: string
  readonly scenario: string | null
  readonly limitation: string | null
  readonly screenshotMediaResourceIds: readonly string[]
  readonly clientRequestId: string
}

export interface ListExperiencesCommand {
  readonly projectId: string
  readonly cursor: string | null
}

export interface ReplyToExperienceCommand {
  readonly userId: string
  readonly experienceId: string
  readonly body: string
  readonly clientRequestId: string
}

export interface CreateCommentCommand {
  readonly userId: string
  readonly projectId: string
  readonly body: string
  readonly parentCommentId: string | null
  readonly clientRequestId: string
}

export interface ListCommentsCommand {
  readonly projectId: string
  readonly cursor: string | null
  readonly sort: string | null
}

export interface WithdrawCommentCommand {
  readonly userId: string
  readonly commentId: string
  readonly expectedVersion: number
  readonly operationId: string
}

export interface CommentReportProjection {
  readonly report_id: string
  readonly project_id: string
  readonly comment_id: string
  readonly reason_code: string
  readonly status: 'open' | 'resolved_actioned' | 'resolved_no_action' | 'withdrawn'
  readonly review_work_item_id: string | null
  readonly note_provided: boolean
  readonly version: number
  readonly result: 'created' | 'deduplicated'
  readonly created_at: string
  readonly updated_at: string
  readonly resolved_at: string | null
}

export interface ReportCommentCommand {
  readonly userId: string
  readonly commentId: string
  readonly reasonCode: string
  readonly note: string | null
  readonly clientRequestId: string
}

export interface ModerateCommentCommand {
  readonly reviewContext?: { readonly actorUserId: string; readonly workItemId: string; readonly claimToken: string }
  readonly commentId: string
  readonly expectedVersion: number
  readonly resultingState: Exclude<CommentModerationState, 'author_withdrawn'>
  readonly decisionId: string
  readonly actorType: 'system' | 'platform_editor' | 'admin'
  readonly reasonCode: string
  readonly ruleVersion: string | null
}
