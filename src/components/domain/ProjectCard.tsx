import { Link } from 'react-router-dom'
import type { Creator, Evidence, LifecycleEvent, Project } from '../../types'
import { aiCodingToolLabels } from '../../utils'
import { Button, Card, Tag } from '../ui'
import { ProjectMediaStage } from '../editorial'
import { AccessStatusBadge, EvidenceDrawer, UnknownFact } from './StatusAndEvidence'

export type ProjectCardVariant = 'compact' | 'standard' | 'featured' | 'event'

export interface ProjectCardProps {
  project: Project
  variant?: ProjectCardVariant
  creators?: readonly Creator[]
  evidence?: readonly Evidence[]
  event?: LifecycleEvent
  selectedForCompare?: boolean
  favorited?: boolean
  onToggleCompare?: (project: Project) => void
  onToggleFavorite?: (project: Project) => void
}

function factText(fact: Project['currentName'], fallback: string) {
  return fact.state === 'known' ? fact.value : fallback
}

function ProjectCommunityMeta({ project, creators }: { project: Project; creators: readonly Creator[] }) {
  const toolLabels = project.aiCodingTools.state === 'known'
    ? project.aiCodingTools.value.filter((tool) => tool !== 'unknown').map((tool) => aiCodingToolLabels[tool])
    : []
  const visibleTools = toolLabels.slice(0, 2)

  return (
    <div className="project-card__community-meta" aria-label="创作者与使用工具">
      <div className="project-card__meta-row">
        <span className="project-card__meta-label">作者</span>
        {creators.length ? (
          <span className="project-card__creator-list">
            {creators.map((creator) => (
              <Link key={creator.id} className="project-card__creator-link" to={`/creator/${creator.id}`} aria-label={creator.verificationStatus === 'verified' ? `${creator.displayName}，已验证` : creator.displayName}>
                {creator.displayName}
                {creator.verificationStatus === 'verified' ? <span className="project-card__verified-mark"><span aria-hidden="true">✓</span><span className="sr-only">，已验证</span></span> : null}
              </Link>
            ))}
          </span>
        ) : <span className="project-card__meta-empty">{project.authorLinkStatus === 'unlinked' ? '待认领' : '待补充'}</span>}
      </div>
      <div className="project-card__meta-row">
        <span className="project-card__meta-label">使用工具</span>
        {visibleTools.length ? (
          <span className="project-card__tools">
            {visibleTools.map((label) => <Tag key={label}>{label}</Tag>)}
            {toolLabels.length > visibleTools.length ? <span className="project-card__tool-overflow">+{toolLabels.length - visibleTools.length}</span> : null}
          </span>
        ) : <span className="project-card__meta-empty">待补充</span>}
      </div>
    </div>
  )
}

export function ProjectCard({
  project,
  variant = 'standard',
  creators = [],
  evidence = [],
  event,
  selectedForCompare = false,
  favorited = false,
  onToggleCompare,
  onToggleFavorite,
}: ProjectCardProps) {
  const name = factText(project.currentName, '名称未知的作品')
  const definitionFact = project.summary
  const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const categoryLabel = project.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库'
  const mediaTone = project.categoryId === 'personal_site_portfolio' ? 'violet' : 'lime'

  if (variant === 'compact') {
    return (
      <Card className="project-card project-card--compact">
        <div className="stack stack--small">
          <div className="cluster cluster--between"><div className="cluster"><Link to={`/project/${project.id}`}><strong>{name}</strong></Link><Tag tone="dashed">{categoryLabel}</Tag></div><AccessStatusBadge status={status} /></div>
          {definitionFact.state === 'known' ? <p>{definitionFact.value}</p> : <UnknownFact reason={definitionFact.reason} />}
          <ProjectCommunityMeta project={project} creators={creators} />
        </div>
        <div className="cluster">
          {onToggleFavorite ? <Button variant="quiet" aria-pressed={favorited} onClick={() => onToggleFavorite(project)}>{favorited ? '取消收藏' : '收藏'}</Button> : null}
          {onToggleCompare ? <Button variant="quiet" aria-pressed={selectedForCompare} onClick={() => onToggleCompare(project)}>{selectedForCompare ? '移出比较' : '加入比较'}</Button> : null}
        </div>
      </Card>
    )
  }

  if (variant === 'event') {
    return (
      <Card className="project-card project-card--event stack stack--small">
        <div className="cluster cluster--between"><Link to={`/project/${project.id}`}><strong>{name}</strong></Link><AccessStatusBadge status={status} /></div>
        {event ? <><time dateTime={event.happenedAt}>{new Date(event.happenedAt).toLocaleDateString('zh-CN')}{event.isEstimatedDate ? '（约）' : ''}</time><p>{event.summary}</p><Tag tone={event.disputeStatus === 'none' ? 'default' : 'dashed'}>{event.sourceType === 'system_inference' ? '系统推断' : '有来源记录'}</Tag></> : <UnknownFact reason="尚无可展示的生命周期事件" />}
        <EvidenceDrawer label="查看事件来源" evidences={evidence} />
      </Card>
    )
  }

  const isFeatured = variant === 'featured'

  return (
    <Card className={`project-card project-card--${isFeatured ? 'featured' : 'standard'} stack`}>
      <ProjectMediaStage
        media={project.coverMedia[0]}
        projectId={project.id}
        title={name}
        tone={mediaTone}
        priority={isFeatured}
        aspect={isFeatured ? 'portrait' : 'landscape'}
        className={isFeatured ? 'project-media-stage--featured' : undefined}
      />
      <div className="stack stack--small">
        <div className="cluster cluster--between"><div className="stack stack--small"><Tag tone="dashed">{categoryLabel}</Tag><h3><Link to={`/project/${project.id}`}>{name}</Link></h3></div><AccessStatusBadge status={status} /></div>
        {definitionFact.state === 'known' ? <p>{definitionFact.value}</p> : <UnknownFact reason={definitionFact.reason} />}
        <ProjectCommunityMeta project={project} creators={creators} />
      </div>
      <dl className="project-card__metrics">
        <div><dt>收藏</dt><dd>{project.interactionSummary.favoriteCount}</dd></div>
        <div><dt>讨论</dt><dd>{project.interactionSummary.commentCount}</dd></div>
        <div><dt>关注</dt><dd>{project.interactionSummary.followerCount}</dd></div>
      </dl>
      <div className="project-card__actions" aria-label={`${name} 操作`}>
        {onToggleFavorite ? <Button variant="quiet" aria-pressed={favorited} onClick={() => onToggleFavorite(project)}>{favorited ? '取消收藏' : '收藏'}</Button> : null}
        {onToggleCompare ? <Button aria-pressed={selectedForCompare} onClick={() => onToggleCompare(project)}>{selectedForCompare ? '移出比较' : '加入比较'}</Button> : null}
      </div>
    </Card>
  )
}
