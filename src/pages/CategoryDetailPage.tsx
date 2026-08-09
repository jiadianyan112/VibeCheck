import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AssetCard, Button, EmptyState, ErrorPanel, LoadingState, ProjectCard, ResponsiveFilterPanel, Tag } from '../components'
import { getCategory, projectMatchesCategory, useAuthGate, useComparison } from '../features'
import { creatorsForProject } from '../mocks'
import { projectService, type ServiceError } from '../services'
import { useAppState } from '../state'
import type { AccessStatus, CreatorRole, FeedbackMethod, InputType, LifecycleEvent, PracticeFormat, Project, ReusableAsset, SiteType, TargetUser, VisualStyle } from '../types'
import { accessStatusText, feedbackMethodLabels, inputTypeLabels, practiceFormatLabels, targetUserLabels } from '../utils'

function knownArray<T>(fact: { state: 'known'; value: T[] } | { state: 'unknown' }) { return fact.state === 'known' ? fact.value : [] }
function unique<T>(values: T[]) { return [...new Set(values)] }
const siteTypeLabels: Record<SiteType, string> = { personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点' }
const creatorRoleLabels: Record<CreatorRole, string> = { developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者', multidisciplinary: '跨领域创作者', other: '其他' }
const visualStyleLabels: Record<VisualStyle, string> = { minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导', other: '其他' }

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

  const portfolioOptions = useMemo(() => ({
    groups: unique(baseProjects.map((p) => p.categoryGroup).filter((value): value is string => Boolean(value))),
    siteTypes: unique(baseProjects.flatMap((p) => p.categoryData?.siteType.state === 'known' ? [p.categoryData.siteType.value] : [])),
    roles: unique(baseProjects.flatMap((p) => p.categoryData?.creatorRoles.state === 'known' ? p.categoryData.creatorRoles.value : [])),
    visualStyles: unique(baseProjects.flatMap((p) => p.categoryData?.visualStyles.state === 'known' ? p.categoryData.visualStyles.value : [])),
  }), [baseProjects])

  const filtered = useMemo(() => {
    const target = params.get('target') as TargetUser | null, input = params.get('input') as InputType | null
    const practice = params.get('practice') as PracticeFormat | null, feedback = params.get('feedback') as FeedbackMethod | null
    const status = params.get('status') as AccessStatus | null
    const group = params.get('group'), siteType = params.get('siteType') as SiteType | null, role = params.get('role') as CreatorRole | null, visual = params.get('visual') as VisualStyle | null
    const result = baseProjects.filter((p) => {
      const common = (!status || (p.accessStatus.state === 'known' ? p.accessStatus.value : 'unknown') === status) && (params.get('open') !== '1' || (p.repositoryUrl.state === 'known' && Boolean(p.repositoryUrl.value))) && (params.get('assets') !== '1' || p.assetIds.length > 0)
      if (p.categoryId === 'personal_site_portfolio') return common && (!group || p.categoryGroup === group) && (!siteType || (p.categoryData?.siteType.state === 'known' && p.categoryData.siteType.value === siteType)) && (!role || (p.categoryData?.creatorRoles.state === 'known' && p.categoryData.creatorRoles.value.includes(role))) && (!visual || (p.categoryData?.visualStyles.state === 'known' && p.categoryData.visualStyles.value.includes(visual)))
      return common && (!target || knownArray(p.targetUsers).includes(target)) && (!input || knownArray(p.mainInputs).includes(input)) && (!practice || knownArray(p.practiceFormats).includes(practice)) && (!feedback || knownArray(p.feedbackMethods).includes(feedback))
    })
    const sort = params.get('sort') ?? 'recent'
    return [...result].sort((a, b) => sort === 'name' ? (a.currentName.state === 'known' ? a.currentName.value : '').localeCompare(b.currentName.state === 'known' ? b.currentName.value : '') : sort === 'complete' ? a.completenessLevel.localeCompare(b.completenessLevel) : b.lastVerifiedAt.localeCompare(a.lastVerifiedAt))
  }, [baseProjects, params])

  const projectIds = useMemo(() => new Set(baseProjects.map((project) => project.id)), [baseProjects])
  const categoryEvents = events.filter((event) => projectIds.has(event.projectId)).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt)).slice(0, 4)
  const categoryAssets = assets.filter((asset) => projectIds.has(asset.projectId))

  function setFilter(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  function toggleFavorite(project: Project) { requireLogin({ id: `favorite-${project.id}`, kind: 'favorite', projectId: project.id, sourcePath: `/categories/${slug}?${params}` }, () => dispatch({ type: 'FAVORITE_TOGGLE', projectId: project.id })) }

  if (!category) return <main className="page-container stack"><h1>未找到该专题</h1><p>这个专题可能已调整或暂未开放。</p><Link to="/categories">返回分类总览</Link></main>
  if (loading) return <main className="page-container"><LoadingState label={`${category.name}专题加载中`} /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} /></main>

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to="/categories">分类</Link> / {category.name}</nav>
      <header className="topic-hero stack"><Tag tone="strong">{category.name}专题</Tag><h1>{category.shortProblem}</h1><p>{category.boundary}</p><div className="solution-paths">{category.solutionPaths.map((path, index) => <div key={path}><span>路径 {index + 1}</span><strong>{path}</strong><small>查看采用这种做法的作品</small></div>)}</div></header>

      {baseProjects[0] ? <section className="stack"><div className="section-heading"><h2>代表作品</h2></div><ProjectCard project={baseProjects[0]} creators={creatorsForProject(baseProjects[0])} selectedForCompare={state.comparisonProjectIds.includes(baseProjects[0].id)} onToggleCompare={(p) => state.comparisonProjectIds.includes(p.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: p.id }) : addProject(p.id)} /></section> : null}

      <section className="topic-browser">
        <ResponsiveFilterPanel label="作品筛选"><div className="cluster cluster--between"><h2>筛选与排序</h2><Button variant="quiet" onClick={() => setParams({}, { replace: true })}>重置</Button></div>
          {category.projectCategoryId === 'personal_site_portfolio' ? <>
            <label className="field"><span className="field__label">策展子群</span><select className="input" value={params.get('group') ?? ''} onChange={(e) => setFilter('group', e.target.value)}><option value="">全部</option>{portfolioOptions.groups.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label className="field"><span className="field__label">网站类型</span><select className="input" value={params.get('siteType') ?? ''} onChange={(e) => setFilter('siteType', e.target.value)}><option value="">全部</option>{portfolioOptions.siteTypes.map((v) => <option key={v} value={v}>{siteTypeLabels[v]}</option>)}</select></label>
            <label className="field"><span className="field__label">作者身份</span><select className="input" value={params.get('role') ?? ''} onChange={(e) => setFilter('role', e.target.value)}><option value="">全部</option>{portfolioOptions.roles.map((v) => <option key={v} value={v}>{creatorRoleLabels[v]}</option>)}</select></label>
            <label className="field"><span className="field__label">视觉方向</span><select className="input" value={params.get('visual') ?? ''} onChange={(e) => setFilter('visual', e.target.value)}><option value="">全部</option>{portfolioOptions.visualStyles.map((v) => <option key={v} value={v}>{visualStyleLabels[v]}</option>)}</select></label>
          </> : <>
            <label className="field"><span className="field__label">目标用户</span><select className="input" value={params.get('target') ?? ''} onChange={(e) => setFilter('target', e.target.value)}><option value="">全部</option>{options.targets.map((v) => <option key={v} value={v}>{targetUserLabels[v]}</option>)}</select></label>
            <label className="field"><span className="field__label">材料输入</span><select className="input" value={params.get('input') ?? ''} onChange={(e) => setFilter('input', e.target.value)}><option value="">全部</option>{options.inputs.map((v) => <option key={v} value={v}>{inputTypeLabels[v]}</option>)}</select></label>
            <label className="field"><span className="field__label">练习形式</span><select className="input" value={params.get('practice') ?? ''} onChange={(e) => setFilter('practice', e.target.value)}><option value="">全部</option>{options.practices.map((v) => <option key={v} value={v}>{practiceFormatLabels[v]}</option>)}</select></label>
            <label className="field"><span className="field__label">反馈方式</span><select className="input" value={params.get('feedback') ?? ''} onChange={(e) => setFilter('feedback', e.target.value)}><option value="">全部</option>{options.feedback.map((v) => <option key={v} value={v}>{feedbackMethodLabels[v]}</option>)}</select></label>
          </>}
          <label className="field"><span className="field__label">当前状态</span><select className="input" value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)}><option value="">全部</option>{options.statuses.map((v) => <option key={v} value={v}>{accessStatusText[v]}</option>)}</select></label>
          <label className="check-row"><input type="checkbox" checked={params.get('open') === '1'} onChange={(e) => setFilter('open', e.target.checked ? '1' : '')} />有公开源码</label><label className="check-row"><input type="checkbox" checked={params.get('assets') === '1'} onChange={(e) => setFilter('assets', e.target.checked ? '1' : '')} />有复用资产</label>
          <label className="field"><span className="field__label">排序</span><select className="input" value={params.get('sort') ?? 'recent'} onChange={(e) => setFilter('sort', e.target.value)}><option value="recent">最近核验</option><option value="name">名称</option><option value="complete">资料完整度</option></select></label>
        </ResponsiveFilterPanel>
        <div className="stack"><div className="cluster cluster--between"><h2>作品流</h2><strong aria-live="polite">{filtered.length} 个结果</strong></div>{filtered.length ? <div className="compact-list">{filtered.map((project) => <ProjectCard key={project.id} project={project} creators={creatorsForProject(project)} variant="compact" favorited={state.favoriteProjectIds.includes(project.id)} selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleCompare={(p) => state.comparisonProjectIds.includes(p.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: p.id }) : addProject(p.id)} onToggleFavorite={toggleFavorite} />)}</div> : <EmptyState title="没有符合筛选条件的作品" description="可以减少筛选条件，看看更多作品。" action={<Button onClick={() => setParams({}, { replace: true })}>重置筛选</Button>} />}</div>
      </section>

      <section className="stack"><div className="section-heading"><h2>最近更新</h2></div>{categoryEvents.length ? <div className="event-list">{categoryEvents.map((event) => <Link key={event.id} to={`/project/${event.projectId}#${event.id}`} className="wire-card"><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}</time><strong>{event.summary}</strong><span>查看事件 →</span></Link>)}</div> : <EmptyState title="近期无公开事件" />}</section>
      <section className="stack"><div className="section-heading"><h2>复用资产</h2></div>{categoryAssets.length ? <div className="card-grid">{categoryAssets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}</div> : <EmptyState title="暂无公开复用资产" />}</section>
    </main>
  )
}
