import { Button } from '../ui'

export function ErrorPanel({ title = '操作未完成', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <section className="feedback feedback--error" role="alert">
      <strong>{title}</strong><p>{message}</p>
      {onRetry ? <Button onClick={onRetry}>重试</Button> : null}
    </section>
  )
}
