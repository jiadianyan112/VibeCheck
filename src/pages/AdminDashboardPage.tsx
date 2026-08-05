import { Link } from 'react-router-dom'
import { Tag } from '../components'
import {
  buildAdminProjectQueue,
  mergeAdminProjects,
  summarizeAdminProjectQueue,
} from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'

export function AdminDashboardPage() {
  const { state } = useAppState()
  const rows = buildAdminProjectQueue(mergeAdminProjects(projects, state.projectOverrides))
  const summary = summarizeAdminProjectQueue(rows)

  return (
    <div className="admin-page stack">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">A01 · Prototype operations</p>
          <h1>后台首页／数据看板</h1>
          <p>这里显示固定模拟数据的队列数量和当前待办，不代表真实流量、市场规模或业务结论。</p>
        </div>
        <Tag tone="dashed">模拟数据 · {state.session.user?.displayName}</Tag>
      </header>

      <section className="admin-metric-grid" aria-label="模拟队列数量">
        <article><span>同源作品档案</span><strong>{summary.total}</strong><Link to="/admin/projects">查看全部</Link></article>
        <article><span>待审核更新</span><strong>{summary.pendingReview}</strong><Link to="/admin/projects?pending=1">进入队列</Link></article>
        <article><span>访问状态异常</span><strong>{summary.activeExceptions}</strong><Link to="/admin/projects?exception=1">进入队列</Link></article>
        <article><span>资料待补全</span><strong>{summary.incomplete}</strong><Link to="/admin/projects?completeness=partial">查看部分完整</Link></article>
      </section>

      <section className="admin-todo-panel stack">
        <div className="cluster cluster--between"><div><p className="eyebrow">Work queue</p><h2>运营待办</h2></div><span>仅展示模拟数量</span></div>
        <ul className="admin-todo-list">
          <li><div><strong>审核待处理作品更新</strong><p>进入发布审核执行通过、退回、拒绝或争议操作，所有动作必须填写原因。</p></div><Link className="button" to="/admin/reviews">进入发布审核</Link></li>
          <li><div><strong>复核访问状态异常</strong><p>异常信号来自作品当前访问状态，不自动得出作品结束结论。</p></div><Link className="button" to="/admin/projects?exception=1">查看 {summary.activeExceptions} 项</Link></li>
          <li><div><strong>关注作者关联状态</strong><p>待审核或争议归属需要人工核对，不公开身份材料。</p></div><Link className="button" to="/admin/projects?author=pending">查看 {summary.authorAttention} 项</Link></li>
        </ul>
      </section>
    </div>
  )
}
