import { Link } from 'react-router-dom'
import { PageFrame } from '../components'

export function NotFoundPage() {
  return (
    <PageFrame title="404 页面不存在" description="你访问的页面可能已移动、删除或暂时不可用。">
      <div className="empty-state">
        <strong>没有找到这个页面。</strong>
        <p>请检查地址，或返回作品广场继续浏览。</p>
        <Link className="button button--primary" to="/projects">
          返回作品广场
        </Link>
      </div>
    </PageFrame>
  )
}
