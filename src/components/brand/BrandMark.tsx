export interface BrandMarkProps {
  compact?: boolean
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  const className = ['brand-mark', compact ? 'brand-mark--compact' : ''].filter(Boolean).join(' ')

  return (
    <span className={className}>
      <svg className="brand-mark__glyph" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className="brand-mark__ring" cx="20" cy="20" r="16" />
        <ellipse className="brand-mark__ellipse" cx="20" cy="20" rx="10" ry="5" />
        <path className="brand-mark__check" d="M12 20.5 18 26l11-13" />
      </svg>
      <span className="brand-mark__name">VibeCheck</span>
    </span>
  )
}
