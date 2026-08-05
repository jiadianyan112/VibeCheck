import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AccessStatusBadge, AssetCard, Button, EmptyState, ExternalLinkGuard, Tag, useToast } from '../components'
import { buildCreatorProfile, relationConfirmationLabels } from '../features'
import { creators, lifecycleEvents, projectRelations, projects, reusableAssets } from '../mocks'
import { useAppState } from '../state'
import type { Project } from '../types'
import { lifecycleEventLabels } from '../utils'

const verificationLabels = {
  verified: '身份已验证',
  unverified: '身份未验证',
  disputed: '身份存在争议',
} as const

function projectName(project: Project | undefined) {
  return project?.currentName.state === 'known' ? project.currentName.value : '名称未知作品'
}

export function CreatorProfilePage() {
  const { id } = useParams()
  const { state } = useAppState()
  const { pushToast } = useToast()
  const creator = creators.find((item) => item.id === id)
  const allProjects = useMemo(() => {
    const baseIds = new Set(projects.map((project) => project.id))
    return [
      ...projects.map((project) => state.projectOverrides.find((item) => item.id === project.id) ?? project),
      ...state.projectOverrides.filter((project) => !baseIds.has(project.id)),
    ]
  }, [state.projectOverrides])
  const allEvents = useMemo(() => [...lifecycleEvents, ...state.lifecycleEventAdditions], [state.lifecycleEventAdditions])
  const allAssets = useMemo(() => [...reusableAssets, ...state.reusableAssetAdditions], [state.reusableAssetAdditions])
  const profile = useMemo(
    () => creator ? buildCreatorProfile(creator, allProjects, allEvents, allAssets, projectRelations) : null,
    [allAssets, allEvents, allProjects, creator],
  )
  const sharePath = creator ? `/creator/${creator.id}` : '/projects'
  const projectMap = useMemo(() => new Map(allProjects.map((project) => [project.id, project])), [allProjects])

  useEffect(() => {
    if (!creator) return
    const previous = document.title
    document.title = `${creator.displayName} · VibeCheck 作者主页`
    return () => { document.title = previous }
  }, [creator])

  async function copySharePath() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`)
      pushToast('作者主页分享链接已复制。', 'success')
    } catch {
      pushToast(`请复制分享路径：${sharePath}`)
    }
  }

  if (!creator || !profile) {
    return (
      <main className="page-container">
        <EmptyState title="未找到作者主页" description="作者编号无效，或该公开身份已经撤下。" action={<Link className="button button--primary" to="/projects">返回作品广场</Link>} />
      </main>
    )
  }

  return (
    <main className="page-container page-with-bottom-space stack">
      <nav aria-label="面包屑"><Link to="/projects">作品广场</Link> / 作者主页 / {creator.displayName}</nav>
      <header className="creator-profile-hero">
        <div className="creator-profile-avatar" aria-hidden="true">{creator.displayName.slice(0, 1)}</div>
        <div className="stack stack--small">
          <div className="cluster"><p className="eyebrow">Creator profile</p><Tag tone={creator.verificationStatus === 'verified' ? 'default' : 'dashed'}>{verificationLabels[creator.verificationStatus]}</Tag></div>
          <h1>{creator.displayName}</h1>
          <p>{creator.bio}</p>
          <div className="cluster" aria-label="公开联系方式">
            {creator.contacts.length ? creator.contacts.map((contact) => <ExternalLinkGuard key={`${contact.type}-${contact.url}`} href={contact.url}>{contact.label}</ExternalLinkGuard>) : <span className="unknown-value">未公开联系方式</span>}
          </div>
        </div>
        <aside className="wire-panel stack stack--small" aria-label="作者主页分享信息">
          <strong>稳定分享路径</strong>
          <code>{sharePath}</code>
          <Button onClick={copySharePath}>复制分享链接</Button>
        </aside>
      </header>

      {creator.verificationStatus === 'disputed' ? <aside className="trust-notice trust-notice--disputed"><strong>作者身份争议处理中</strong><p>公开作品与历史事实继续展示，但不会扩展新的归属关系。</p></aside> : null}

      <section className="stack" aria-labelledby="creator-projects-heading">
        <div className="section-heading"><p className="eyebrow">Verified works</p><h2 id="creator-projects-heading">已发布及经验证关联作品</h2><p>只有公开作者身份与作品归属记录相互一致的作品才会出现在这里。</p></div>
        {profile.verifiedProjects.length ? <div className="creator-work-grid">{profile.verifiedProjects.map((project) => (
          <article className="wire-card stack stack--small" key={project.id}>
            <div className="cluster cluster--between"><Tag>归属已验证</Tag><AccessStatusBadge status={project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'} /></div>
            <h3><Link to={`/project/${project.id}`}>{projectName(project)}</Link></h3>
            <p>{project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : '作品定义待补充。'}</p>
            <Link className="button button--secondary" to={`/project/${project.id}`}>进入作品详情</Link>
          </article>
        ))}</div> : <EmptyState title="暂无经验证关联作品" description="平台收录但未确认作者归属的作品不会列入此处。" action={<Link className="button button--secondary" to="/projects">浏览作品广场</Link>} />}
        {profile.pendingProjects.length ? <aside className="wire-panel stack"><strong>归属待确认</strong>{profile.pendingProjects.map((project) => <p key={project.id}><Link to={`/project/${project.id}`}>{projectName(project)}</Link> · 人工审核中，暂不计入作者作品。</p>)}</aside> : null}
      </section>

      <section className="stack" aria-labelledby="creator-updates-heading">
        <div className="section-heading"><p className="eyebrow">Recent updates</p><h2 id="creator-updates-heading">最近更新</h2></div>
        {profile.recentEvents.length ? <ol className="creator-update-list">{profile.recentEvents.slice(0, 6).map((event) => (
          <li className="wire-panel stack stack--small" key={event.id}>
            <div className="cluster cluster--between"><Tag>{lifecycleEventLabels[event.type]}</Tag><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}</time></div>
            <strong>{event.summary}</strong>
            <Link to={`/project/${event.projectId}#${event.id}`}>在作品详情中定位 →</Link>
          </li>
        ))}</ol> : <EmptyState title="暂无公开更新" description="普通文案变化不会作为作者更新展示。" action={<Link className="button button--secondary" to="/activity">查看全站动态</Link>} />}
      </section>

      <section className="stack" aria-labelledby="creator-assets-heading">
        <div className="section-heading"><p className="eyebrow">Open assets</p><h2 id="creator-assets-heading">公开复用资产</h2><p>资产状态独立于作品当前状态；已结束作品仍可能保留可用资产。</p></div>
        {profile.openAssets.length ? <div className="card-grid">{profile.openAssets.map((asset) => <AssetCard key={asset.id} asset={asset} projectName={projectName(projectMap.get(asset.projectId))} />)}</div> : <EmptyState title="暂无公开复用资产" description="不会从技术栈或作品描述推测资产存在。" action={<Link className="button button--secondary" to="/projects?asset=available">浏览开放资产作品</Link>} />}
      </section>

      <section className="stack" aria-labelledby="creator-reuse-heading">
        <div className="section-heading"><p className="eyebrow">Reused by</p><h2 id="creator-reuse-heading">被其他作品复用</h2><p>关系状态原样展示；待确认和争议关系不会被描述成确定事实。</p></div>
        {profile.reusedByRelations.length ? <div className="relationship-list">{profile.reusedByRelations.map((relation) => {
          const usingProject = projectMap.get(relation.sourceProjectId)
          const ownedProject = projectMap.get(relation.targetProjectId)
          return <article className="relationship-card stack stack--small" key={relation.id}><div className="cluster"><Tag tone="strong">被复用</Tag><Tag tone={relation.confirmationStatus === 'platform_confirmed' || relation.confirmationStatus === 'both_parties_confirmed' ? 'default' : 'dashed'}>{relationConfirmationLabels[relation.confirmationStatus]}</Tag></div><strong>{projectName(usingProject)} → {projectName(ownedProject)}</strong><p>{relation.summary}</p><div className="cluster"><Link to={`/project/${relation.sourceProjectId}`}>查看复用方作品</Link><Link to={`/project/${relation.targetProjectId}`}>查看原作品</Link></div></article>
        })}</div> : <EmptyState title="暂无公开的被复用关系" description="只有有来源、可确认的作品关系才会进入此处。" action={<Link className="button button--secondary" to="/about#rules">查看关系收录规则</Link>} />}
      </section>

      <aside className="wire-panel"><strong>首期作者主页边界</strong><p>这里只展示身份、作品、公开更新、资产和复用关系；不提供关注作者、私信、等级、勋章或财富排行。</p></aside>
    </main>
  )
}
