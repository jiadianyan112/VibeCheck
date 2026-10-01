import { useEffect, useState } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }

  return window.matchMedia(REDUCED_MOTION_QUERY)
}

function getInitialReducedMotion(): boolean {
  return getMediaQueryList()?.matches ?? false
}

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(getInitialReducedMotion)

  useEffect(() => {
    const mediaQueryList = getMediaQueryList()
    if (!mediaQueryList) {
      return undefined
    }

    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches)
    }

    setReducedMotion(mediaQueryList.matches)

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange)
      return () => mediaQueryList.removeEventListener('change', handleChange)
    }

    const legacyMediaQueryList = mediaQueryList as LegacyMediaQueryList
    legacyMediaQueryList.addListener?.(handleChange)
    return () => legacyMediaQueryList.removeListener?.(handleChange)
  }, [])

  return reducedMotion
}
