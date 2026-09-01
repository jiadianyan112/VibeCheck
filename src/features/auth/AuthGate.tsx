import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'

import { Button, Modal } from '../../components'
import { useAppState, type PendingAction } from '../../state'

interface AuthGateContextValue {
  requireLogin: (action: PendingAction, onAuthorized?: () => void) => void
  closeLogin: () => void
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null)

export function AuthModal({
  open,
  onClose,
  comparisonCount = 0,
  returnTo = '/projects',
}: {
  open: boolean
  onClose: () => void
  comparisonCount?: number
  returnTo?: string
}) {
  return (
    <Modal open={open} title="登录后继续刚才的操作" onClose={onClose}>
      <p>我们会向你的邮箱发送 6 位验证码。验证成功后返回原页面。</p>
      {comparisonCount ? (
        <p className="boundary-note" role="note">
          当前 {comparisonCount} 个临时比较作品会保留；账号比较合并由后续数据接口工作包完成。
        </p>
      ) : null}
      <div className="cluster">
        <Link
          className="button button--primary"
          to={`/auth?return_to=${encodeURIComponent(returnTo)}`}
          onClick={onClose}
        >
          使用邮箱验证码登录
        </Link>
        <Button variant="secondary" onClick={onClose}>暂不登录</Button>
      </div>
    </Modal>
  )
}

export function AuthGateProvider({ children }: PropsWithChildren) {
  const { state, dispatch } = useAppState()
  const [open, setOpen] = useState(false)

  const requireLogin = useCallback((action: PendingAction, onAuthorized?: () => void) => {
    if (state.session.user) {
      onAuthorized?.()
      return
    }
    dispatch({ type: 'PENDING_ACTION_QUEUE', action })
    setOpen(true)
  }, [dispatch, state.session.user])

  const closeLogin = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (state.session.user) setOpen(false)
  }, [state.session.user])
  const value = useMemo(() => ({ requireLogin, closeLogin }), [closeLogin, requireLogin])
  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <AuthModal
        open={open}
        onClose={closeLogin}
        comparisonCount={state.comparisonProjectIds.length}
        returnTo={state.pendingAction?.sourcePath ?? '/projects'}
      />
    </AuthGateContext.Provider>
  )
}

export function useAuthGate() {
  const context = useContext(AuthGateContext)
  if (!context) throw new Error('useAuthGate must be used inside AuthGateProvider')
  return context
}

export function LoginGate({
  action,
  onAuthorized,
  children,
}: {
  action: PendingAction
  onAuthorized: () => void
  children: (run: () => void) => ReactNode
}) {
  const { requireLogin } = useAuthGate()
  return <>{children(() => requireLogin(action, onAuthorized))}</>
}
