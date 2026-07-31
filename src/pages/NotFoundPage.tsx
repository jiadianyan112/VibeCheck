import { Link, useLocation } from 'react-router-dom'
import { PageFrame } from '../components'

export function NotFoundPage() {
  const location = useLocation()

  return (
    <PageFrame title="404 页面不存在" description={`未找到：${location.pathname}`}>
      <div className="empty-state">
        <strong>这个原型入口不存在或尚未接入。</strong>
        <p>返回作品广场继续浏览任务书规定的页面。</p>
        <Link className="button button--primary" to="/projects">
          返回作品广场
        </Link>
      </div>
    </PageFrame>
  )
}
