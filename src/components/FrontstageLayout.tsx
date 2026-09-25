import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ComparisonProvider, FloatingCompareBar } from '../features'
import { isStaffRole } from '../features/auth/session'
import { useAppState } from '../state'
import { RouteScrollManager } from './RouteScrollManager'
import { ScenarioPanel } from './ScenarioPanel'
import { SiteFooter } from './SiteFooter'
import { UnifiedSearchForm } from './UnifiedSearchForm'
import { BrandMark } from './brand'

const primaryNavigation = [
  { to: '/projects', label: '作品广场' },
  { to: '/categories', label: '分类' },
  { to: '/activity', label: '最新动态' },
  { to: '/about', label: '关于' },
]

function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    '作品广场': 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    '分类': 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    '最新动态': 'M3 12h4l3-8 4 16 3-8h4',
    '关于': 'M12 11v6M12 7v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    '比较': 'M4 5h6v14H4ZM14 5h6v14h-6Z',
    '发布': 'M12 5v14M5 12h14',
    '通知': 'M6 9a6 6 0 0 1 12 0v7l2 2H4l2-2ZM10 21h4',
  }
  return <svg className="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0'} /></svg>
}

function navClassName({ isActive }: { isActive: boolean }) {
  return isActive ? 'nav-link nav-link--active' : 'nav-link'
}

function restrictedPath(path: string, isLoggedIn: boolean, returnTo: string) {
  return isLoggedIn ? path : `/auth?return_to=${encodeURIComponent(returnTo)}`
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
    ? `/compare/${state.activeComparisonSessionId}${state.comparisonProjectIds.length >= 2 ? '#structured-comparison-heading' : ''}`
    : '/projects'
  const headerQuery = new URLSearchParams(location.search).get(location.pathname.startsWith('/discover') ? 'idea' : 'q') ?? ''
  const isFocusedFlow = location.pathname.startsWith('/compare/')
    || location.pathname.startsWith('/submit')
    || location.pathname === '/auth'
    || location.pathname.endsWith('/verify-author')
    || location.pathname.endsWith('/update')
  const hasCompareBar = !isFocusedFlow && state.comparisonProjectIds.length > 0
  const isAuthPage = location.pathname === '/auth'

  return (
    <div className={`app-shell${!isAuthPage ? ' app-shell--browse' : ''}${hasCompareBar ? ' app-shell--has-compare-bar' : ''}`}>
      <RouteScrollManager />
      {!isAuthPage ? <header className="global-header">
        <div className="global-header__inner">
          <Link className="wordmark" to="/projects" aria-label="VibeCheck 作品广场">
            <BrandMark />
          </Link>
          <nav className="desktop-navigation" aria-label="主导航">
            {primaryNavigation.map((item) => (
              <NavLink key={item.to} className={navClassName} to={item.to}>
                <NavigationIcon name={item.label} /><span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <UnifiedSearchForm
            key={`${location.pathname}:${headerQuery}`}
            id="global-search-input"
            className="global-search"
            inputClassName="global-search__input"
            submitClassName="global-search__submit"
            defaultValue={headerQuery}
          />
          <div className="header-actions" aria-label="账户与创作入口">
            {state.session.user?.creatorId ? (
              <Link className="header-action" to={`/creator/${state.session.user.creatorId}`}>作者主页</Link>
            ) : null}
            {isStaffRole(state.session.role) ? (
              <Link className="header-action" to="/admin">管理后台</Link>
            ) : null}
            <Link className="header-action" to={comparisonPath}>
              <NavigationIcon name="比较" />比较 <span className="navigation-count" aria-label={`${state.comparisonProjectIds.length} 个作品`}>{state.comparisonProjectIds.length}</span>
            </Link>
            <Link
              className="header-action header-action--strong"
              to={'/submit'}
            >
              <NavigationIcon name="发布" />发布
            </Link>
            <Link
              className="header-action"
              to={restrictedPath('/notifications', isLoggedIn, '/notifications')}
            >
              <NavigationIcon name="通知" />通知{unreadCount > 0 ? ` ${unreadCount}` : ''}
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
              <Link className="nav-link" to="/search">搜索作品或想法</Link>
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
                to={'/submit'}
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
      </header> : null}
      <div className={`app-shell__content${location.pathname !== '/projects' ? ' ui-root' : ''}`}>
        <Outlet />
      </div>
      {!isAuthPage ? <SiteFooter
        submitPath={'/submit'}
        compact={isFocusedFlow}
      /> : null}
      {hasCompareBar ? <FloatingCompareBar /> : null}
      {import.meta.env.DEV ? <ScenarioPanel /> : null}
    </div>
  )
}

export function FrontstageLayout() {
  return <ComparisonProvider><FrontstageContent /></ComparisonProvider>
}
