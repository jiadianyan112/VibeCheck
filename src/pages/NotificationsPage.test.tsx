import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import {
  APP_STORAGE_KEY,
  appReducer,
  createInitialAppState,
  persistAppState,
  type AppState,
} from '../state'
import { notificationId } from '../types'

function loginState(userIndex: number) {
  return appReducer(
    createInitialAppState(),
    createLoginAction(prototypeUsers[userIndex]!),
  )
}

function renderNotifications(state?: AppState) {
  if (state) persistAppState(state)
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/notifications'],
  })
  const result = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...result, router }
}

function notificationItem(title: string) {
  return screen.getByRole('heading', { name: title }).closest('li')!
}

describe('NotificationsPage', () => {
  beforeEach(() => localStorage.clear())

  it('lists only high-value notifications and keeps the global unread count in sync', async () => {
    const user = userEvent.setup()
    renderNotifications(loginState(0))

    expect(await screen.findByRole('heading', { name: '通知中心' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '通知 3' })).toBeInTheDocument()
    expect(screen.getByText('3 条未读 / 4 条全部')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '作品更新' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '评论回复' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '发布审核' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /营销|促销|活动推荐/ })).not.toBeInTheDocument()

    const item = notificationItem('题练工坊讨论有新回复')
    await user.click(within(item).getByRole('button', { name: '标为已读' }))
    expect(screen.getByRole('link', { name: '通知 2' })).toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as AppState
      expect(stored.notifications.find(({ id }) => id === 'notification-quizforge-comment-reply')?.isRead).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: '全部标为已读' }))
    expect(screen.getByRole('link', { name: '通知' })).toBeInTheDocument()
    expect(screen.getByText('0 条未读 / 4 条全部')).toBeInTheDocument()
  })

  it.each([
    [0, '口语回声发布 2.0', '/project/project-speakmirror', '#event-speakmirror-v2'],
    [0, '题练工坊讨论有新回复', '/project/project-quizforge', '#discussion'],
    [0, '学习复盘板审核状态已更新', '/me', '#reviews'],
    [2, 'DailyDrill 地址连续异常', '/project/project-dailydrill', '#current-status-heading'],
  ])('opens %s notification target precisely', async (userIndex, title, pathname, hash) => {
    const user = userEvent.setup()
    const { router } = renderNotifications(loginState(userIndex as number))
    const item = notificationItem(title as string)

    await user.click(within(item).getByRole('button', { name: '查看并定位' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(pathname)
      expect(router.state.location.hash).toBe(hash)
    })
  })

  it('explains a restricted target, stays in place, and records it as read', async () => {
    const user = userEvent.setup()
    const state = loginState(0)
    state.notifications.push({
      id: notificationId('notification-restricted-admin'),
      userId: prototypeUsers[0]!.id,
      type: 'submission_reviewed',
      title: '后台复核通知',
      body: '此目标只允许工作人员访问。',
      targetPath: '/admin/reviews',
      projectId: null,
      eventId: null,
      isRead: false,
      createdAt: '2026-08-01T12:00:00+08:00',
    })
    const { router } = renderNotifications(state)
    const item = notificationItem('后台复核通知')

    await user.click(within(item).getByRole('button', { name: '查看并定位' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号没有后台访问权限')
    expect(router.state.location.pathname).toBe('/notifications')
    expect(within(item).getByText('已读')).toBeInTheDocument()
  })

  it('keeps private notifications invisible after logout or for a guest', async () => {
    renderNotifications()
    expect(await screen.findByRole('heading', { name: '登录／注册' })).toBeInTheDocument()
    expect(screen.queryByText('口语回声发布 2.0')).not.toBeInTheDocument()
    expect(screen.getByText(/登录后可以保存比较/)).toBeInTheDocument()
  })
})
