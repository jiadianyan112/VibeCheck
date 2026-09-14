import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Drawer } from '../ui'

const desktopQuery = '(min-width: 64rem)'

function isDesktopByDefault() {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(desktopQuery).matches
}

export interface DiscoveryFiltersProps {
  label: string
  children: ReactNode
}

export function DiscoveryFilters({ label, children }: DiscoveryFiltersProps) {
  const [desktop, setDesktop] = useState(isDesktopByDefault)
  const [open, setOpen] = useState(isDesktopByDefault)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setDesktop(true)
      setOpen(true)
      return
    }

    const media = window.matchMedia(desktopQuery)
    const update = () => {
      setDesktop(media.matches)
      setOpen(media.matches)
    }
    const listen = () => update()
    update()
    if (typeof media.addEventListener === 'function') media.addEventListener('change', listen)
    else media.addListener(listen)
    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', listen)
      else media.removeListener(listen)
    }
  }, [])

  useEffect(() => {
    if (desktop || !open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [desktop, open])

  if (desktop) {
    return (
      <aside className="discovery-filters__desktop" aria-label={label}>
        <div className="discovery-filters__body">{children}</div>
      </aside>
    )
  }

  return (
    <div className="discovery-filters__mobile">
      <Button
        className="discovery-filters__trigger"
        variant="secondary"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        筛选与排序
      </Button>
      <Drawer open={open} title={label} onClose={close}>
        <div className="discovery-filters__body">{children}</div>
      </Drawer>
    </div>
  )
}
