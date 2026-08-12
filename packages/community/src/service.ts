import { createHash } from 'node:crypto'

import { communityError } from './errors.js'
import type { ProjectInteractionStore } from './store-port.js'
import {
  projectInteractionTypes,
  type ProjectInteractionProjection,
  type ProjectInteractionType,
  type SetProjectInteractionCommand,
} from './types.js'

export interface CommunityServiceDependencies {
  readonly store: ProjectInteractionStore
  readonly now?: () => Date
}

export class CommunityService {
  private readonly now: () => Date

  constructor(private readonly dependencies: CommunityServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  setProjectInteraction(
    command: SetProjectInteractionCommand,
  ): Promise<ProjectInteractionProjection> {
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const projectId = this.uuid(command.projectId, 'PROJECT_ID_INVALID')
    if (command.targetType !== 'project') throw communityError('INTERACTION_TARGET_TYPE_INVALID', 422)
    if (!projectInteractionTypes.includes(command.interactionType as ProjectInteractionType)) {
      throw communityError('INTERACTION_TYPE_INVALID', 422)
    }
    if (typeof command.state !== 'boolean') throw communityError('INTERACTION_STATE_INVALID', 422)
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(command.clientRequestId)) {
      throw communityError('CLIENT_REQUEST_ID_INVALID', 422)
    }
    const interactionType = command.interactionType as ProjectInteractionType
    const requestHash = createHash('sha256').update(JSON.stringify({
      project_id: projectId,
      target_type: 'project',
      interaction_type: interactionType,
      state: command.state,
    })).digest('hex')
    return this.dependencies.store.setProjectInteraction({
      userId,
      projectId,
      interactionType,
      state: command.state,
      clientRequestId: command.clientRequestId,
      requestHash,
      now: this.now(),
    })
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw communityError(code, 422)
    }
    return value.toLowerCase()
  }
}
