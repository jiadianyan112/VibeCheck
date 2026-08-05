import { Link, NavLink, Outlet } from 'react-router-dom'
import { ScenarioPanel } from './ScenarioPanel'

const adminNavigation = [
  { to: '/admin', label: '后台首页', end: true },
  { to: '/admin/projects', label: '作品列表' },
  { to: '/admin/duplicates', label: '重复与合并' },
  { to: '/admin/reviews', label: '发布审核' },
  { to: '/admin/author-verification', label: '作者身份审核' },
  { to: '/admin/evidence', label: '证据管理' },
  { to: '/admin/status-monitor', label: '状态监测' },
]

export function AdminLayout() {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="stack stack--small">
          <Link className="wordmark" to="/admin">
            VibeCheck 管理
          </Link>
          <Link className="admin-back-link" to="/projects">
            ← 返回前台
          </Link>
        </div>
        <nav className="admin-navigation" aria-label="后台导航">
          {adminNavigation.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                isActive ? 'admin-nav-link admin-nav-link--active' : 'admin-nav-link'
              }
              end={item.end}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
      {import.meta.env.DEV ? <ScenarioPanel /> : null}
    </div>
  )
}
