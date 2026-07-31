import { Link } from 'react-router-dom'
import type { Evidence, LifecycleEvent, Project } from '../../types'
import { Button, Card, Tag } from '../ui'
import { AccessStatusBadge, CompletenessLabel, EvidenceDrawer, FreshnessLabel, UnknownFact } from './StatusAndEvidence'

export type ProjectCardVariant = 'compact' | 'standard' | 'event'

export interface ProjectCardProps {
  project: Project
  variant?: ProjectCardVariant
  evidence?: readonly Evidence[]
  event?: LifecycleEvent
  selectedForCompare?: boolean
  favorited?: boolean
  followed?: boolean
  onToggleCompare?: (project: Project) => void
  onToggleFavorite?: (project: Project) => void
  onToggleFollow?: (project: Project) => void
}

function factText(fact: Project['currentName'], fallback: string) {
  return fact.state === 'known' ? fact.value : fallback
}

export function ProjectCard({
  project,
  variant = 'standard',
  evidence = [],
  event,
  selectedForCompare = false,
  favorited = false,
  followed = false,
  onToggleCompare,
  onToggleFavorite,
  onToggleFollow,
}: ProjectCardProps) {
  const name = factText(project.currentName, '名称未知的作品')
  const definitionFact = project.oneLineDefinition
  const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'

  if (variant === 'compact') {
    return (
      <Card className="project-card project-card--compact">
        <div className="stack stack--small">
          <div className="cluster cluster--between"><Link to={`/project/${project.id}`}><strong>{name}</strong></Link><AccessStatusBadge status={status} /></div>
          {definitionFact.state === 'known' ? <p>{definitionFact.value}</p> : <UnknownFact reason={definitionFact.reason} />}
          <div className="cluster"><CompletenessLabel level={project.completenessLevel} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /></div>
        </div>
        {onToggleCompare ? <Button variant="quiet" aria-pressed={selectedForCompare} onClick={() => onToggleCompare(project)}>{selectedForCompare ? '移出比较' : '加入比较'}</Button> : null}
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

  return (
    <Card className="project-card project-card--standard stack">
      <div className="media-placeholder" aria-label={project.coverMedia[0]?.alt ?? `${name} 截图占位`}>{project.coverMedia[0]?.kind === 'placeholder' ? '16:9 作品截图' : '作品媒体'}</div>
      <div className="stack stack--small">
        <div className="cluster cluster--between"><h3><Link to={`/project/${project.id}`}>{name}</Link></h3><AccessStatusBadge status={status} /></div>
        {definitionFact.state === 'known' ? <p>{definitionFact.value}</p> : <UnknownFact reason={definitionFact.reason} />}
        <div className="cluster"><CompletenessLabel level={project.completenessLevel} /><FreshnessLabel status={project.freshnessStatus} lastVerifiedAt={project.lastVerifiedAt} /><EvidenceDrawer evidences={evidence} /></div>
      </div>
      <dl className="project-card__metrics">
        <div><dt>收藏</dt><dd>{project.interactionSummary.favoriteCount}</dd></div>
        <div><dt>讨论</dt><dd>{project.interactionSummary.commentCount}</dd></div>
        <div><dt>关注</dt><dd>{project.interactionSummary.followerCount}</dd></div>
      </dl>
      <div className="project-card__actions" aria-label={`${name} 操作`}>
        {onToggleFavorite ? <Button variant="quiet" aria-pressed={favorited} onClick={() => onToggleFavorite(project)}>{favorited ? '已收藏' : '收藏'}</Button> : null}
        {onToggleFollow ? <Button variant="quiet" aria-pressed={followed} onClick={() => onToggleFollow(project)}>{followed ? '已关注更新' : '关注更新'}</Button> : null}
        {onToggleCompare ? <Button aria-pressed={selectedForCompare} onClick={() => onToggleCompare(project)}>{selectedForCompare ? '移出比较' : '加入比较'}</Button> : null}
      </div>
    </Card>
  )
}
