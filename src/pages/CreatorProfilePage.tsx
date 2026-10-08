import { useProjectInteractions } from '../features/interactions/ProjectInteractionContext'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, EmptyState, ErrorPanel, ExternalLinkGuard, LoadingState, Tag, useToast } from '../components'
import { FeedProjectCard } from '../components/domain/FeedProjectCard'
import { creators, projects } from '../mocks'
import { useAppState } from '../state'
import { creatorApi, CreatorApiError, type CreatorProjectionDto } from '../services/creatorApi'
import { projectService } from '../services/projectService'
import { creatorId, projectId, type Creator, type CreatorContact, type Project } from '../types'

const isProduction = import.meta.env.PROD

function contactFromDto(contact: Readonly<Record<string, string>>): CreatorContact | null {
  const rawType = contact.type ?? contact.contact_type
  const type: CreatorContact['type'] = rawType === 'email' || rawType === 'github' || rawType === 'social' ? rawType : 'website'
  const url = contact.url ?? contact.value ?? contact.contact_url
  if (!url) return null
  return { type, label: contact.label ?? (type === 'website' ? '公开链接' : type === 'email' ? '公开联系' : type === 'github' ? '代码主页' : '公开动态'), url }
}

function creatorFromDto(dto: CreatorProjectionDto): Creator {
  const contacts = (Array.isArray(dto.contacts) ? dto.contacts : []).map(contactFromDto).filter((contact): contact is CreatorContact => Boolean(contact))
  if (dto.website_url && !contacts.some((contact) => contact.url === dto.website_url)) contacts.unshift({ type: 'website', label: '官方网站', url: dto.website_url })
  return {
    id: creatorId(dto.creator_id),
    displayName: dto.display_name,
    kind: dto.kind ?? null,
    avatarUrl: dto.avatar_url,
    websiteUrl: dto.website_url ?? null,
    bio: dto.bio,
    contacts,
    verificationStatus: dto.verification_status,
    publishedProjectIds: dto.published_project_ids.map(projectId),
    linkedProjectIds: [],
  }
}

function kindLabel(kind: Creator['kind']) {
  return kind === 'team' ? '开发团队' : kind === 'individual' ? '个人开发' : '开发者'
}

