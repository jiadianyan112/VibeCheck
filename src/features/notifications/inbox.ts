import type { Notification, NotificationType, ProjectId, PrototypeUser } from '../../types'
import { isStaffRole } from '../auth/session'

export const notificationTypeLabels: Record<NotificationType, string> = {
  project_updated: '作品更新',
  comment_replied: '评论回复',
  submission_reviewed: '发布审核',
  verification_reviewed: '身份审核',
  status_abnormal: '状态异常',
}

export function notificationTargetAccess(
  notification: Notification,
  user: PrototypeUser,
  projectIds: ReadonlySet<ProjectId>,
) {
  const target = notification.targetPath
  if (!target.startsWith('/') || target.startsWith('//')) {
    return { allowed: false, reason: '通知目标不是安全的站内路径。' }
  }
  if (target.startsWith('/admin') && !isStaffRole(user.role)) {
    return { allowed: false, reason: '当前账号没有后台访问权限。' }
  }
  if (notification.projectId && !projectIds.has(notification.projectId)) {
    return { allowed: false, reason: '目标作品档案已不存在或当前不可访问。' }
  }
  return { allowed: true, reason: null }
}
