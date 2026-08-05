import { Link, useSearchParams } from 'react-router-dom'
import { AccessStatusBadge, Button, CompletenessLabel, EmptyState, Tag } from '../components'
import {
  authorLinkStatusLabels,
  buildAdminProjectQueue,
  emptyAdminProjectFilters,
  filterAdminProjectQueue,
  mergeAdminProjects,
  reviewStatusLabels,
  type AdminProjectFilters,
} from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'
import {
  accessStatuses,
  authorLinkStatuses,
  completenessLevels,
  reviewStatuses,
  useScenarios,
} from '../types'
import { accessStatusText, scenarioLabels } from '../utils'

const completenessFilterLabels = {
  complete: '资料完整', partial: '部分完整', limited: '资料有限', pending_verification: '等待核验', disputed: '资料争议',
} as const

function filtersFromParams(params: URLSearchParams): AdminProjectFilters {
  return {
    ...emptyAdminProjectFilters,
    query: params.get('q') ?? '',
    category: (params.get('category') ?? '') as AdminProjectFilters['category'],
    reviewStatus: (params.get('review') ?? '') as AdminProjectFilters['reviewStatus'],
    accessStatus: (params.get('access') ?? '') as AdminProjectFilters['accessStatus'],
    completeness: (params.get('completeness') ?? '') as AdminProjectFilters['completeness'],
    authorLinkStatus: (params.get('author') ?? '') as AdminProjectFilters['authorLinkStatus'],
    pendingOnly: params.get('pending') === '1',
    exceptionOnly: params.get('exception') === '1',
  }
}

export function AdminProjectsPage() {
  const { state } = useAppState()
  const [params, setParams] = useSearchParams()
  const filters = filtersFromParams(params)
  const rows = buildAdminProjectQueue(mergeAdminProjects(projects, state.projectOverrides))
  const filtered = filterAdminProjectQueue(rows, filters)

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div className="admin-page stack">
      <header className="admin-page-header">
        <div><p className="eyebrow">A02 · Project work queue</p><h1>作品列表</h1><p>列表与前台作品档案和本地保存的作品覆盖记录同源；筛选条件保存在地址栏中，可复现和分享。</p></div>
        <Tag>{filtered.length} / {rows.length} 项</Tag>
      </header>

      <section className="admin-filter-panel stack" aria-label="作品工作队列筛选">
        <div className="admin-filter-grid">
          <label className="field"><span className="field__label">搜索作品</span><input className="input" type="search" value={filters.query} onChange={(event) => setFilter('q', event.target.value)} placeholder="名称、定义、ID 或地址" /></label>
          <label className="field"><span className="field__label">品类</span><select className="input" value={filters.category} onChange={(event) => setFilter('category', event.target.value)}><option value="">全部品类</option>{useScenarios.map((value) => <option key={value} value={value}>{scenarioLabels[value]}</option>)}</select></label>
          <label className="field"><span className="field__label">发布状态</span><select className="input" value={filters.reviewStatus} onChange={(event) => setFilter('review', event.target.value)}><option value="">全部发布状态</option>{reviewStatuses.map((value) => <option key={value} value={value}>{reviewStatusLabels[value]}</option>)}</select></label>
          <label className="field"><span className="field__label">访问状态</span><select className="input" value={filters.accessStatus} onChange={(event) => setFilter('access', event.target.value)}><option value="">全部访问状态</option>{accessStatuses.map((value) => <option key={value} value={value}>{accessStatusText[value]}</option>)}</select></label>
          <label className="field"><span className="field__label">完整度</span><select className="input" value={filters.completeness} onChange={(event) => setFilter('completeness', event.target.value)}><option value="">全部完整度</option>{completenessLevels.map((value) => <option key={value} value={value}>{completenessFilterLabels[value]}</option>)}</select></label>
          <label className="field"><span className="field__label">作者关联</span><select className="input" value={filters.authorLinkStatus} onChange={(event) => setFilter('author', event.target.value)}><option value="">全部关联状态</option>{authorLinkStatuses.map((value) => <option key={value} value={value}>{authorLinkStatusLabels[value]}</option>)}</select></label>
        </div>
        <div className="cluster cluster--between">
          <div className="cluster"><label className="choice-card"><input type="checkbox" checked={filters.pendingOnly} onChange={(event) => setFilter('pending', event.target.checked ? '1' : '')} /><span>只看待审核</span></label><label className="choice-card"><input type="checkbox" checked={filters.exceptionOnly} onChange={(event) => setFilter('exception', event.target.checked ? '1' : '')} /><span>只看异常</span></label></div>
          <Button variant="quiet" onClick={() => setParams(new URLSearchParams(), { replace: true })}>清空筛选</Button>
        </div>
      </section>

      <p className="admin-narrow-note" role="note">后台按桌面工作台设计；窄屏可横向查看完整字段。</p>
      {filtered.length ? <div className="admin-table-scroll"><table className="admin-project-table"><caption className="sr-only">筛选后的作品工作队列</caption><thead><tr><th>作品</th><th>品类</th><th>发布状态</th><th>访问状态</th><th>完整度</th><th>作者关联</th><th>核验时间</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.project.id}><th scope="row"><strong>{row.name}</strong><code>{row.project.id}</code>{row.hasActiveException ? <Tag tone="strong">异常待复核</Tag> : null}</th><td>{row.categoryIds.map((id) => scenarioLabels[id]).join('、') || '未知'}</td><td><Tag tone={row.isPendingReview ? 'strong' : 'dashed'}>{reviewStatusLabels[row.project.reviewStatus]}</Tag></td><td>{row.accessStatus ? <AccessStatusBadge status={row.accessStatus} /> : <span className="unknown-value">未知</span>}</td><td><CompletenessLabel level={row.project.completenessLevel} /></td><td>{authorLinkStatusLabels[row.project.authorLinkStatus]}</td><td><time dateTime={row.project.lastVerifiedAt}>{new Date(row.project.lastVerifiedAt).toLocaleDateString('zh-CN')}</time></td><td><Link className="button button--primary" to={`/admin/project/${row.project.id}`}>进入编辑</Link></td></tr>)}</tbody></table></div> : <EmptyState title="没有符合条件的作品" description="当前筛选组合没有命中同源作品档案。可调整条件或清空筛选。" action={<Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>清空筛选</Button>} />}
    </div>
  )
}
