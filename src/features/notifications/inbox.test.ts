import { notificationId, projectId, userId, type Notification } from '../../types'
import { prototypeUsers } from '../../mocks'
import { notificationTargetAccess, notificationTypeLabels } from './inbox'

const notification: Notification = {
  id: notificationId('notification-test'), userId: userId('user-mia'), type: 'project_updated', title: '测试', body: '测试', targetPath: '/project/project-quizforge#event', projectId: projectId('project-quizforge'), eventId: null, isRead: false, createdAt: '2026-07-31T10:00:00+08:00',
}

describe('notification targets', () => {
  it('keeps all inbox categories explicit and free of marketing types', () => {
    expect(Object.keys(notificationTypeLabels)).toEqual(['project_updated', 'comment_replied', 'submission_reviewed', 'verification_reviewed', 'status_abnormal'])
  })

  it('accepts an existing internal project anchor', () => {
    expect(notificationTargetAccess(notification, prototypeUsers[0]!, new Set([projectId('project-quizforge')]))).toEqual({ allowed: true, reason: null })
  })

  it('blocks unsafe, missing and staff-only targets with an explanation', () => {
    expect(notificationTargetAccess({ ...notification, targetPath: '//outside.test' }, prototypeUsers[0]!, new Set()).allowed).toBe(false)
    expect(notificationTargetAccess(notification, prototypeUsers[0]!, new Set()).reason).toContain('不存在')
    expect(notificationTargetAccess({ ...notification, projectId: null, targetPath: '/admin/reviews' }, prototypeUsers[0]!, new Set()).reason).toContain('后台访问权限')
  })
})
