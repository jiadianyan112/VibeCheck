import { Link, useLocation, useParams } from 'react-router-dom'
import type { RouteCatalogItem } from '../app/routeCatalog'
import { PageFrame } from '../components'

interface RoutePlaceholderPageProps {
  route: RouteCatalogItem
}

export function RoutePlaceholderPage({ route }: RoutePlaceholderPageProps) {
  const params = useParams()
  const location = useLocation()
  const entries = Object.entries(params)

  return (
    <PageFrame
      title={`${route.id} ${route.name}`}
      description={`路由骨架：${route.path}`}
    >
      <div className="placeholder-layout">
        <section className="wire-panel stack" aria-labelledby="route-status">
          <div className="section-heading">
            <p className="eyebrow">{route.area === 'admin' ? 'Admin' : 'Frontstage'}</p>
            <h2 id="route-status">待实现模块</h2>
          </div>
          <ul className="placeholder-list">
            {route.pendingModules.map((module) => (
              <li key={module}>{module}</li>
            ))}
          </ul>
        </section>
        <aside className="wire-panel stack" aria-labelledby="route-context">
          <h2 id="route-context">路由上下文</h2>
          <dl className="definition-list">
            <div>
              <dt>当前地址</dt>
              <dd>{location.pathname}</dd>
            </div>
            {entries.length > 0 ? (
              entries.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))
            ) : (
              <div>
                <dt>路由参数</dt>
                <dd>无</dd>
              </div>
            )}
          </dl>
          <Link className="button button--secondary" to="/projects">
            返回作品广场
          </Link>
        </aside>
      </div>
    </PageFrame>
  )
}
