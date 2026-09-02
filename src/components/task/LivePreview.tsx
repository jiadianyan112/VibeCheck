import type { ReactNode } from 'react'

export interface LivePreviewProps {
  title?: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  media?: ReactNode
  children?: ReactNode
  empty?: ReactNode
  ariaLabel?: string
  className?: string
}

export function LivePreview({
  title = '实时预览',
  eyebrow,
  description,
  media,
  children,
  empty,
  ariaLabel,
  className = '',
}: LivePreviewProps) {
  const rootClassName = ['live-preview', className].filter(Boolean).join(' ')
  const accessibleLabel = ariaLabel ?? (typeof title === 'string' ? title : '实时预览')

  return (
    <section className={rootClassName} aria-label={accessibleLabel} data-preview-only="true">
      <header className="live-preview__header">
        {eyebrow !== undefined ? <p className="live-preview__eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description !== undefined ? <div className="live-preview__description">{description}</div> : null}
      </header>
      <div className="live-preview__body">
        {media !== undefined ? <div className="live-preview__media">{media}</div> : null}
        <div className="live-preview__content">
          {children !== undefined ? children : empty}
        </div>
      </div>
    </section>
  )
}
