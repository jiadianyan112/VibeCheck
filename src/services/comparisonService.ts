import { comparisonSessions, projects } from '../mocks'
import {
  comparisonSessionId,
  type ComparisonSession,
  type ComparisonSessionId,
  type ProjectId,
} from '../types'
import { notFound, runService, validationFailure, type ServiceOptions } from './runtime'
import type { ServiceResult } from './result'

export const comparisonService = {
  async get(
    id: ComparisonSessionId,
    options?: ServiceOptions,
  ): Promise<ServiceResult<ComparisonSession>> {
    const result = await runService(options, () =>
      comparisonSessions.find((session) => session.id === id),
    )
    if (!result.ok) return result
    if (!result.data) return notFound('VC_COMPARISON_NOT_FOUND', '比较会话不存在。')
    return { ok: true, data: result.data }
  },

  create(projectIds: ProjectId[], sourcePath: string, options?: ServiceOptions) {
    return runService(options, () => {
      const uniqueIds = [...new Set(projectIds)]
      if (uniqueIds.length < 1 || uniqueIds.length > 5) {
        throw new Error('比较会话需要一至五个唯一作品。')
      }
      const validIds = uniqueIds.filter((id) => projects.some((project) => project.id === id))
      const session: ComparisonSession = {
        id: comparisonSessionId('comparison-service-draft'),
        ownerUserId: null,
        intent: null,
        projectIds: validIds,
        sourcePath,
        decisionId: null,
        createdAt: '2026-07-31T10:00:00+08:00',
        updatedAt: '2026-07-31T10:00:00+08:00',
        savedAt: null,
      }
      return session
    })
  },

  async validateForComparison(
    projectIds: ProjectId[],
  ): Promise<ServiceResult<ProjectId[]>> {
    const uniqueIds = [...new Set(projectIds)]
    if (uniqueIds.length < 2) {
      return validationFailure('VC_COMPARISON_TOO_SMALL', '至少选择两个作品开始比较。')
    }
    if (uniqueIds.length > 5) {
      return validationFailure('VC_COMPARISON_TOO_LARGE', '最多比较五个作品。')
    }
    return { ok: true, data: uniqueIds }
  },
}
