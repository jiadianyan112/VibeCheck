import { notifications } from '../mocks'
import type { Notification, NotificationId, UserId } from '../types'
import { runService, type ServiceOptions } from './runtime'

export const notificationService = {
  listForUser(userId: UserId, options?: ServiceOptions) {
    return runService(options, () =>
      notifications.filter((notification) => notification.userId === userId),
    )
  },

  markRead(id: NotificationId, options?: ServiceOptions) {
    return runService(options, () => {
      const notification = notifications.find((item) => item.id === id)
      return notification
        ? ({ ...notification, isRead: true } satisfies Notification)
        : null
    })
  },
}
