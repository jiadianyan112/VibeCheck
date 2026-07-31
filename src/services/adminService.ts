import {
  evidences,
  lifecycleEvents,
  projects,
  verificationRequests,
} from '../mocks'
import type { ProjectId, ReviewStatus } from '../types'
import { notFound, runService, type ServiceOptions } from './runtime'
import type { ServiceResult } from './result'

export const adminService = {
  listProjectQueue(options?: ServiceOptions) {
    return runService(options, () =>
      projects.map((project) => ({
        project,
        hasActiveException:
          project.accessStatus.state === 'known' &&
          ['partial_abnormal', 'link_unavailable', 'suspected_migration'].includes(
            project.accessStatus.value,
          ),
        evidenceCount: evidences.filter(
          (evidence) => evidence.supports.projectId === project.id,
        ).length,
        eventCount: lifecycleEvents.filter((event) => event.projectId === project.id)
          .length,
      })),
    )
  },

  async getProjectRecord(id: ProjectId, options?: ServiceOptions) {
    const result = await runService(options, () => {
      const project = projects.find((item) => item.id === id)
      return project
        ? {
            project,
            evidences: evidences.filter(
              (evidence) => evidence.supports.projectId === id,
            ),
            events: lifecycleEvents.filter((event) => event.projectId === id),
            verificationRequests: verificationRequests.filter(
              (request) => request.projectId === id,
            ),
          }
        : null
    })
    if (!result.ok) return result
    if (!result.data) return notFound('VC_ADMIN_PROJECT_NOT_FOUND', '后台未找到对应作品。')
    return { ok: true, data: result.data }
  },

  reviewProject(
    id: ProjectId,
    status: Extract<ReviewStatus, 'approved' | 'changes_requested' | 'rejected'>,
    reason: string,
    options?: ServiceOptions,
  ): Promise<ServiceResult<{ projectId: ProjectId; status: ReviewStatus; reason: string }>> {
    if (!reason.trim()) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'VC_REVIEW_REASON_REQUIRED',
          kind: 'validation',
          message: '审核操作必须填写原因。',
          retryable: false,
        },
      })
    }
    return runService(options, () => ({ projectId: id, status, reason }))
  },
}
