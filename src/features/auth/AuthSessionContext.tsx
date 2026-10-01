import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import {
  AuthApiError,
  getAuthSession,
  revokeAuthSession,
  type AuthSessionDto,
} from '../../services/authService'
import { useAppState } from '../../state'
import { userId } from '../../types'

type AuthStatus = 'loading' | 'guest' | 'authenticated' | 'unavailable'

interface AuthSessionContextValue {
  readonly status: AuthStatus
  readonly session: AuthSessionDto | null
  readonly acceptSession: (session: AuthSessionDto) => void
  readonly signOut: () => Promise<void>
  readonly refresh: () => Promise<void>
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

function runtimeEnabled(): boolean {
  return import.meta.env.MODE !== 'test' && import.meta.env.VITE_AUTH_ENABLED !== 'false'
}

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const { dispatch } = useAppState()
  const [session, setSession] = useState<AuthSessionDto | null>(null)
  const [status, setStatus] = useState<AuthStatus>(runtimeEnabled() ? 'loading' : 'guest')

  const acceptSession = useCallback((nextSession: AuthSessionDto) => {
    setSession(nextSession)
    setStatus('authenticated')
    dispatch({
      type: 'SESSION_SYNCED',
      user: {
        id: userId(nextSession.user_id),
        displayName: nextSession.display_name,
        role: nextSession.primary_role,
        creatorId: null,
      },
    })
  }, [dispatch])

  const refresh = useCallback(async () => {
    if (!runtimeEnabled()) return
    setStatus('loading')
    try {
      acceptSession(await getAuthSession())
    } catch (error) {
      setSession(null)
      if (error instanceof AuthApiError && error.status === 401) {
        setStatus('guest')
        dispatch({ type: 'LOGOUT' })
      } else {
        setStatus('unavailable')
      }
    }
  }, [acceptSession, dispatch])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    if (session) await revokeAuthSession(session)
    setSession(null)
    setStatus('guest')
    dispatch({ type: 'LOGOUT' })
  }, [dispatch, session])

  const value = useMemo(
    () => ({ status, session, acceptSession, signOut, refresh }),
    [acceptSession, refresh, session, signOut, status],
  )
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext)
  if (!context) throw new Error('useAuthSession must be used inside AuthSessionProvider')
  return context
}

export function useOptionalAuthSession(): AuthSessionContextValue | null {
  return useContext(AuthSessionContext)
}
