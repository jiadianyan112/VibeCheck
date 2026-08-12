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

export interface SetProjectInteractionCommand {
  readonly userId: string
  readonly projectId: string
  readonly targetType: string
  readonly interactionType: string
  readonly state: boolean
  readonly clientRequestId: string
}