export function CreatorProfilePage() {
  const { id } = useParams()
  const { state } = useAppState()
  const { pushToast } = useToast()
  const [remoteCreator, setRemoteCreator] = useState<Creator | null>(null)
  const [remoteProjects, setRemoteProjects] = useState<Project[]>([])
  const [remoteLoading, setRemoteLoading] = useState(isProduction)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [avatarFailed, setAvatarFailed] = useState(false)

  const fallbackCreator = creators.find((item) => item.id === id)
  const fallbackProjects = useMemo(() => {
    const baseIds = new Set(projects.map((project) => project.id))
    return [
      ...projects.map((project) => state.projectOverrides.find((item) => item.id === project.id) ?? project),
      ...state.projectOverrides.filter((project) => !baseIds.has(project.id)),
    ]
  }, [state.projectOverrides])

  useEffect(() => {
    if (!isProduction || !id) {
      setRemoteLoading(false)
      setRemoteCreator(null)
      setRemoteProjects([])
      setRemoteError(null)
      return
    }

    const controller = new AbortController()
    setRemoteLoading(true)
    setRemoteError(null)
    void creatorApi.get(id, controller.signal).then(async (dto) => {
      const creator = creatorFromDto(dto)
      const results = await Promise.all(dto.published_project_ids.map((project) => projectService.getById(projectId(project), { signal: controller.signal })))
      if (controller.signal.aborted) return
      setRemoteCreator(creator)
      setRemoteProjects(results.flatMap((result) => result.ok ? [result.data] : []))
      setRemoteLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setRemoteLoading(false)
      setRemoteError(error instanceof CreatorApiError && error.status === 404 ? '未找到开发者主页' : '开发者资料暂时无法加载，请稍后重试。')
    })
    return () => controller.abort()
  }, [id])

  const creator = isProduction ? remoteCreator : fallbackCreator
  const associatedProjects = useMemo(() => {
    if (!creator) return []
    const declaredIds = new Set([...creator.publishedProjectIds, ...creator.linkedProjectIds])
    const source = isProduction ? remoteProjects : fallbackProjects
    return source.filter((project) => declaredIds.has(project.id))
  }, [creator, fallbackProjects, remoteProjects])
  // A profile's verification state must not be reused as proof for every linked project.
  const projectCardCreator = useMemo(() => creator ? { ...creator, verificationStatus: 'unverified' as const } : null, [creator])
  const interactions = useProjectInteractions(associatedProjects)
  const sharePath = creator ? `/creator/${creator.id}` : '/projects'

  useEffect(() => {
    setAvatarFailed(false)
  }, [creator?.avatarUrl, creator?.id])

  useEffect(() => {
    if (!creator) return
    const previous = document.title
    document.title = `${creator.displayName} · VibeCheck 开发者主页`
    return () => { document.title = previous }
  }, [creator])

  async function copySharePath() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`)
      pushToast('开发者主页分享链接已复制。', 'success')
    } catch {
      pushToast('请从浏览器地址栏复制本页链接。')
    }
  }

  if (remoteLoading) {
    return <main className="page-container page-with-bottom-space highfi-scope community-page stack"><LoadingState label="开发者主页加载中" /></main>
  }

  if (remoteError) {
    return (
      <main className="page-container page-with-bottom-space highfi-scope community-page stack">
        {remoteError === '未找到开发者主页' ? <EmptyState title={remoteError} description="开发者编号无效，或该公开身份已经撤下。" action={<Link className="button button--primary" to="/projects">返回作品广场</Link>} /> : <ErrorPanel message={remoteError} />}
      </main>
    )
  }

  if (!creator) {
    return <main className="page-container"><EmptyState title="未找到开发者主页" description="开发者编号无效，或该公开身份已经撤下。" action={<Link className="button button--primary" to="/projects">返回作品广场</Link>} /></main>
  }

  return (
    <main className="page-container page-with-bottom-space highfi-scope community-page stack">
      <nav aria-label="面包屑"><Link to="/projects">作品广场</Link> / 开发者主页 / {creator.displayName}</nav>
      <header className="creator-profile-hero">
        <div className="creator-profile-avatar" aria-label={`${creator.displayName}头像`}>
          {creator.avatarUrl && !avatarFailed ? <img src={creator.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={() => setAvatarFailed(true)} /> : <span aria-hidden="true">{creator.displayName.slice(0, 1)}</span>}
        </div>
        <div className="stack stack--small">
          <div className="cluster"><Tag>{kindLabel(creator.kind)}</Tag></div>
          <h1>{creator.displayName}</h1>
          <p>{creator.bio}</p>
          <div className="cluster" aria-label="公开联系方式">
            {creator.contacts.length ? creator.contacts.map((contact) => <ExternalLinkGuard key={`${contact.type}-${contact.url}`} href={contact.url}>{contact.label}</ExternalLinkGuard>) : <span className="unknown-value">未公开联系方式</span>}
          </div>
        </div>
        <aside className="wire-panel stack stack--small" aria-label="开发者主页分享信息">
          <strong>分享开发者主页</strong>
          <Button onClick={copySharePath}>复制分享链接</Button>
        </aside>
      </header>

      {creator.verificationStatus === 'disputed' ? <aside className="trust-notice trust-notice--disputed"><strong>开发者身份争议处理中</strong><p>公开作品与历史事实继续展示，但不会扩展新的归属关系。</p></aside> : null}

      <section className="stack" aria-labelledby="creator-projects-heading">
        <div className="section-heading"><h2 id="creator-projects-heading">关联作品</h2><p>这里展示已关联到该开发者或团队的公开作品。</p></div>
        {associatedProjects.length ? <div className="creator-work-grid">{associatedProjects.map((project) => (
          <FeedProjectCard key={project.id} project={project} liked={interactions.liked(project)} likeCount={interactions.likeCount(project)} likePending={interactions.busy(project)} creators={projectCardCreator ? [projectCardCreator] : []} />
        ))}</div> : <EmptyState title="暂无关联作品" description="这个开发者或团队还没有公开关联作品。" action={<Link className="button button--secondary" to="/projects">浏览作品广场</Link>} />}
      </section>
    </main>
  )
}
