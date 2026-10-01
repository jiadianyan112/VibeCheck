import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

export interface RevealProps {
  children: ReactNode
  className?: string
  delayMs?: number
}

function clampDelay(delayMs: number | undefined): number {
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) {
    return 0
  }

  return Math.min(320, Math.max(0, delayMs))
}

function canObserveIntersections(): boolean {
  return typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function'
}

export function Reveal({ children, className, delayMs }: RevealProps) {
  const reducedMotion = useReducedMotion()
  const nodeRef = useRef<HTMLDivElement>(null)
  const initiallyVisible = reducedMotion || !canObserveIntersections()
  const hasRevealedRef = useRef(initiallyVisible)
  const [state, setState] = useState<'hidden' | 'visible'>(initiallyVisible ? 'visible' : 'hidden')
  const clampedDelay = clampDelay(delayMs)

  useEffect(() => {
    if (reducedMotion || !canObserveIntersections()) {
      hasRevealedRef.current = true
      setState('visible')
      return undefined
    }

    if (hasRevealedRef.current) {
      return undefined
    }

    const node = nodeRef.current
    if (!node) {
      return undefined
    }

    let disconnected = false
    const observer = new window.IntersectionObserver((entries) => {
      if (hasRevealedRef.current || !entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        return
      }

      hasRevealedRef.current = true
      setState('visible')
      if (!disconnected) {
        disconnected = true
        observer.disconnect()
      }
    })

    observer.observe(node)

    return () => {
      if (!disconnected) {
        disconnected = true
        observer.disconnect()
      }
    }
  }, [reducedMotion])

  const rootClassName = ['reveal', `reveal--${state}`, className].filter(Boolean).join(' ')
  const style = { '--reveal-delay': `${clampedDelay}ms` } as CSSProperties

  return (
    <div
      ref={nodeRef}
      className={rootClassName}
      data-reveal-state={state}
      data-reveal-delay={clampedDelay}
      style={style}
    >
      {children}
    </div>
  )
}
