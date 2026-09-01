import type { MouseEvent, ReactNode } from 'react'
import { REDUCED_MOTION_QUERY } from '../motion/useReducedMotion'

export interface ErrorSummaryItem {
  fieldId: string
  label: string
  message: string
}

export interface ErrorSummaryProps {
  errors: readonly ErrorSummaryItem[]
  title?: ReactNode
  onNavigate?: (item: ErrorSummaryItem) => void
  className?: string
}

function getScrollBehavior(): ScrollBehavior {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches) {
    return 'auto'
  }

  return 'smooth'
}

function focusErrorField(fieldId: string) {
  const field = document.getElementById(fieldId)
  if (!field) return

  field.focus()
  field.scrollIntoView?.({ behavior: getScrollBehavior(), block: 'center' })
}

function handleErrorClick(
  event: MouseEvent<HTMLAnchorElement>,
  item: ErrorSummaryItem,
  onNavigate: ((item: ErrorSummaryItem) => void) | undefined,
) {
  event.preventDefault()
  focusErrorField(item.fieldId)
  onNavigate?.(item)
}

export function ErrorSummary({
  errors,
  title = '请修正以下问题',
  onNavigate,
  className = '',
}: ErrorSummaryProps) {
  if (errors.length === 0) return null

  const rootClassName = ['error-summary', className].filter(Boolean).join(' ')

  return (
    <section className={rootClassName} role="alert" aria-label="表单错误">
      <h2 className="error-summary__title">{title}</h2>
      <ul className="error-summary__list">
        {errors.map((item) => (
          <li key={item.fieldId} className="error-summary__item">
            <a
              className="error-summary__link"
              href={`#${item.fieldId}`}
              onClick={(event) => handleErrorClick(event, item, onNavigate)}
            >
              {item.label}
            </a>
            <p className="error-summary__message">{item.message}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
