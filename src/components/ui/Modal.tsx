import { useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { useDialogFocus } from './useDialogFocus'

export interface ModalProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}

export function Modal({ open, title, children, onClose, footer }: ModalProps) {
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()
  useDialogFocus(open, panelRef, onClose)

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="dialog-panel stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cluster cluster--between">
          <h2 id={titleId}>{title}</h2>
          <Button variant="quiet" onClick={onClose} aria-label="关闭弹层">
            关闭
          </Button>
        </div>
        {children}
        {footer ? <div className="cluster cluster--end">{footer}</div> : null}
      </section>
    </div>
  )
}
