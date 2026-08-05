import { useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { useDialogFocus } from './useDialogFocus'

export interface DrawerProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}

export function Drawer({ open, title, children, onClose }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()
  useDialogFocus(open, panelRef, onClose)

  if (!open) return null

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="drawer-panel stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cluster cluster--between">
          <h2 id={titleId}>{title}</h2>
          <Button variant="quiet" onClick={onClose} aria-label="关闭抽屉">
            关闭
          </Button>
        </div>
        {children}
      </aside>
    </div>
  )
}
