import { useState } from 'react'
import type { MediaItem } from '../../types/domain'
import { VibeLens, type VibeLensTone } from '../brand'

export type ProjectMediaAspect = 'landscape' | 'portrait' | 'square'

export interface ProjectMediaStageProps {
  media?: MediaItem
  projectId: string
  title: string
  tone: VibeLensTone
  priority?: boolean
  aspect?: ProjectMediaAspect
  className?: string
}

export function ProjectMediaStage({
  media,
  projectId,
  title,
  tone,
  priority = false,
  aspect = 'landscape',
  className = '',
}: ProjectMediaStageProps) {
  const [failedMediaKey, setFailedMediaKey] = useState<string | null>(null)
  const mediaKey = media ? JSON.stringify([media.id, media.kind, media.url]) : 'missing'
  const failed = failedMediaKey === mediaKey
  const rootClassName = ['project-media-stage', `project-media-stage--${aspect}`, className].filter(Boolean).join(' ')
  const fallbackLabel = '默认封面'

  const canRenderImage = media?.kind === 'image' && Boolean(media.url) && !failed
  const canRenderVideo = media?.kind === 'video' && Boolean(media.url) && !failed

  if (canRenderImage && media?.kind === 'image' && media.url) {
    return (
      <div className={rootClassName}>
        <img
          src={media.url}
          alt={media.alt}
          width={1600}
          height={900}
          decoding="async"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          onError={() => setFailedMediaKey(mediaKey)}
        />
      </div>
    )
  }

  if (canRenderVideo && media?.kind === 'video' && media.url) {
    return (
      <div className={rootClassName}>
        <video
          src={media.url}
          title={title}
          aria-label={title}
          muted
          playsInline
          onError={() => setFailedMediaKey(mediaKey)}
        />
      </div>
    )
  }

  return (
    <div className={`${rootClassName} project-media-stage--fallback`}>
      <VibeLens seed={projectId} tone={tone} state="idle" label={fallbackLabel} className="project-media-stage__fallback" />
    </div>
  )
}
