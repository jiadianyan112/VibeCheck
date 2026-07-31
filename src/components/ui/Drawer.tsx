import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

export interface DrawerProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}

export function Drawer({ open, title, children, onClose }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      previousFocus.current?.focus()
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="drawer-panel stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cluster cluster--between">
          <h2 id="drawer-title">{title}</h2>
          <Button variant="quiet" onClick={onClose} aria-label="关闭抽屉">
            关闭
          </Button>
        </div>
        {children}
      </aside>
    </div>
  )
}
