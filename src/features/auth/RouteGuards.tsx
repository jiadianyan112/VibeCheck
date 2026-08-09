import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { PageFrame } from '../../components/PageFrame'
import { useAppState } from '../../state'
import { isStaffRole } from './session'

function loginPath(from: string) {
  return `/auth?from=${encodeURIComponent(from)}`
}

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const { state } = useAppState()
  const location = useLocation()
  if (!state.session.user) {
    return <Navigate to={loginPath(`${location.pathname}${location.search}${location.hash}`)} replace />
  }
  return <>{children}</>
}

export function StaffRoute({ children }: { children: ReactNode }) {
  const { state } = useAppState()
  const location = useLocation()
  if (!state.session.user) {
    return <Navigate to={loginPath(`${location.pathname}${location.search}${location.hash}`)} replace />
  }
  if (!isStaffRole(state.session.role)) {
    return (
      <PageFrame title="无后台访问权限" description="管理后台只向平台编辑和管理员开放。">
        <section className="wire-panel stack">
          <p>当前身份：{state.session.user.displayName}。你仍可使用前台浏览、比较和发布功能。</p>
          <div className="cluster">
            <Link className="button button--primary" to="/auth?from=%2Fadmin">切换账号</Link>
            <Link className="button button--secondary" to="/projects">返回作品广场</Link>
          </div>
        </section>
      </PageFrame>
    )
  }
  return <>{children}</>
}
