import { Button } from '../ui'

export function ErrorPanel({ title = '操作未完成', message, detail, onRetry }: { title?: string; message: string; detail?: string; onRetry?: () => void }) {
  return (
    <section className="feedback feedback--error" role="alert">
      <strong>{title}</strong><p>{message}</p>
      {detail ? <details><summary>查看技术信息</summary><code>{detail}</code></details> : null}
      {onRetry ? <Button onClick={onRetry}>重试</Button> : null}
    </section>
  )
}
