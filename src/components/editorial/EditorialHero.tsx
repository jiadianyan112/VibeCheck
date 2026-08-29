import type { ReactNode } from 'react'

export interface EditorialHeroProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  artwork: ReactNode
  label: string
  children?: ReactNode
  className?: string
}

export function EditorialHero({
  eyebrow,
  title,
  description,
  actions,
  artwork,
  label,
  children,
  className,
}: EditorialHeroProps) {
  const rootClassName = ['editorial-hero', className].filter(Boolean).join(' ')

  return (
    <section className={rootClassName}>
      <div className="editorial-hero__content">
        <header className="editorial-hero__header">
          {eyebrow !== undefined && <p className="editorial-hero__eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </header>
        {description !== undefined && <div className="editorial-hero__description">{description}</div>}
        {actions !== undefined && <div className="editorial-hero__actions">{actions}</div>}
      </div>
      <div className="editorial-hero__artwork" role="img" aria-label={label}>
        {artwork}
      </div>
      {children}
    </section>
  )
}
