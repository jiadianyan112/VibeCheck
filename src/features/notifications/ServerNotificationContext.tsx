import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { useAuthSession } from '../auth/AuthSessionContext'
import { serverNotificationApi, type ServerNotification } from '../../services/serverNotificationApi'

interface ServerNotificationContextValue {
  items: readonly ServerNotification[]
  unreadCount: number
  nextCursor: string | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const unavailable = async () => {}
const defaultValue: ServerNotificationContextValue = {
  items: [], unreadCount: 0, nextCursor: null, loading: false, error: null,
  refresh: unavailable, loadMore: unavailable, markRead: unavailable, markAllRead: unavailable,
}
const ServerNotificationContext = createContext(defaultValue)

export function ServerNotificationProvider({ children }: PropsWithChildren) {
  const { session } = useAuthSession()
  const userId = session?.user_id
  const [items, setItems] = useState<readonly ServerNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    if (!session || !import.meta.env.PROD) return
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const page = await serverNotificationApi.list()
      if (version !== requestVersion.current) return
      setItems(page.items)
      setUnreadCount(page.unread_count)
      setNextCursor(page.next_cursor)
    } catch {
      if (version === requestVersion.current) setError('通知暂时无法加载，请重试。')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [session])

  useEffect(() => {
    ++requestVersion.current
    setItems([])
    setUnreadCount(0)
    setNextCursor(null)
    setError(null)
    if (userId && import.meta.env.PROD) void refresh()
  }, [userId, refresh])

  useEffect(() => {
    if (!userId || !import.meta.env.PROD) return
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [userId, refresh])

  const loadMore = useCallback(async () => {
    if (!session || !nextCursor || loading) return
    const version = requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const page = await serverNotificationApi.list(nextCursor)
      if (version !== requestVersion.current) return
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((old) => old.notification_id === item.notification_id))])
      setUnreadCount(page.unread_count)
      setNextCursor(page.next_cursor)
    } catch {
      if (version === requestVersion.current) setError('更多通知暂时无法加载，请重试。')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [session, nextCursor, loading])

  const markRead = useCallback(async (id: string) => {
    if (!session) return
    const version = requestVersion.current
    const result = await serverNotificationApi.markRead(session, [id])
    if (version !== requestVersion.current) return
    setItems((current) => current.map((item) => item.notification_id === id ? { ...item, read_at: item.read_at ?? result.read_at } : item))
    setUnreadCount(result.unread_count)
  }, [session])

  const markAllRead = useCallback(async () => {
    if (!session) return
    const version = requestVersion.current
    const result = await serverNotificationApi.markAllRead(session)
    if (version !== requestVersion.current) return
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? result.read_at })))
    setUnreadCount(result.unread_count)
  }, [session])

  return <ServerNotificationContext.Provider value={{ items, unreadCount, nextCursor, loading, error, refresh, loadMore, markRead, markAllRead }}>{children}</ServerNotificationContext.Provider>
}

export function useServerNotifications() {
  return useContext(ServerNotificationContext)
}
