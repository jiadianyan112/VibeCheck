import type { ReactNode } from 'react'
import { Button } from './Button'

export function LoadingState({ label = '内容加载中' }: { label?: string }) {
  return (
    <div className="skeleton-stack" role="status" aria-label={label}>
      <span className="skeleton skeleton--title" />
      <span className="skeleton" />
      <span className="skeleton skeleton--short" />
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state" role="status">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function ErrorState({
  title = '暂时无法加载',
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="feedback feedback--error" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry ? <Button onClick={onRetry}>重试</Button> : null}
    </div>
  )
}
