import type { ReactNode } from 'react'

export interface DiscoveryShellProps {
  title: string
  description?: ReactNode
  query?: ReactNode
  filters?: ReactNode
  children: ReactNode
  hero?: ReactNode
}

export function DiscoveryShell({ title, description, query, filters, children, hero }: DiscoveryShellProps) {
  const hasHero = hero !== undefined

  return (
    <main
      className="highfi-scope discovery-page"
      aria-label={hasHero ? title : undefined}
    >
      <div className="discovery-shell">
        {hasHero ? (
          <div className="discovery-shell__hero">{hero}</div>
        ) : (
          <header className="discovery-shell__header">
            <div className="discovery-shell__heading">
              <h1>{title}</h1>
              {description !== undefined ? <div className="discovery-shell__description">{description}</div> : null}
            </div>
            {query !== undefined ? <div className="discovery-shell__query">{query}</div> : null}
          </header>
        )}
        {hasHero && query !== undefined ? <div className="discovery-shell__query discovery-shell__query--after-hero">{query}</div> : null}
        <div className={`discovery-shell__layout${filters === undefined ? ' discovery-shell__layout--single' : ''}`}>
          {filters !== undefined ? <div className="discovery-shell__filters">{filters}</div> : null}
          <div className="discovery-shell__content">{children}</div>
        </div>
      </div>
    </main>
  )
}
