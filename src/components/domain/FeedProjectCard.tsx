import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectCardProps } from './ProjectCard'
import { ProjectMediaStage } from '../editorial'
import { Button } from '../ui'
import { aiCodingToolLabels } from '../../utils'
import { AccessStatusBadge } from './StatusAndEvidence'

type FeedCoverTone = 'peach' | 'sage' | 'blue' | 'lavender' | 'sand'
type FeedCoverAspect = 'portrait' | 'landscape' | 'square'

const coverTones: readonly FeedCoverTone[] = ['peach', 'sage', 'blue', 'lavender', 'sand']
const coverAspects: readonly FeedCoverAspect[] = ['portrait', 'landscape', 'square']

export type FeedProjectCardProps = Pick<
  ProjectCardProps,
  'project' | 'creators' | 'favorited' | 'selectedForCompare' | 'onToggleFavorite' | 'onToggleCompare'
>

function stableHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function fallbackCover(projectId: string) {
  const hash = stableHash(projectId)
  return {
    tone: coverTones[hash % coverTones.length]!,
    aspect: coverAspects[(hash >>> 8) % coverAspects.length]!,
    tilt: -2 + ((hash >>> 16) % 5),
  }
}

function projectName(project: FeedProjectCardProps['project']) {
  return project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'
}

function summaryText(project: FeedProjectCardProps['project']) {
  return project.summary.state === 'known' ? project.summary.value : `摘要未知：${project.summary.reason}`
}

function firstTool(project: FeedProjectCardProps['project']) {
  if (project.aiCodingTools.state !== 'known') return null
  const tool = project.aiCodingTools.value.find((item) => item !== 'unknown')
  return tool ? aiCodingToolLabels[tool] : null
}

function hasRealMedia(media: FeedProjectCardProps['project']['coverMedia'][number] | undefined) {
  return Boolean(media && (media.kind === 'image' || media.kind === 'video') && media.url)
}

function creatorLabel(creator: NonNullable<FeedProjectCardProps['creators']>[number]) {
  return creator.verificationStatus === 'verified' ? `${creator.displayName}，已验证` : creator.displayName
}

export function FeedProjectCard({
  project,
  creators = [],
  favorited = false,
  selectedForCompare = false,
  onToggleFavorite,
  onToggleCompare,
}: FeedProjectCardProps) {
  const name = projectName(project)
  const cover = fallbackCover(String(project.id))
  const media = project.coverMedia[0]
  const realMedia = hasRealMedia(media)
  const tool = firstTool(project)
  const creator = creators[0]
  const accessStatus = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const titleId = `feed-card-title-${project.id}`
  const coverStyle = { '--feed-card-cover-tilt': `${cover.tilt}deg` } as CSSProperties

  return (
    <article className="project-card feed-card" aria-labelledby={titleId}>
      <Link className="feed-card__media-link" to={`/project/${project.id}`} aria-label={`查看${name}`}>
        <div className="feed-card__media-frame">
          {realMedia ? (
            <ProjectMediaStage
              media={media}
              projectId={project.id}
              title={name}
              tone="lime"
              aspect="landscape"
              className="feed-card__media-stage"
            />
          ) : (
            <div
              className={`feed-card__cover feed-card__cover--${cover.tone} feed-card__cover--${cover.aspect}`}
              role="img"
              aria-label={`${name}，默认封面`}
              style={coverStyle}
            >
              <span className="feed-card__cover-monogram" aria-hidden="true">{name.slice(0, 1)}</span>
              <div className="feed-card__cover-content">
                <span className="feed-card__cover-label">默认封面</span>
                <strong className="feed-card__cover-title">{name}</strong>
              </div>
            </div>
          )}
          <span className="feed-card__status"><AccessStatusBadge status={accessStatus} /></span>
        </div>
      </Link>

      <div className="feed-card__body">
        <h2 id={titleId} className="feed-card__title">
          <Link to={`/project/${project.id}`}>{name}</Link>
        </h2>
        <p className="feed-card__summary">{summaryText(project)}</p>
        <div className="feed-card__byline">
          {creator ? (
            <Link className="feed-card__author" to={`/creator/${creator.id}`} aria-label={creatorLabel(creator)}>
              <span>{creator.displayName}</span>
              {creator.verificationStatus === 'verified' ? <span className="feed-card__verified" aria-hidden="true">✓</span> : null}
            </Link>
          ) : (
            <span className="feed-card__author feed-card__author--unknown">作者待补充</span>
          )}
          <span className="feed-card__tool">{tool ?? '工具未知'}</span>
        </div>
      </div>

      <footer className="feed-card__footer">
        {onToggleFavorite ? (
          <Button
            variant="quiet"
            className="feed-card__action feed-card__favorite"
            aria-label={favorited ? '取消收藏' : '收藏'}
            aria-pressed={favorited}
            onClick={() => onToggleFavorite(project)}
          >
            <span className="feed-card__heart" aria-hidden="true">{favorited ? '♥' : '♡'}</span>
            <span className="feed-card__favorite-count" aria-hidden="true">{project.interactionSummary.favoriteCount}</span>
          </Button>
        ) : (
          <span className="feed-card__favorite-count-static" aria-label={`收藏 ${project.interactionSummary.favoriteCount}`}>
            <span className="feed-card__heart" aria-hidden="true">♡</span>
            <span>{project.interactionSummary.favoriteCount}</span>
          </span>
        )}
        {onToggleCompare ? (
          <Button
            variant="quiet"
            className="feed-card__action feed-card__compare"
            aria-label={selectedForCompare ? '移出比较' : '加入比较'}
            aria-pressed={selectedForCompare}
            onClick={() => onToggleCompare(project)}
          >
            <span className="feed-card__compare-icon" aria-hidden="true">⇄</span>
            <span className="feed-card__compare-copy" aria-hidden="true">比较</span>
          </Button>
        ) : null}
      </footer>
    </article>
  )
}
