import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AccessStatusBadge, Button, CompletenessLabel, ErrorPanel, ExternalLinkGuard, FreshnessLabel, LoadingState, Tag, UnknownFact, useToast } from '../components'
import { useAuthGate, useComparison } from '../features'
import { projectService, type ProjectBundle, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { Project } from '../types'

const sourceLabels: Record<Project['recordSource'], string> = {
  platform_editor: '平台编辑收录',
  public_discovery: '公开页面发现',
  author_submission: '作者主动发布',
  user_submission: '社区用户提交',
}

const authorLinkLabels: Record<Project['authorLinkStatus'], string> = {
  unlinked: '尚未关联作者',
  pending: '作者关联审核中',
  linked: '已关联验证作者',
  failed: '作者关联未通过',
  disputed: '作者归属存在争议',
}

function factText(fact: Project['currentName'], fallback: string) {
  return fact.state === 'known' ? fact.value : fallback
}

export function ProjectDetailPage() {
  const { id } = useParams()
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { addProject } = useComparison()
  const { pushToast } = useToast()
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    projectService.getBundle(id as Project['id'], { scenario: state.serviceScenario }).then((result) => {
      if (!active) return
      if (result.ok) {
        setBundle(result.data); setError(null)
        dispatch({ type: 'RECENT_PROJECT_ADD', projectId: result.data.project.id })
        dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('project_viewed', { projectId: result.data.project.id }) })
      } else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [dispatch, id, state.serviceScenario])

  if (loading) return <main className="page-container"><LoadingState label="作品档案加载中" /></main>
  if (error || !bundle) return <main className="page-container stack"><ErrorPanel message={error?.message ?? '未找到作品'} detail={error?.code} /><Link to="/projects">返回作品广场</Link></main>

  const { project, creators } = bundle
  const name = factText(project.currentName, '名称未知的作品')
  const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const selected = state.comparisonProjectIds.includes(project.id)
  const favorited = state.favoriteProjectIds.includes(project.id)
  const followed = state.followedProjectIds.includes(project.id)

  function protectedToggle(kind: 'favorite' | 'follow') {
    requireLogin({ id: `${kind}-${project.id}`, kind, projectId: project.id, sourcePath: `/project/${project.id}` }, () => dispatch({ type: kind === 'favorite' ? 'FAVORITE_TOGGLE' : 'FOLLOW_TOGGLE', projectId: project.id }))
  }

  async function shareProject() {
    const shareText = `${name} · VibeCheck`
    try { await navigator.clipboard?.writeText(window.location.href) } catch { /* the prototype still provides visible share feedback */ }
    pushToast(`已准备分享：${shareText}`, 'success')
  }

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to="/projects">作品广场</Link> / {name}</nav>
      <section className="project-hero">
        <div className="media-placeholder project-hero__media" aria-label={project.coverMedia[0]?.alt ?? `${name} 媒体占位`}>16:9 作品媒体占位</div>
        <div className="project-hero__content stack">
          <div className="cluster"><AccessStatusBadge status={status} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /><CompletenessLabel level={project.completenessLevel} /></div>
          <div className="stack stack--small"><p className="eyebrow">Project profile</p><h1>{name}</h1>{project.oneLineDefinition.state === 'known' ? <p className="project-hero__definition">{project.oneLineDefinition.value}</p> : <UnknownFact reason={project.oneLineDefinition.reason} />}</div>

          <section className="project-source stack stack--small" aria-label="作者与来源">
            <div className="cluster cluster--between"><div><strong>{authorLinkLabels[project.authorLinkStatus]}</strong><p>{sourceLabels[project.recordSource]}</p></div>{creators.length ? <div className="cluster">{creators.map((creator) => <Link key={creator.id} to={`/creator/${creator.id}`}><Tag tone={creator.verificationStatus === 'verified' ? 'default' : 'dashed'}>{creator.displayName} · {creator.verificationStatus === 'verified' ? '已验证' : '未验证'}</Tag></Link>)}</div> : <span className="unknown-value">未发现已确认的公开作者</span>}</div>
            <Link className="weak-link" to={`/project/${project.id}/verify-author`}>我是作者，申请关联</Link>
          </section>

          <div className="project-primary-actions" aria-label="作品核心操作">
            {project.publicUrl.state === 'known' ? <ExternalLinkGuard href={project.publicUrl.value}>立即体验</ExternalLinkGuard> : <Button variant="primary" disabled>体验地址未知</Button>}
            <Button aria-pressed={favorited} onClick={() => protectedToggle('favorite')}>{favorited ? '已收藏' : '收藏'}</Button>
            <Button aria-pressed={followed} onClick={() => protectedToggle('follow')}>{followed ? '已关注更新' : '关注更新'}</Button>
            <Button onClick={shareProject}>分享</Button>
            <Button aria-pressed={selected} onClick={() => selected ? dispatch({ type: 'COMPARISON_REMOVE', projectId: project.id }) : addProject(project.id)}>{selected ? '移出比较' : '加入比较'}</Button>
          </div>
        </div>
      </section>
    </main>
  )
}
