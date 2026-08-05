import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, Tag } from '../components'
import { notificationTargetAccess, notificationTypeLabels } from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'
import type { NotificationType, Project } from '../types'

export function NotificationsPage() {
  const { state, dispatch } = useAppState()
  const user = state.session.user
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [blockedTarget, setBlockedTarget] = useState<{ id: string; reason: string } | null>(null)
  const allProjectIds = useMemo(() => new Set<Project['id']>([...projects.map((project) => project.id), ...state.projectOverrides.map((project) => project.id)]), [state.projectOverrides])
  const ownNotifications = useMemo(() => user ? state.notifications.filter((notification) => notification.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [], [state.notifications, user])
  const selectedType = params.get('type') as NotificationType | null
  const unreadOnly = params.get('unread') === '1'
  const filtered = ownNotifications.filter((notification) => (!selectedType || notification.type === selectedType) && (!unreadOnly || !notification.isRead))
  const unreadCount = ownNotifications.filter((notification) => !notification.isRead).length

  if (!user) return null

  function setFilter(key: 'type' | 'unread', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  function openNotification(notification: (typeof ownNotifications)[number]) {
    dispatch({ type: 'NOTIFICATION_MARK_READ', notificationId: notification.id })
    const access = notificationTargetAccess(notification, user!, allProjectIds)
    if (!access.allowed) {
      setBlockedTarget({ id: notification.id, reason: access.reason ?? '当前目标不可访问。' })
      return
    }
    setBlockedTarget(null)
    navigate(notification.targetPath)
  }

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="notification-header"><div className="stack stack--small"><p className="eyebrow">High-value notifications</p><h1>通知中心</h1><p>只保留作品更新、评论回复、审核结果和状态异常；不包含泛营销消息。</p></div><div className="stack stack--small"><strong>{unreadCount} 条未读 / {ownNotifications.length} 条全部</strong><Button disabled={unreadCount === 0} onClick={() => dispatch({ type: 'NOTIFICATIONS_MARK_ALL_READ', userId: user.id })}>全部标为已读</Button></div></header>

      <section className="notification-filters" aria-label="通知筛选">
        <label className="field"><span className="field__label">通知分类</span><select className="input" value={selectedType ?? ''} onChange={(event) => setFilter('type', event.target.value)}><option value="">全部高价值通知</option>{Object.entries(notificationTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="choice-card"><input type="checkbox" checked={unreadOnly} onChange={(event) => setFilter('unread', event.target.checked ? '1' : '')} /><span>只看未读</span></label>
        <strong aria-live="polite">{filtered.length} 条符合条件</strong>
      </section>

      {blockedTarget ? <aside className="feedback feedback--error" role="alert"><strong>无法打开通知目标</strong><p>{blockedTarget.reason}</p><p>通知已标为已读，但仍保留在列表中；可切换合适测试身份后重试。</p></aside> : null}

      {filtered.length ? <ol className="notification-list">{filtered.map((notification) => (
        <li className={`notification-item ${notification.isRead ? '' : 'notification-item--unread'}`} key={notification.id}>
          <div className="notification-item__body stack stack--small"><div className="cluster"><Tag tone={notification.isRead ? 'dashed' : 'strong'}>{notificationTypeLabels[notification.type]}</Tag><span>{notification.isRead ? '已读' : '未读'}</span><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString('zh-CN')}</time></div><h2>{notification.title}</h2><p>{notification.body}</p><code>{notification.targetPath}</code>{blockedTarget?.id === notification.id ? <span className="field-error">{blockedTarget.reason}</span> : null}</div>
          <div className="notification-item__actions"><Button variant="primary" onClick={() => openNotification(notification)}>查看并定位</Button>{notification.isRead ? null : <Button variant="quiet" onClick={() => dispatch({ type: 'NOTIFICATION_MARK_READ', notificationId: notification.id })}>标为已读</Button>}</div>
        </li>
      ))}</ol> : <EmptyState title={ownNotifications.length ? '没有符合筛选的通知' : '还没有高价值通知'} description={ownNotifications.length ? '调整分类或取消“只看未读”后再查看。' : '关注作品或提交审核后，相关回访会出现在这里。'} action={ownNotifications.length ? <Button onClick={() => { const next = new URLSearchParams(); setParams(next, { replace: true }) }}>清除筛选</Button> : <Button onClick={() => navigate('/activity')}>查看最新动态</Button>} />}
    </main>
  )
}
