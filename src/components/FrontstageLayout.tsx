import { Form, Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ComparisonProvider, FloatingCompareBar } from '../features'
import { isStaffRole } from '../features/auth/session'
import { useAppState } from '../state'
import { RouteScrollManager } from './RouteScrollManager'
import { ScenarioPanel } from './ScenarioPanel'

const primaryNavigation = [
  { to: '/projects', label: '作品广场' },
  { to: '/categories', label: '分类' },
  { to: '/activity', label: '最新动态' },
  { to: '/discover', label: '查同类' },
  { to: '/about', label: '关于' },
]

function navClassName({ isActive }: { isActive: boolean }) {
  return isActive ? 'nav-link nav-link--active' : 'nav-link'
}

function restrictedPath(path: string, isLoggedIn: boolean, from: string) {
  return isLoggedIn ? path : `/auth?from=${encodeURIComponent(from)}`
}

function FrontstageContent() {
  const { state } = useAppState()
  const location = useLocation()
  const isLoggedIn = state.session.role !== 'guest'
  const unreadCount = isLoggedIn
    ? state.notifications.filter(
        (notification) =>
          !notification.isRead &&
          notification.userId === state.session.user?.id,
      ).length
    : 0
  const from = `${location.pathname}${location.search}${location.hash}`
  const comparisonPath = state.activeComparisonSessionId
    ? `/compare/${state.activeComparisonSessionId}`
    : '/projects'

  return (
    <div className="app-shell">
      <RouteScrollManager />
      <header className="global-header">
        <div className="global-header__inner">
          <Link className="wordmark" to="/projects" aria-label="VibeCheck 作品广场">
            VibeCheck
          </Link>
          <nav className="desktop-navigation" aria-label="主导航">
            {primaryNavigation.map((item) => (
              <NavLink key={item.to} className={navClassName} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Form className="global-search" action="/search" role="search">
            <label className="sr-only" htmlFor="global-search-input">
              搜索作品或输入完整想法
            </label>
            <input
              className="global-search__input"
              id="global-search-input"
              name="q"
              placeholder="搜索作品或想法"
            />
            <button className="global-search__submit" type="submit">
              搜索
            </button>
          </Form>
          <div className="header-actions" aria-label="账户与创作入口">
            {state.session.user?.creatorId ? (
              <Link className="header-action" to={`/creator/${state.session.user.creatorId}`}>作者主页</Link>
            ) : null}
            {isStaffRole(state.session.role) ? (
              <Link className="header-action" to="/admin">管理后台</Link>
            ) : null}
            <Link className="header-action" to={comparisonPath}>
              比较 <span aria-label={`${state.comparisonProjectIds.length} 个作品`}>{state.comparisonProjectIds.length}</span>
            </Link>
            <Link
              className="header-action header-action--strong"
              to={restrictedPath('/submit', isLoggedIn, '/submit')}
            >
              发布
            </Link>
            <Link
              className="header-action"
              to={restrictedPath('/notifications', isLoggedIn, '/notifications')}
            >
              通知{unreadCount > 0 ? ` ${unreadCount}` : ''}
            </Link>
            <Link
              className="avatar-link"
              to={restrictedPath('/me', isLoggedIn, '/me')}
              aria-label={isLoggedIn ? `${state.session.user?.displayName}的个人中心` : '登录或注册'}
            >
              {isLoggedIn ? state.session.user?.displayName.slice(0, 1) : '登录'}
            </Link>
          </div>
          <details className="mobile-navigation">
            <summary>菜单</summary>
            <nav aria-label="移动导航">
              {primaryNavigation.map((item) => (
                <NavLink key={item.to} className={navClassName} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
              <Link className="nav-link" to={comparisonPath}>
                当前比较（{state.comparisonProjectIds.length}）
              </Link>
              <Link
                className="nav-link"
                to={restrictedPath('/submit', isLoggedIn, '/submit')}
              >
                发布作品
              </Link>
              <Link
                className="nav-link"
                to={restrictedPath('/me', isLoggedIn, from)}
              >
                {isLoggedIn ? '个人中心' : '登录／注册'}
              </Link>
              {state.session.user?.creatorId ? (
                <Link className="nav-link" to={`/creator/${state.session.user.creatorId}`}>作者主页</Link>
              ) : null}
              {isStaffRole(state.session.role) ? (
                <Link className="nav-link" to="/admin">管理后台</Link>
              ) : null}
            </nav>
          </details>
        </div>
      </header>
      <div className="app-shell__content">
        <Outlet />
      </div>
      {location.pathname.startsWith('/compare/') ? null : <FloatingCompareBar />}
      {import.meta.env.DEV ? <ScenarioPanel /> : null}
    </div>
  )
}

export function FrontstageLayout() {
  return <ComparisonProvider><FrontstageContent /></ComparisonProvider>
}
