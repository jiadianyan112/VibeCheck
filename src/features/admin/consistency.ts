import type { AppState } from '../../state'
import type { Project } from '../../types'
import { mergeAdminProjects } from './projectQueue'

export interface AdminConsistencyIssue {
  code: 'duplicate_event' | 'duplicate_notification' | 'missing_alias_target' | 'unarchived_alias' | 'publication_sync' | 'identity_sync' | 'status_sync'
  targetId: string
  message: string
}

function duplicateIds(values: readonly { id: string }[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id)
    seen.add(value.id)
  }
  return [...duplicates]
}

export function checkAdminConsistency(state: AppState, baseProjects: readonly Project[]) {
  const issues: AdminConsistencyIssue[] = []
  const allProjects = mergeAdminProjects(baseProjects, state.projectOverrides)
  const projectById = new Map(allProjects.map((project) => [project.id, project]))
  const allEvents = [...state.lifecycleEventAdditions]

  for (const id of duplicateIds(allEvents)) issues.push({ code: 'duplicate_event', targetId: id, message: '生命周期事件 ID 重复。' })
  for (const id of duplicateIds(state.notifications)) issues.push({ code: 'duplicate_notification', targetId: id, message: '通知 ID 重复。' })

  for (const [from, to] of Object.entries(state.projectAliases)) {
    if (!projectById.has(to)) issues.push({ code: 'missing_alias_target', targetId: from, message: `稳定 ID 映射目标 ${to} 不存在。` })
    if (projectById.get(from as Project['id'])?.reviewStatus !== 'archived') issues.push({ code: 'unarchived_alias', targetId: from, message: '已建立映射的副档未保留为归档记录。' })
  }

  for (const log of state.adminWorkflowLogs) {
    if (log.action === 'publication_approved') {
      const draft = state.submissionDrafts.find((item) => item.id === log.targetId)
      const synced = draft?.status === 'approved'
        && Boolean(draft.publishedProjectId && projectById.has(draft.publishedProjectId))
        && Boolean(draft.publishedEventId && allEvents.some((event) => event.id === draft.publishedEventId))
        && state.notifications.some((notification) => notification.type === 'submission_reviewed' && notification.userId === draft.userId)
      if (!synced) issues.push({ code: 'publication_sync', targetId: log.targetId, message: '发布状态、公开作品、首次事件或提交者通知未同步。' })
    }
    if (log.action === 'identity_verified' || log.action === 'identity_disputed' || log.action === 'identity_failed' || log.action === 'identity_changes_requested') {
      const request = state.verificationRequests.find((item) => item.id === log.targetId)
      const project = request ? projectById.get(request.projectId) : null
      const expected = log.action === 'identity_verified' ? 'linked' : log.action === 'identity_disputed' ? 'disputed' : log.action === 'identity_failed' ? 'failed' : 'pending'
      const synced = request && project?.authorLinkStatus === expected
        && state.notifications.some((notification) => notification.type === 'verification_reviewed' && notification.userId === request.userId && notification.projectId === request.projectId)
      if (!synced) issues.push({ code: 'identity_sync', targetId: log.targetId, message: '身份审核、作品作者关联或申请人通知未同步。' })
    }
    if (log.action === 'status_confirmed' && log.projectId) {
      const project = projectById.get(log.projectId)
      const currentStatus = project?.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
      const matchingEvent = allEvents.some((event) => event.projectId === log.projectId && event.changes.some((change) => change.fieldKey === 'accessStatus' && change.after === log.afterValue))
      if (currentStatus !== log.afterValue || !matchingEvent) issues.push({ code: 'status_sync', targetId: log.projectId, message: '当前访问状态与追加的生命周期事件不一致。' })
    }
  }

  return {
    ok: issues.length === 0,
    checkedProjects: allProjects.length,
    checkedEvents: allEvents.length,
    checkedNotifications: state.notifications.length,
    issues,
  }
}
