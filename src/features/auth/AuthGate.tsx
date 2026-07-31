import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren, type ReactNode } from 'react'
import { prototypeUsers } from '../../mocks'
import { useAppState, type PendingAction } from '../../state'
import type { PrototypeUser } from '../../types'
import { Button, Modal, useToast } from '../../components'

interface AuthGateContextValue {
  requireLogin: (action: PendingAction, onAuthorized?: () => void) => void
  closeLogin: () => void
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null)

export function AuthModal({ open, onClose, onLogin }: { open: boolean; onClose: () => void; onLogin: (user: PrototypeUser) => void }) {
  return (
    <Modal open={open} title="登录后继续刚才的操作" onClose={onClose}>
      <p>低保真原型不收集密码。请选择一个固定测试身份：</p>
      <div className="auth-choice-list">
        {prototypeUsers.map((user) => <Button key={user.id} onClick={() => onLogin(user)}>{user.displayName} · {user.role}</Button>)}
      </div>
    </Modal>
  )
}

export function AuthGateProvider({ children }: PropsWithChildren) {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [open, setOpen] = useState(false)

  const requireLogin = useCallback((action: PendingAction, onAuthorized?: () => void) => {
    if (state.session.user) {
      onAuthorized?.()
      return
    }
    dispatch({ type: 'PENDING_ACTION_QUEUE', action })
    setOpen(true)
  }, [dispatch, state.session.user])

  const handleLogin = useCallback((user: PrototypeUser) => {
    dispatch({ type: 'LOGIN_COMPLETED', user })
    dispatch({ type: 'PENDING_ACTION_REPLAY' })
    setOpen(false)
    pushToast('登录成功，已恢复刚才的操作。', 'success')
  }, [dispatch, pushToast])

  const closeLogin = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ requireLogin, closeLogin }), [closeLogin, requireLogin])
  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <AuthModal open={open} onClose={closeLogin} onLogin={handleLogin} />
    </AuthGateContext.Provider>
  )
}

export function useAuthGate() {
  const context = useContext(AuthGateContext)
  if (!context) throw new Error('useAuthGate must be used inside AuthGateProvider')
  return context
}

export function LoginGate({ action, onAuthorized, children }: { action: PendingAction; onAuthorized: () => void; children: (run: () => void) => ReactNode }) {
  const { requireLogin } = useAuthGate()
  return <>{children(() => requireLogin(action, onAuthorized))}</>
}
