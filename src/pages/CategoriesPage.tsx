import { DiscoveryShell } from '../components/discovery'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorPanel, LoadingState, Tag } from '../components'
import { categoryCatalog, projectMatchesCategory } from '../features'
import { projectService, type ServiceError } from '../services'
import { useAppState } from '../state'
import type { LifecycleEvent, Project } from '../types'

function nameOf(project: Project | undefined) {
  return project?.currentName.state === 'known' ? project.currentName.value : '暂无代表作品'
}

export function CategoriesPage() {
  const { state } = useAppState()
  const [projects, setProjects] = useState<Project[]>([])
  const [events, setEvents] = useState<LifecycleEvent[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([projectService.list({ scenario: state.serviceScenario }), projectService.listEvents({ scenario: state.serviceScenario })]).then(([projectResult, eventResult]) => {
      if (!active) return
      if (!projectResult.ok) setError(projectResult.error)
      else if (!eventResult.ok) setError(eventResult.error)
      else { setProjects(projectResult.data); setEvents(eventResult.data); setError(null) }
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  const categories = useMemo(() => categoryCatalog.map((category) => {
    const matches = projects.filter((project) => projectMatchesCategory(project, category))
    const ids = new Set(matches.map((project) => project.id))
    const recentEvent = events.filter((event) => ids.has(event.projectId)).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))[0]
    const tools = [...new Set(matches.flatMap((project) => project.aiCodingTools.state === 'known' ? project.aiCodingTools.value : []))].slice(0, 2)
    return { category, matches, representative: matches[0], recentEvent, tools }
  }), [events, projects])

  if (loading) return <DiscoveryShell title="浏览分类"><LoadingState label="分类加载中" /></DiscoveryShell>
  if (error) return <DiscoveryShell title="浏览分类"><ErrorPanel message={error.message} /></DiscoveryShell>

  return (
    <DiscoveryShell title="浏览分类" description={<p>选一个方向，发现同类作品。</p>}>
      <div className="discovery-toolbar" aria-label="分类说明">
        <div className="discovery-toolbar__lead"><span className="eyebrow">作品分类</span><strong>{categories.length} 个专题</strong></div>
      </div>
      <div className="discovery-editorial-grid">
        {categories.map(({ category, matches, representative, recentEvent, tools }) => (
          <article key={category.slug} className="discovery-category stack">
            <header className="discovery-category__header"><div className="stack stack--small"><Tag tone="dashed">{category.projectCategoryId === 'personal_site_portfolio' ? '新增品类' : 'AI 学习与题库'}</Tag><h2>{category.name}</h2></div><span className="discovery-count">{matches.length} 个作品</span></header>
            <div className="discovery-category__copy"><strong>{category.shortProblem}</strong><p>{category.boundary}</p></div>
            {representative ? <p className="discovery-category__representative">代表作品：<Link to={`/project/${representative.id}`}>{nameOf(representative)}</Link></p> : <EmptyState title="这个分类暂时还没有作品" description="可以先查看其他问题分类。" />}
            <details className="discovery-category__details"><summary>专题信息</summary><div className="discovery-category__paths"><span className="eyebrow">主要路径</span><ul className="plain-list">{category.solutionPaths.map((path) => <li key={path}>{path}</li>)}</ul></div>
            {recentEvent ? <p className="category-card__event"><span>最近事件</span><strong>{recentEvent.summary}</strong><time dateTime={recentEvent.happenedAt}>{new Date(recentEvent.happenedAt).toLocaleDateString('zh-CN')}</time></p> : <p className="page-description">近期无公开事件。</p>}
            {tools.length ? <div className="cluster discovery-category__tools"><span className="page-description">常用构建工具：</span>{tools.map((tool) => <Tag key={tool} tone="dashed">{tool}</Tag>)}</div> : null}
            </details>
            <Link className="button button--secondary discovery-category__action" to={`/categories/${category.slug}`}>进入{category.name}专题</Link>
          </article>
        ))}
      </div>
    </DiscoveryShell>
  )
}
