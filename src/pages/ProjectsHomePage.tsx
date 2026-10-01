import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorPanel, LoadingState } from '../components'
import { FeedProjectCard } from '../components/domain/FeedProjectCard'
import { useAuthGate, useComparison } from '../features'
import { creatorsForProject } from '../mocks'
import { projectService, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { Project } from '../types'

const channels = [
  { id: 'all', label: '全部' },
  { id: 'portfolio', label: '个人主页' },
  { id: 'learning', label: 'AI 学习' },
  { id: 'reusable', label: '可复用' },
  { id: 'ended', label: '已结束' },
] as const
const sorts = ['curated', 'latest', 'updated'] as const

export function ProjectsHomePage() {
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const [searchParams, setSearchParams] = useSearchParams()
  const channel = channels.find((item) => item.id === searchParams.get('channel'))?.id ?? 'all'
  const sort = sorts.find((item) => item === searchParams.get('sort')) ?? 'curated'
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
      if (result.ok) { setProjects(result.data); setError(null) }
      else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [state.serviceScenario])

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((project) => {
      if (channel === 'portfolio') return project.categoryId === 'personal_site_portfolio'
      if (channel === 'learning') return project.categoryId === 'ai_learning_quiz'
      if (channel === 'reusable') return project.assetIds.length > 0
      if (channel === 'ended') return project.accessStatus.state === 'known' && project.accessStatus.value === 'ended'
      return true
    })
    if (sort === 'latest') return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (sort === 'updated') return filtered.sort((a, b) => b.lastVerifiedAt.localeCompare(a.lastVerifiedAt))
    // Interleave the two existing categories without inventing a popularity score.
    const learning = filtered.filter((p) => p.categoryId === 'ai_learning_quiz')
    const portfolios = filtered.filter((p) => p.categoryId === 'personal_site_portfolio')
    return Array.from({ length: Math.max(learning.length, portfolios.length) }, (_, i) => [learning[i], portfolios[i]])
      .flat().filter((p): p is Project => Boolean(p))
  }, [projects, channel, sort])

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'all' || value === 'curated') next.delete(key)
    else next.set(key, value)
    // Commit the filter before another control can update the same query.
    setSearchParams(next, { flushSync: true })
  }

  function toggleFavorite(project: Project) {
    const sourcePath = `/projects${searchParams.size ? `?${searchParams}` : ''}`
    const action = { id: `favorite-${project.id}`, kind: 'favorite', projectId: project.id, sourcePath } as const
    requireLogin(action, () => dispatch({ type: 'FAVORITE_TOGGLE', projectId: project.id }))
  }

  return (
    <main className="highfi-scope explore-page">
      <div className="explore-channels" aria-label="作品分类">
        {channels.map((item) => <button key={item.id} type="button" aria-pressed={channel === item.id} onClick={() => updateFilter('channel', item.id)}>{item.label}</button>)}
        <Link to="/categories" className="explore-channels__more">全部分类 <span aria-hidden="true">↗</span></Link>
      </div>
      <header className="explore-heading">
        <div><h1>发现好作品</h1><p>看看创作者如何把想法变成作品。</p></div>
        <label className="explore-sort"><span className="sr-only">作品排序</span><select value={sort} onChange={(event) => updateFilter('sort', event.target.value)}><option value="curated">综合浏览</option><option value="latest">最新发布</option><option value="updated">最近更新</option></select></label>
      </header>
      {loading ? <LoadingState label="作品广场加载中" /> : error ? <ErrorPanel message={error.message} onRetry={() => dispatch({ type: 'SCENARIO_SET', scenario: 'default' })} /> : visibleProjects.length ? <>
        <section className="explore-feed" aria-label="作品列表">
          {visibleProjects.map((project) => <FeedProjectCard
            key={project.id}
            project={project}
            creators={creatorsForProject(project)}
            favorited={state.favoriteProjectIds.includes(project.id)}
            selectedForCompare={state.comparisonProjectIds.includes(project.id)}
            onToggleFavorite={toggleFavorite}
            onToggleCompare={(item) => state.comparisonProjectIds.includes(item.id) ? dispatch({ type: 'COMPARISON_REMOVE', projectId: item.id }) : addProject(item.id)}
          />)}
        </section>
        <p className="explore-end" role="status">已展示 {visibleProjects.length} 个作品 <span aria-hidden="true">·</span> <Link to={state.session.user ? '/submit' : '/auth?return_to=%2Fsubmit'}>分享你的作品</Link></p>
      </> : <section className="explore-empty">
        <h2>{projects.length ? '这个分类暂时没有作品' : '暂时没有可展示的作品'}</h2>
        <p>换个分类看看，或分享你的第一个作品。</p>
        <div className="cluster"><Link className="button" to="/categories">浏览全部分类</Link><Link className="button button--accent" to={state.session.user ? '/submit' : '/auth?return_to=%2Fsubmit'}>发布作品</Link></div>
      </section>}
    </main>
  )
}
