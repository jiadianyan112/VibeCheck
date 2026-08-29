import type { ReactNode } from 'react'

export interface SectionLeadProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  id?: string
  className?: string
}

export function SectionLead({ eyebrow, title, description, action, id, className }: SectionLeadProps) {
  const rootClassName = ['section-lead', className].filter(Boolean).join(' ')

  return (
    <section className={rootClassName} aria-labelledby={id}>
      <header className="section-lead__header">
        <div className="section-lead__copy">
          {eyebrow !== undefined && <p className="section-lead__eyebrow">{eyebrow}</p>}
          <h2 id={id}>{title}</h2>
          {description !== undefined && <div className="section-lead__description">{description}</div>}
        </div>
        {action !== undefined && <div className="section-lead__action">{action}</div>}
      </header>
    </section>
  )
}
