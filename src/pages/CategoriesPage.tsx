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

  if (loading) return <main className="page-container"><LoadingState label="分类加载中" /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} detail={error.code} /></main>

  return (
    <main className="page-container page-with-bottom-space stack">
      <header className="page-intro stack stack--small"><p className="eyebrow">Categories</p><h1>按学习问题与练习场景探索</h1><p>首期分类围绕“材料—练习—反馈—记录”闭环组织。技术栈只作为辅助标签，不成为一级分类。</p></header>
      <div className="category-grid">
        {categories.map(({ category, matches, representative, recentEvent, tools }) => (
          <article key={category.slug} className="wire-card category-card stack">
            <div className="cluster cluster--between"><h2>{category.name}</h2><Tag>{matches.length} 个作品</Tag></div>
            <strong>{category.shortProblem}</strong><p>{category.boundary}</p>
            {representative ? <p>代表作品：<Link to={`/project/${representative.id}`}>{nameOf(representative)}</Link></p> : <EmptyState title="暂无收录作品" description="分类边界保留，但不会虚构代表项目。" />}
            <div className="stack stack--small"><span className="eyebrow">主要路径</span><ul className="plain-list">{category.solutionPaths.map((path) => <li key={path}>{path}</li>)}</ul></div>
            {recentEvent ? <p className="category-card__event"><span>最近事件</span><strong>{recentEvent.summary}</strong><time dateTime={recentEvent.happenedAt}>{new Date(recentEvent.happenedAt).toLocaleDateString('zh-CN')}</time></p> : <p className="page-description">近期无公开事件。</p>}
            {tools.length ? <div className="cluster"><span className="page-description">技术辅助标签：</span>{tools.map((tool) => <Tag key={tool} tone="dashed">{tool}</Tag>)}</div> : null}
            <Link className="button button--primary" to={`/categories/${category.slug}`}>进入{category.name}专题</Link>
          </article>
        ))}
      </div>
    </main>
  )
}
