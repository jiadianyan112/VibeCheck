import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, Tag } from '../components'
import { useServerNotifications } from '../features/notifications/ServerNotificationContext'
import type { ServerNotification } from '../services/serverNotificationApi'

const labels = { submission_published: '发布审核', project_updated: '作品更新' } as const

export function ServerNotificationsPage() {
  const { items, unreadCount, nextCursor, loading, error, refresh, loadMore, markRead, markAllRead } = useServerNotifications()
  const [params, setParams] = useSearchParams()
  const [actionError, setActionError] = useState<string | null>(null)
  const navigate = useNavigate()
  const selectedType = params.get('type')
  const unreadOnly = params.get('unread') === '1'
  const filtered = items.filter((item) => (!selectedType || item.type === selectedType) && (!unreadOnly || !item.read_at))

  useEffect(() => { void refresh() }, [refresh])

  function setFilter(key: 'type' | 'unread', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  async function perform(action: () => Promise<void>) {
    setActionError(null)
    try { await action() } catch { setActionError('操作暂时未保存，请重试。') }
  }

  async function openNotification(item: ServerNotification) {
    if (!item.read_at) {
      setActionError(null)
      try { await markRead(item.notification_id) } catch { setActionError('已读状态暂时未保存，仍可查看作品。') }
    }
    if (item.target_type === 'project' && item.target_id) navigate(`/project/${encodeURIComponent(item.target_id)}`)
  }

  return <main className="page-container page-with-bottom-space stack">
    <header className="notification-header">
      <div className="stack stack--small"><h1>通知中心</h1><p>作品更新和审核结果会出现在这里。</p></div>
      <div className="stack stack--small"><strong>{unreadCount} 条未读 / {items.length} 条全部</strong><Button disabled={unreadCount === 0} onClick={() => void perform(markAllRead)}>全部标为已读</Button></div>
    </header>
    <section className="notification-filters" aria-label="通知筛选">
      <label className="field"><span className="field__label">通知分类</span><select className="input" value={selectedType ?? ''} onChange={(event) => setFilter('type', event.target.value)}><option value="">全部通知</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="choice-card"><input type="checkbox" checked={unreadOnly} onChange={(event) => setFilter('unread', event.target.checked ? '1' : '')} /><span>只看未读</span></label>
      <strong aria-live="polite">{filtered.length} 条符合条件</strong>
    </section>
    {error || actionError ? <aside className="feedback feedback--error" role="alert"><p>{error ?? actionError}</p>{error ? <Button onClick={() => void refresh()}>重新读取</Button> : null}</aside> : null}
    {filtered.length ? <ol className="notification-list">{filtered.map((item) => <li className={`notification-item ${item.read_at ? '' : 'notification-item--unread'}`} key={item.notification_id}>
      <div className="notification-item__body stack stack--small"><div className="cluster"><Tag tone={item.read_at ? 'dashed' : 'strong'}>{labels[item.type] ?? '通知'}</Tag><span>{item.read_at ? '已读' : '未读'}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('zh-CN')}</time></div><h2>{item.title}</h2><p>{item.body_summary}</p></div>
      <div className="notification-item__actions"><Button variant="primary" onClick={() => void openNotification(item)}>查看并定位</Button>{item.read_at ? null : <Button variant="quiet" onClick={() => void perform(() => markRead(item.notification_id))}>标为已读</Button>}</div>
    </li>)}</ol> : loading ? <p role="status">正在读取通知…</p> : <EmptyState title={items.length ? '没有符合筛选的通知' : '还没有通知'} description={items.length ? '调整分类或取消“只看未读”后再查看。' : '提交审核后，审核结果会出现在这里。'} action={items.length ? <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>清除筛选</Button> : <Button onClick={() => navigate('/projects')}>浏览作品广场</Button>} />}
    {nextCursor ? <Button disabled={loading} onClick={() => void loadMore()}>{loading ? '正在加载…' : '加载更多'}</Button> : null}
  </main>
}
