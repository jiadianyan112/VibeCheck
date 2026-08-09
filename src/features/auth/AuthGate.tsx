import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren, type ReactNode } from 'react'
import { prototypeUsers } from '../../mocks'
import { useAppState, type PendingAction } from '../../state'
import type { PrototypeUser } from '../../types'
import { Button, Modal, useToast } from '../../components'
import { createLoginAction, roleLabels } from './session'

interface AuthGateContextValue {
  requireLogin: (action: PendingAction, onAuthorized?: () => void) => void
  closeLogin: () => void
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null)

export function AuthModal({ open, onClose, onLogin, comparisonCount = 0 }: { open: boolean; onClose: () => void; onLogin: (user: PrototypeUser) => void; comparisonCount?: number }) {
  return (
    <Modal open={open} title="登录后继续刚才的操作" onClose={onClose}>
      <p>登录后可以保存这次操作，并继续使用收藏、关注和发布功能。</p>
      {comparisonCount ? <p className="boundary-note" role="note">登录后将保存当前 {comparisonCount} 个比较作品，不会自动合并账号中的历史比较。</p> : null}
      <div className="auth-choice-list">
        {prototypeUsers.map((user) => <Button key={user.id} onClick={() => onLogin(user)}>{user.displayName} · {roleLabels[user.role]}</Button>)}
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
    dispatch(createLoginAction(user))
    dispatch({ type: 'PENDING_ACTION_REPLAY' })
    setOpen(false)
    pushToast('登录成功，已恢复刚才的操作。', 'success')
  }, [dispatch, pushToast])

  const closeLogin = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ requireLogin, closeLogin }), [closeLogin, requireLogin])
  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <AuthModal open={open} onClose={closeLogin} onLogin={handleLogin} comparisonCount={state.comparisonProjectIds.length} />
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
