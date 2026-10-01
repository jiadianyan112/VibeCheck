import type { ReactNode } from 'react'
import { StepRail, type TaskStep } from './StepRail'

export interface TaskShellProps {
  title: string
  description?: string
  currentStep?: TaskStep
  status?: ReactNode
  aside?: ReactNode
  children: ReactNode
}

export function TaskShell({ title, description, currentStep = 'address', status, aside, children }: TaskShellProps) {
  return <main className="highfi-scope"><div className="task-shell">
    <div className="task-shell__inner">
      <header className="task-shell__header">
        <p className="eyebrow">VIBECHECK / 发布作品</p>
        <h1>{title}</h1>
        {description ? <p className="task-shell__description">{description}</p> : null}
      </header>
      <StepRail currentStep={currentStep} />
      {status ? <div className="task-shell__status">{status}</div> : null}
      <div className={`task-shell__layout${aside ? '' : ' task-shell__layout--single'}`}>
        <div className="task-shell__body">{children}</div>
        <aside className="task-shell__aside" aria-label="发布辅助信息">{aside}</aside>
      </div>
    </div>
  </div></main>
}
