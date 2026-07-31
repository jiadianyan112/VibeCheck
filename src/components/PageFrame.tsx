import type { PropsWithChildren, ReactNode } from 'react'

interface PageFrameProps extends PropsWithChildren {
  title: string
  description?: ReactNode
}

export function PageFrame({ title, description, children }: PageFrameProps) {
  return (
    <main className="page-container">
      <header className="stack stack--small">
        <h1>{title}</h1>
        {description ? <div className="page-description">{description}</div> : null}
      </header>
      {children}
    </main>
  )
}
