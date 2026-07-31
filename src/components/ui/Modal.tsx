import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

export interface ModalProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}

export function Modal({ open, title, children, onClose, footer }: ModalProps) {
  const panelRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => previousFocus.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="dialog-panel stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cluster cluster--between">
          <h2 id="modal-title">{title}</h2>
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
