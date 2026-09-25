import type { CSSProperties } from 'react'

export type VibeLensTone = 'lime' | 'yellow' | 'violet' | 'cyan'
export type VibeLensState = 'idle' | 'active' | 'pending'

export interface VibeLensProps {
  seed: string
  tone: VibeLensTone
  state: VibeLensState
  label: string
  className?: string
}

export function lensCoordinates(seed: string) {
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  const unsigned = hash >>> 0
  return {
    x: 34 + (unsigned % 33),
    y: 36 + ((unsigned >>> 8) % 29),
    tilt: -8 + ((unsigned >>> 16) % 17),
  }
}

export function VibeLens({ seed, tone, state, label, className = '' }: VibeLensProps) {
  const coordinates = lensCoordinates(seed)
  const style = {
    '--lens-x': `${coordinates.x}%`,
    '--lens-y': `${coordinates.y}%`,
    '--lens-tilt': `${coordinates.tilt}deg`,
  } as CSSProperties
  const rootClassName = [`vibe-lens`, `vibe-lens--${tone}`, `vibe-lens--${state}`, className].filter(Boolean).join(' ')
  const offsetX = coordinates.x - 50
  const offsetY = coordinates.y - 50

  return (
    <div className={rootClassName} role="img" aria-label={label} data-state={state} data-tone={tone} style={style}>
      <svg className="vibe-lens__svg" viewBox="0 0 160 160" aria-hidden="true" focusable="false">
        <circle className="vibe-lens__outline" cx="80" cy="80" r="72" />
        <g className="vibe-lens__forms" transform={`translate(${offsetX} ${offsetY})`}>
          <ellipse className="vibe-lens__ellipse vibe-lens__ellipse--wide" cx="80" cy="80" rx="45" ry="22" />
          <ellipse className="vibe-lens__ellipse vibe-lens__ellipse--tall" cx="80" cy="80" rx="23" ry="44" />
          <path className="vibe-lens__notch" d="M51 84 70 103 110 57" />
        </g>
        <circle className="vibe-lens__spark" cx="119" cy="39" r="4" />
      </svg>
    </div>
  )
}
