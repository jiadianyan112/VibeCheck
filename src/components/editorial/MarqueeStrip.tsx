import type { ReactNode } from 'react'

export interface MarqueeStripProps {
  label: string
  children: ReactNode
}

export function MarqueeStrip({ label, children }: MarqueeStripProps) {
  return (
    <div className="marquee-strip" role="region" aria-label={label} tabIndex={0}>
      <div className="marquee-strip__track">{children}</div>
    </div>
  )
}
