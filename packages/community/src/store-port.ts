import type {
  InteractionChangeSource,
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

export interface ProjectInteractionFactChange {
  readonly interactionType: ProjectInteractionType
  readonly state: boolean
  readonly source: InteractionChangeSource
}
