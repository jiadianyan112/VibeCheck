import { useEffect, useMemo, useState } from 'react'
import { Form, Link } from 'react-router-dom'
import { Button, ErrorPanel, LoadingState, ProjectCard, Tag } from '../components'
import { useAuthGate, useComparison } from '../features'
import { projectService, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { Project } from '../types'

const problemLinks = [
  { slug: 'ai-question-generation', label: '把材料变成题目', hint: 'AI 出题与练习生成' },
  { slug: 'pdf-to-quiz', label: '把 PDF 变成题库', hint: '文档解析与答题流程' },
  { slug: 'speaking-practice', label: '练习并评价口语', hint: '录音、模考与分项反馈' },
  { slug: 'vocabulary-review', label: '记住词汇并安排复习', hint: '卡片、听写与间隔复习' },
]

function knownName(project: Project) {
  return project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
}

export function ProjectsHomePage() {
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('home_viewed') })
  }, [dispatch])

  useEffect(() => {
    let active = true
    setLoading(true)
    projectService.list({ scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (result.ok) { setProjects(result.data); setError(null) } else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  const sections = useMemo(() => ({
    curated: projects.filter((item) => item.completenessLevel === 'complete').slice(0, 3),
    latest: [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    updated: [...projects].sort((a, b) => b.lastVerifiedAt.localeCompare(a.lastVerifiedAt)).slice(0, 4),
    reusable: projects.filter((item) => item.assetIds.length > 0 && item.accessStatus.state === 'known' && item.accessStatus.value !== 'ended').slice(0, 4),
    endedReusable: projects.filter((item) => item.assetIds.length > 0 && item.accessStatus.state === 'known' && item.accessStatus.value === 'ended'),
  }), [projects])

  function protectedToggle(kind: 'favorite' | 'follow', project: Project) {
    const action = { id: `${kind}-${project.id}`, kind, projectId: project.id, sourcePath: '/projects' } as const
    requireLogin(action, () => dispatch({ type: kind === 'favorite' ? 'FAVORITE_TOGGLE' : 'FOLLOW_TOGGLE', projectId: project.id }))
  }

  const renderCompact = (project: Project) => (
    <ProjectCard key={project.id} project={project} variant="compact" selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)} />
  )

  if (loading) return <main className="page-container"><LoadingState label="作品广场加载中" /></main>
  if (error) return <main className="page-container"><ErrorPanel message={error.message} detail={error.code} onRetry={() => dispatch({ type: 'SCENARIO_SET', scenario: 'default' })} /></main>

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-hero__content stack">
          <Tag tone="strong">公开 AI 学习与练习作品社区</Tag>
          <h1>先看看别人怎么做，再决定自己怎么做。</h1>
          <p>浏览可访问作品、生命周期、可信来源和仍可复用的资产；输入作品名、功能词或一个完整想法。</p>
          <Form className="hero-search" action="/search" role="search"><label className="sr-only" htmlFor="home-search">搜索作品或想法</label><input id="home-search" className="input" name="q" placeholder="例如：把 PDF 讲义生成练习题" /><Button type="submit" variant="primary">搜索</Button></Form>
          <div className="cluster" aria-label="快捷问题">{['PDF 出题', '口语模拟评分', '背词卡片', '错题复习'].map((query) => <Link key={query} className="tag" to={`/search?q=${encodeURIComponent(query)}`}>{query}</Link>)}</div>
          <div className="cluster"><Link className="button button--primary" to="#editor-picks">探索作品</Link><Link className="button button--secondary" to={state.session.user ? '/submit' : '/auth?from=%2Fsubmit'}>发布作品</Link></div>
        </div>
        <aside className="home-hero__aside stack"><strong>这里可以查什么？</strong><p>作品当前是否可访问、它解决什么问题、经历过哪些公开变化、哪些资产仍可复用。</p><strong>这里不判断什么？</strong><p>不根据作品数量判断需求强弱，也不推断项目商业成败。</p></aside>
      </section>

      <section id="editor-picks" className="content-section page-container stack"><header className="section-heading"><p className="eyebrow">Editor picks</p><h2>编辑精选</h2><p>资料相对完整、来源可查的代表作品。</p></header><div className="card-grid">{sections.curated.map((project) => <ProjectCard key={project.id} project={project} favorited={state.favoriteProjectIds.includes(project.id)} followed={state.followedProjectIds.includes(project.id)} selectedForCompare={state.comparisonProjectIds.includes(project.id)} onToggleFavorite={(item) => protectedToggle('favorite', item)} onToggleFollow={(item) => protectedToggle('follow', item)} onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)} />)}</div></section>
      <section className="content-section content-section--muted"><div className="page-container stack"><header className="section-heading"><p className="eyebrow">New</p><h2>最新发布</h2></header><div className="compact-list">{sections.latest.map(renderCompact)}</div></div></section>
      <section className="content-section page-container stack"><header className="section-heading"><p className="eyebrow">Updated</p><h2>最近更新</h2><p>按作品的公开核验时间排列，不等同热门排序。</p></header><div className="compact-list">{sections.updated.map(renderCompact)}</div></section>
      <section className="content-section content-section--muted"><div className="page-container stack"><header className="section-heading"><p className="eyebrow">Reusable</p><h2>开源可复用</h2></header><div className="compact-list">{sections.reusable.map(renderCompact)}</div></div></section>
      <section className="content-section page-container stack"><header className="section-heading"><p className="eyebrow">Explore by problem</p><h2>按问题探索</h2></header><div className="problem-grid">{problemLinks.map((item) => <Link key={item.slug} className="wire-card stack stack--small" to={`/categories/${item.slug}`}><strong>{item.label}</strong><span>{item.hint}</span><span>查看专题 →</span></Link>)}</div></section>
      <section className="content-section content-section--muted"><div className="page-container stack"><header className="section-heading"><p className="eyebrow">Archive</p><h2>已结束，但仍可复用</h2><p>当前产品状态与资产可用状态分别记录。</p></header>{sections.endedReusable.length ? <div className="compact-list">{sections.endedReusable.map(renderCompact)}</div> : <p>暂无符合条件的公开档案。</p>}</div></section>
      <section className="home-explainer page-container"><div><strong>作品档案会持续更新</strong><p>当前状态、历史事件、来源和核验时间各自记录；未知保持未知。</p></div><div><strong>已有档案默认先浏览</strong><p>如需管理既有档案，可在详情页发起低频作者身份验证。</p></div><Link to="/about">阅读收录规则与可信机制 →</Link></section>
      <span className="sr-only">共展示 {projects.length} 个固定模拟作品，首个为 {projects[0] ? knownName(projects[0]) : '无'}。</span>
    </main>
  )
}
