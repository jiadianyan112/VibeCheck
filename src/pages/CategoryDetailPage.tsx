import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AssetCard, Button, EmptyState, ErrorPanel, LoadingState, ProjectCard, Tag } from '../components'
import { getCategory, projectMatchesCategory, useAuthGate, useComparison } from '../features'
import { projectService, type ServiceError } from '../services'
import { useAppState } from '../state'
import type { AccessStatus, FeedbackMethod, InputType, LifecycleEvent, PracticeFormat, Project, ReusableAsset, TargetUser } from '../types'
import { accessStatusText, feedbackMethodLabels, inputTypeLabels, practiceFormatLabels, targetUserLabels } from '../utils'

function knownArray<T>(fact: { state: 'known'; value: T[] } | { state: 'unknown' }) { return fact.state === 'known' ? fact.value : [] }
function unique<T>(values: T[]) { return [...new Set(values)] }

export function CategoryDetailPage() {
  const { slug } = useParams()
  const category = getCategory(slug)
  const [params, setParams] = useSearchParams()
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const [projects, setProjects] = useState<Project[]>([])
  const [events, setEvents] = useState<LifecycleEvent[]>([])
  const [assets, setAssets] = useState<ReusableAsset[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([projectService.list({ scenario: state.serviceScenario }), projectService.listEvents({ scenario: state.serviceScenario }), projectService.listAssets({ scenario: state.serviceScenario })]).then(([p, e, a]) => {
      if (!active) return
      const failed = !p.ok ? p.error : !e.ok ? e.error : !a.ok ? a.error : null
      if (failed) setError(failed)
      else if (p.ok && e.ok && a.ok) { setProjects(p.data); setEvents(e.data); setAssets(a.data); setError(null) }
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  useEffect(() => {
    if (!slug) return
    const key = `vibecheck:category-scroll:${slug}`
    const saved = Number(sessionStorage.getItem(key) ?? 0)
    if (saved > 0) requestAnimationFrame(() => window.scrollTo({ top: saved }))
    return () => sessionStorage.setItem(key, String(window.scrollY))
  }, [slug])

  const baseProjects = useMemo(() => category ? projects.filter((project) => projectMatchesCategory(project, category)) : [], [category, projects])
  const options = useMemo(() => ({
    targets: unique(baseProjects.flatMap((p) => knownArray(p.targetUsers))),
    inputs: unique(baseProjects.flatMap((p) => knownArray(p.mainInputs))),
    practices: unique(baseProjects.flatMap((p) => knownArray(p.practiceFormats))),
    feedback: unique(baseProjects.flatMap((p) => knownArray(p.feedbackMethods))),
    statuses: unique(baseProjects.map((p) => p.accessStatus.state === 'known' ? p.accessStatus.value : 'unknown')),
  }), [baseProjects])

  const filtered = useMemo(() => {
    const target = params.get('target') as TargetUser | null, input = params.get('input') as InputType | null
    const practice = params.get('practice') as PracticeFormat | null, feedback = params.get('feedback') as FeedbackMethod | null
    const status = params.get('status') as AccessStatus | null
    const result = baseProjects.filter((p) => (!target || knownArray(p.targetUsers).includes(target)) && (!input || knownArray(p.mainInputs).includes(input)) && (!practice || knownArray(p.practiceFormats).includes(practice)) && (!feedback || knownArray(p.feedbackMethods).includes(feedback)) && (!status || (p.accessStatus.state === 'known' ? p.accessStatus.value : 'unknown') === status) && (params.get('open') !== '1' || (p.repositoryUrl.state === 'known' && Boolean(p.repositoryUrl.value))) && (params.get('assets') !== '1' || p.assetIds.length > 0))
    const sort = params.get('sort') ?? 'recent'
    return [...result].sort((a, b) => sort === 'name' ? (a.currentName.state === 'known' ? a.currentName.value : '').localeCompare(b.currentName.state === 'known' ? b.currentName.value : '') : sort === 'complete' ? a.completenessLevel.localeCompare(b.completenessLevel) : b.lastVerifiedAt.localeCompare(a.lastVerifiedAt))
  }, [baseProjects, params])

  const projectIds = useMemo(() => new Set(baseProjects.map((project) => project.id)), [baseProjects])
  const categoryEvents = events.filter((event) => projectIds.has(event.projectId)).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt)).slice(0, 4)
  const categoryAssets = assets.filter((asset) => projectIds.has(asset.projectId))

  function setFilter(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  function protectedToggle(kind: 'favorite' | 'follow', project: Project) { requireLogin({ id: `${kind}-${project.id}`, kind, projectId: project.id, sourcePath: `/categories/${slug}?${params}` }, () => dispatch({ type: kind === 'favorite' ? 'FAVORITE_TOGGLE' : 'FOLLOW_TOGGLE', projectId: project.id })) }

  if (!category) return <main className="page-container stack"><h1>未找到该专题</h1><p>这个专题不在首期学习练习分类范围内。</p><Link to="/categories">返回分类总览</Link></main>
  if (loading) return <main className="page-container"><LoadingState label={`${category.name}专题加载中`} /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} detail={error.code} /></main>

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to="/categories">分类</Link> / {category.name}</nav>
      <header className="topic-hero stack"><Tag tone="strong">{category.name}专题</Tag><h1>{category.shortProblem}</h1><p>{category.boundary}</p><div className="solution-paths">{category.solutionPaths.map((path, index) => <div key={path}><span>路径 {index + 1}</span><strong>{path}</strong><small>由结构化输入、练习形式和反馈字段归组</small></div>)}</div></header>

      {baseProjects[0] ? <section className="stack"><div className="section-heading"><p className="eyebrow">Representative</p><h2>代表作品</h2></div><ProjectCard project={baseProjects[0]} selectedForCompare={state.comparisonProjectIds.includes(baseProjects[0].id)} onToggleCompare={(p) => state.comparisonProjectIds.includes(p.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: p.id }) : addProject(p.id)} /></section> : null}

      <section className="topic-browser">
        <aside className="filter-panel stack" aria-label="作品筛选"><div className="cluster cluster--between"><h2>筛选与排序</h2><Button variant="quiet" onClick={() => setParams({}, { replace: true })}>重置</Button></div>
          <label className="field"><span className="field__label">目标用户</span><select className="input" value={params.get('target') ?? ''} onChange={(e) => setFilter('target', e.target.value)}><option value="">全部</option>{options.targets.map((v) => <option key={v} value={v}>{targetUserLabels[v]}</option>)}</select></label>
          <label className="field"><span className="field__label">材料输入</span><select className="input" value={params.get('input') ?? ''} onChange={(e) => setFilter('input', e.target.value)}><option value="">全部</option>{options.inputs.map((v) => <option key={v} value={v}>{inputTypeLabels[v]}</option>)}</select></label>
          <label className="field"><span className="field__label">练习形式</span><select className="input" value={params.get('practice') ?? ''} onChange={(e) => setFilter('practice', e.target.value)}><option value="">全部</option>{options.practices.map((v) => <option key={v} value={v}>{practiceFormatLabels[v]}</option>)}</select></label>
          <label className="field"><span className="field__label">反馈方式</span><select className="input" value={params.get('feedback') ?? ''} onChange={(e) => setFilter('feedback', e.target.value)}><option value="">全部</option>{options.feedback.map((v) => <option key={v} value={v}>{feedbackMethodLabels[v]}</option>)}</select></label>
          <label className="field"><span className="field__label">当前状态</span><select className="input" value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)}><option value="">全部</option>{options.statuses.map((v) => <option key={v} value={v}>{accessStatusText[v]}</option>)}</select></label>
          <label className="check-row"><input type="checkbox" checked={params.get('open') === '1'} onChange={(e) => setFilter('open', e.target.checked ? '1' : '')} />有公开源码</label><label className="check-row"><input type="checkbox" checked={params.get('assets') === '1'} onChange={(e) => setFilter('assets', e.target.checked ? '1' : '')} />有复用资产</label>
          <label className="field"><span className="field__label">排序</span><select className="input" value={params.get('sort') ?? 'recent'} onChange={(e) => setFilter('sort', e.target.value)}><option value="recent">最近核验</option><option value="name">名称</option><option value="complete">资料完整度</option></select></label>
        </aside>
        <div className="stack"><div className="cluster cluster--between"><h2>作品流</h2><strong aria-live="polite">{filtered.length} 个结果</strong></div>{filtered.length ? <div className="compact-list">{filtered.map((project) => <ProjectCard key={project.id} project={project} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleCompare={(p) => state.comparisonProjectIds.includes(p.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: p.id }) : addProject(p.id)} onToggleFavorite={(p) => protectedToggle('favorite', p)} onToggleFollow={(p) => protectedToggle('follow', p)} />)}</div> : <EmptyState title="没有符合筛选条件的作品" description="可以重置部分筛选；原型不会补造结果。" action={<Button onClick={() => setParams({}, { replace: true })}>重置筛选</Button>} />}</div>
      </section>

      <section className="stack"><div className="section-heading"><p className="eyebrow">Updates</p><h2>最近更新</h2></div>{categoryEvents.length ? <div className="event-list">{categoryEvents.map((event) => <Link key={event.id} to={`/project/${event.projectId}#${event.id}`} className="wire-card"><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}</time><strong>{event.summary}</strong><span>查看事件 →</span></Link>)}</div> : <EmptyState title="近期无公开事件" />}</section>
      <section className="stack"><div className="section-heading"><p className="eyebrow">Assets</p><h2>复用资产</h2></div>{categoryAssets.length ? <div className="card-grid">{categoryAssets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}</div> : <EmptyState title="暂无公开复用资产" />}</section>
    </main>
  )
}
