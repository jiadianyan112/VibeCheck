import type { ReactNode } from 'react'

export type StatusTone = 'idle' | 'progress' | 'success' | 'warning' | 'error'

export interface StatusBeaconProps {
  tone?: StatusTone
  status?: StatusTone
  label?: ReactNode
  detail?: ReactNode
  message?: ReactNode
  children?: ReactNode
  live?: 'off' | 'polite' | 'assertive'
  className?: string
}

const defaultLabels: Record<StatusTone, string> = {
  idle: '等待开始',
  progress: '处理中',
  success: '已完成',
  warning: '需要注意',
  error: '发生错误',
}

export function StatusBeacon({
  tone,
  status,
  label,
  detail,
  message,
  children,
  live,
  className = '',
}: StatusBeaconProps) {
  const resolvedTone = tone ?? status ?? 'idle'
  const resolvedLabel = label ?? children ?? defaultLabels[resolvedTone]
  const resolvedDetail = detail ?? message
  const liveValue = live ?? (resolvedTone === 'error' ? 'assertive' : 'polite')
  const rootClassName = ['status-beacon', `status-beacon--${resolvedTone}`, className].filter(Boolean).join(' ')

  return (
    <div
      className={rootClassName}
      role={resolvedTone === 'error' ? 'alert' : 'status'}
      aria-live={liveValue}
      aria-atomic="true"
      data-tone={resolvedTone}
      data-status={resolvedTone}
    >
      <span className="status-beacon__indicator" aria-hidden="true" />
      <span className="status-beacon__copy">
        <strong className="status-beacon__label">{resolvedLabel}</strong>
        {resolvedDetail !== undefined ? <span className="status-beacon__detail">{resolvedDetail}</span> : null}
      </span>
    </div>
  )
}
