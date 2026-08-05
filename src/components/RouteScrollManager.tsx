import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const scrollStoragePrefix = 'vibecheck:scroll:'

function readScrollPosition(key: string) {
  try {
    const value = sessionStorage.getItem(`${scrollStoragePrefix}${key}`)
    return value === null ? null : Number(value)
  } catch {
    return null
  }
}

function writeScrollPosition(key: string, value: number) {
  try {
    sessionStorage.setItem(`${scrollStoragePrefix}${key}`, String(value))
  } catch {
    // Scroll restoration is progressive enhancement; navigation must still work.
  }
}

export function RouteScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()

  useLayoutEffect(() => {
    let observer: MutationObserver | null = null
    let observerTimeout = 0
    let scrollRetryTimeout = 0

    const scrollToHash = () => {
      if (!location.hash) return false
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (!target) return false
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
      return true
    }

    if (!scrollToHash()) {
      const savedPosition = navigationType === 'POP' ? readScrollPosition(location.key) : null
      if (!navigator.userAgent.includes('jsdom')) {
        let attempts = 0
        const restorePosition = () => {
          window.scrollTo({ top: savedPosition ?? 0, left: 0, behavior: 'auto' })
          attempts += 1
          if (savedPosition && Math.abs(window.scrollY - savedPosition) > 1 && attempts < 60) {
            scrollRetryTimeout = window.setTimeout(restorePosition, 50)
          }
        }
        restorePosition()
      }

      if (location.hash) {
        observer = new MutationObserver(() => {
          if (scrollToHash()) observer?.disconnect()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        observerTimeout = window.setTimeout(() => observer?.disconnect(), 3000)
      }
    }

    return () => {
      writeScrollPosition(location.key, window.scrollY)
      observer?.disconnect()
      window.clearTimeout(observerTimeout)
      window.clearTimeout(scrollRetryTimeout)
    }
  }, [location.hash, location.key, navigationType])

  return null
}
