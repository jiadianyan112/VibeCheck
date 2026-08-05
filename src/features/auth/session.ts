import {
  comparisonSessions,
  decisionRecords,
  notifications,
  submissionDrafts,
  userAssets,
  verificationRequests,
} from '../../mocks'
import type { AppAction } from '../../state'
import type { PrototypeUser, UserRole } from '../../types'

export const roleLabels: Record<UserRole, string> = {
  guest: '游客',
  user: '普通注册用户',
  verified_author: '已验证作者',
  editor: '平台编辑',
  admin: '管理员',
}

export const roleDescriptions: Record<PrototypeUser['role'], string> = {
  user: '验证收藏、比较、发布草稿和身份申请。',
  verified_author: '验证作者主页与已关联作品更新权限。',
  editor: '验证内容审核、证据维护和状态复核。',
  admin: '验证全部后台入口和管理权限。',
}

export function createLoginAction(user: PrototypeUser): Extract<AppAction, { type: 'LOGIN_COMPLETED' }> {
  const index = userAssets.find((assets) => assets.userId === user.id)
  const ownedSessions = comparisonSessions.filter((session) => index?.comparisonSessionIds.includes(session.id))
  return {
    type: 'LOGIN_COMPLETED',
    user,
    userComparisonProjectIds: ownedSessions.flatMap((session) => session.projectIds),
    assets: {
      comparisonSessions: ownedSessions,
      favoriteProjectIds: index?.favoriteProjectIds ?? [],
      followedProjectIds: index?.followedProjectIds ?? [],
      recentProjectIds: index?.recentProjectIds ?? [],
      decisionRecords: decisionRecords.filter((record) => index?.decisionRecordIds.includes(record.id)),
      submissionDrafts: submissionDrafts.filter((draft) => index?.submissionDraftIds.includes(draft.id)),
      verificationRequests: verificationRequests.filter((request) => index?.verificationRequestIds.includes(request.id)),
      notifications: notifications.filter((notification) => index?.notificationIds.includes(notification.id)),
    },
  }
}

export function isStaffRole(role: UserRole) {
  return role === 'editor' || role === 'admin'
}
