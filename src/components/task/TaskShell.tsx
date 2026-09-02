import type { ReactNode } from 'react'

export interface TaskShellProps {
  eyebrow: string
  title: string
  description?: ReactNode
  rail: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}

export function TaskShell({
  eyebrow,
  title,
  description,
  rail,
  aside,
  children,
  className = '',
}: TaskShellProps) {
  const rootClassName = ['task-shell', className].filter(Boolean).join(' ')
  const hasAside = aside !== undefined && aside !== null
  const layoutClassName = [
    'task-shell__layout',
    !hasAside ? 'task-shell__layout--without-aside' : '',
  ].filter(Boolean).join(' ')

  return (
    <section className={rootClassName}>
      <header className="task-shell__header">
        <p className="task-shell__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description !== undefined ? <div className="task-shell__description">{description}</div> : null}
      </header>
      <div className={layoutClassName}>
        <aside className="task-shell__rail" aria-label="任务步骤">
          {rail}
        </aside>
        <main className="task-shell__main">
          {children}
        </main>
        {hasAside ? (
          <aside className="task-shell__aside" aria-label="任务上下文">
            {aside}
          </aside>
        ) : null}
      </div>
    </section>
  )
}
