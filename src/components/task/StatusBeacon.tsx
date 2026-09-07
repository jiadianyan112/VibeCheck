export type TaskStatus = 'idle' | 'busy' | 'success' | 'warning' | 'error' | 'pending'

export function StatusBeacon({ state, label, detail }: { state: TaskStatus; label: string; detail?: string }) {
  return <div className={`status-beacon status-beacon--${state}`} role="status" aria-live="polite" aria-atomic="true">
    <span className="status-beacon__symbol" aria-hidden="true">{state === 'success' ? '✓' : state === 'error' || state === 'warning' ? '!' : state === 'busy' ? '↻' : '○'}</span>
    <strong>{label}</strong>{detail ? <span className="status-beacon__detail">{detail}</span> : null}
  </div>
}
