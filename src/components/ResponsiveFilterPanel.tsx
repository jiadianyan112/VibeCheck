import { useEffect, useState, type ReactNode } from 'react'

export function ResponsiveFilterPanel({ label, children }: { label: string; children: ReactNode }) {
  const [desktop, setDesktop] = useState(true)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 48.0625rem)')
    const update = () => {
      setDesktop(query.matches)
      setOpen(query.matches)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return (
    <details
      className="filter-panel"
      aria-label={label}
      open={open}
      onToggle={(event) => {
        if (desktop && !event.currentTarget.open) {
          setOpen(true)
          return
        }
        setOpen(event.currentTarget.open)
      }}
    >
      <summary><span>筛选与排序</span><span aria-hidden="true">{open ? '收起' : '展开'}</span></summary>
      <div className="filter-panel__body stack">{children}</div>
    </details>
  )
}
