import { comments } from '../mocks'
import type { ProjectId } from '../types'
import { runService, type ServiceOptions } from './runtime'

export const communityService = {
  listComments(projectId: ProjectId, options?: ServiceOptions) {
    return runService(options, () => comments.filter((comment) => comment.projectId === projectId))
  },
}
