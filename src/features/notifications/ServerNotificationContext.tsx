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
  const mutation = useRef(false)
  const identity = useRef(userId)
  identity.current = userId
  const [dataOwner, setDataOwner] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    if (!session || !import.meta.env.PROD || mutation.current) return
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const page = await serverNotificationApi.list()
      if (version !== requestVersion.current || identity.current !== userId) return
      setDataOwner(userId)
      setItems(page.items)
      setUnreadCount(page.unread_count)
      setNextCursor(page.next_cursor)
    } catch {
      if (version === requestVersion.current) setError('通知暂时无法加载，请重试。')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [session, userId])

  useEffect(() => {
    ++requestVersion.current
    mutation.current = false
    setDataOwner(undefined)
    setItems([])
    setUnreadCount(0)
    setNextCursor(null)
    setError(null)
    if (userId && import.meta.env.PROD) void refresh()
  }, [userId, refresh])

  useEffect(() => {
    if (!userId || !import.meta.env.PROD) return
    const onFocus = () => { if (document.visibilityState !== 'hidden') void refresh() }
    const timer = window.setInterval(onFocus, 30_000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [userId, refresh])

  const loadMore = useCallback(async () => {
    if (!session || !nextCursor || loading || mutation.current) return
    const version = requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const page = await serverNotificationApi.list(nextCursor)
      if (version !== requestVersion.current || identity.current !== userId) return
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((old) => old.notification_id === item.notification_id))])
      setUnreadCount(page.unread_count)
      setNextCursor(page.next_cursor)
    } catch {
      if (version === requestVersion.current) setError('更多通知暂时无法加载，请重试。')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [session, nextCursor, loading, userId])

  const saveRead = useCallback(async (id: string | null) => {
    if (!session || mutation.current) return
    mutation.current = true
    const version = ++requestVersion.current
    setLoading(false)
    try {
      const result = id === null ? await serverNotificationApi.markAllRead(session) : await serverNotificationApi.markRead(session, [id])
      if (version !== requestVersion.current || identity.current !== userId) return
      setItems(current => current.map(item => id === null || item.notification_id === id ? { ...item, read_at: item.read_at ?? result.read_at } : item))
      setUnreadCount(result.unread_count)
    } finally {
      if (identity.current === userId) mutation.current = false
    }
  }, [session, userId])
  const markRead = useCallback((id: string) => saveRead(id), [saveRead])
  const markAllRead = useCallback(() => saveRead(null), [saveRead])

  return <ServerNotificationContext.Provider value={{ items: dataOwner === userId ? items : [], unreadCount: dataOwner === userId ? unreadCount : 0, nextCursor: dataOwner === userId ? nextCursor : null, loading, error, refresh, loadMore, markRead, markAllRead }}>{children}</ServerNotificationContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useServerNotifications() {
  return useContext(ServerNotificationContext)
}
