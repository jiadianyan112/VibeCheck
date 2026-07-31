import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorPanel, LoadingState, ProjectCard, Tag } from '../components'
import { categoryCatalog, projectMatchesCategory } from '../features'
import { projectService, type ServiceError } from '../services'
import { useAppState } from '../state'
import type { Evidence, LifecycleEvent, LifecycleEventType, Project } from '../types'
import { lifecycleEventLabels } from '../utils'

export function ActivityPage() {
  const { state } = useAppState()
  const [params, setParams] = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [events, setEvents] = useState<LifecycleEvent[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([projectService.list({ scenario: state.serviceScenario }), projectService.listEvents({ scenario: state.serviceScenario }), projectService.listEvidence({ scenario: state.serviceScenario })]).then(([p, e, v]) => {
      if (!active) return
      const failed = !p.ok ? p.error : !e.ok ? e.error : !v.ok ? v.error : null
      if (failed) setError(failed)
      else if (p.ok && e.ok && v.ok) { setProjects(p.data); setEvents(e.data); setEvidence(v.data); setError(null) }
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const filtered = useMemo(() => {
    const type = params.get('type') as LifecycleEventType | null
    const category = categoryCatalog.find((item) => item.slug === params.get('category'))
    return events.filter((event) => {
      const project = projectMap.get(event.projectId)
      return (!type || event.type === type) && (!category || Boolean(project && projectMatchesCategory(project, category)))
    }).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))
  }, [events, params, projectMap])

  function setFilter(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }

  if (loading) return <main className="page-container"><LoadingState label="公开动态加载中" /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} detail={error.code} /></main>

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="page-intro stack stack--small"><p className="eyebrow">Public activity</p><h1>最新动态</h1><p>只展示发布、版本、状态、资产、迁移和复用等有事实意义的生命周期事件；普通宣传文案变化不会进入这里。</p></header>
      <section className="activity-filters" aria-label="动态筛选">
        <label className="field"><span className="field__label">事件类型</span><select className="input" value={params.get('type') ?? ''} onChange={(event) => setFilter('type', event.target.value)}><option value="">全部事件</option>{Object.entries(lifecycleEventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field__label">学习分类</span><select className="input" value={params.get('category') ?? ''} onChange={(event) => setFilter('category', event.target.value)}><option value="">全部分类</option>{categoryCatalog.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</select></label>
        <strong aria-live="polite">{filtered.length} 条公开事件</strong>
      </section>
      {filtered.length ? <ol className="activity-stream">{filtered.map((event) => {
        const project = projectMap.get(event.projectId)
        if (!project) return null
        const sources = evidence.filter((item) => event.evidenceIds.includes(item.id))
        return <li key={event.id} id={event.id} className="activity-item"><div className="activity-item__rail"><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}</time><Tag tone={event.disputeStatus === 'none' ? 'default' : 'dashed'}>{lifecycleEventLabels[event.type]}</Tag></div><div className="stack stack--small"><ProjectCard project={project} variant="event" event={event} evidence={sources} /><Link className="event-anchor-link" to={`/project/${project.id}#${event.id}`}>在作品详情中定位此事件 →</Link></div></li>
      })}</ol> : <EmptyState title="没有符合条件的公开事件" description="可能是筛选条件过窄，或当前模拟场景没有事件数据；不会用普通字段编辑填充动态。" action={<Link className="button button--secondary" to="/activity">清除筛选</Link>} />}
      <aside className="wire-panel"><strong>状态文案边界</strong><p>“暂停”和“结束”仅在作者声明或可信来源支持时出现。技术检查异常不会自动推断作品暂停、结束或失败。</p></aside>
    </main>
  )
}
