import { useId } from 'react'

export interface TaskFieldError { targetId: string; message: string }

export function ErrorSummary({ errors }: { errors: readonly TaskFieldError[] }) {
  const headingId = useId()
  if (!errors.length) return null
  return <section className="task-error-summary" tabIndex={-1} aria-labelledby={headingId}>
    <h3 id={headingId}>请检查以下内容</h3>
    <ul>{errors.map(({ targetId, message }) => <li key={targetId}>
      <a href={`#${targetId}`} onClick={(event) => {
        event.preventDefault()
        const input = document.getElementById(targetId)
        input?.focus()
        input?.scrollIntoView?.({ block: 'center', behavior: 'instant' })
      }}>{message}</a>
    </li>)}</ul>
  </section>
}
