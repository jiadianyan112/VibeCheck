import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Reveal } from './Reveal'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function createMediaQueryList(matches = false) {
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()

  return {
    matches,
    media: reducedMotionQuery,
    onchange: null,
    addEventListener,
    removeEventListener,
    dispatchEvent: vi.fn(),
  }
}

class MockIntersectionObserver {
  static callback: IntersectionObserverCallback
  static instance: MockIntersectionObserver

  observe = vi.fn()
  disconnect = vi.fn()

  constructor(callback: IntersectionObserverCallback) {
    MockIntersectionObserver.callback = callback
    MockIntersectionObserver.instance = this
  }
}

describe('Reveal', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows content immediately when reduced motion is requested', () => {
    const mediaQueryList = createMediaQueryList(true)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQueryList))

    render(
      <Reveal>
        <p>立即可见</p>
      </Reveal>,
    )

    expect(screen.getByText('立即可见').parentElement).toHaveAttribute('data-reveal-state', 'visible')
    expect(mediaQueryList.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('clamps reveal delay to the supported 0–320ms range', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(createMediaQueryList(false)))

    render(
      <>
        <Reveal delayMs={-40}>
          <p data-testid="negative-delay">零延迟</p>
        </Reveal>
        <Reveal delayMs={900}>
          <p data-testid="large-delay">最大延迟</p>
        </Reveal>
      </>,
    )

    expect(screen.getByTestId('negative-delay').parentElement).toHaveAttribute('data-reveal-delay', '0')
    expect(screen.getByTestId('negative-delay').parentElement).toHaveStyle('--reveal-delay: 0ms')
    expect(screen.getByTestId('large-delay').parentElement).toHaveAttribute('data-reveal-delay', '320')
    expect(screen.getByTestId('large-delay').parentElement).toHaveStyle('--reveal-delay: 320ms')
  })

  it('subscribes to reduced-motion changes and removes the listener on unmount', () => {
    const mediaQueryList = createMediaQueryList(false)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQueryList))

    const { unmount } = render(
      <Reveal>
        <p>监听变化</p>
      </Reveal>,
    )

    const changeListener = mediaQueryList.addEventListener.mock.calls[0]?.[1]
    expect(changeListener).toEqual(expect.any(Function))

    act(() => {
      changeListener?.({ matches: true } as MediaQueryListEvent)
    })

    expect(screen.getByText('监听变化').parentElement).toHaveAttribute('data-reveal-state', 'visible')

    unmount()
    expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith('change', changeListener)
  })

  it('shows content immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(createMediaQueryList(false)))
    vi.stubGlobal('IntersectionObserver', undefined)

    render(
      <Reveal>
        <p>无观察器也可见</p>
      </Reveal>,
    )

    expect(screen.getByText('无观察器也可见').parentElement).toHaveAttribute('data-reveal-state', 'visible')
  })

  it('reveals once at intersection and disconnects its observer', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(createMediaQueryList(false)))

    const { unmount } = render(
      <Reveal>
        <p>进入视口</p>
      </Reveal>,
    )

    const wrapper = screen.getByText('进入视口').parentElement
    expect(wrapper).toHaveAttribute('data-reveal-state', 'hidden')

    act(() => {
      MockIntersectionObserver.callback?.(
        [{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(wrapper).toHaveAttribute('data-reveal-state', 'hidden')

    const observer = MockIntersectionObserver.instance
    act(() => {
      MockIntersectionObserver.callback?.(
        [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(wrapper).toHaveAttribute('data-reveal-state', 'visible')
    expect(observer.disconnect).toHaveBeenCalledTimes(1)

    act(() => {
      MockIntersectionObserver.callback?.(
        [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(observer.disconnect).toHaveBeenCalledTimes(1)

    unmount()
    expect(wrapper).not.toHaveAttribute('aria-hidden')
    expect(wrapper).not.toHaveStyle('display: none')
    expect(wrapper).not.toHaveStyle('visibility: hidden')
  })

  it('keeps reveal content in the accessibility tree while waiting', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(createMediaQueryList(false)))

    render(
      <Reveal>
        <p>保留语义</p>
      </Reveal>,
    )

    const wrapper = screen.getByText('保留语义').parentElement
    expect(wrapper).toHaveAttribute('data-reveal-state', 'hidden')
    expect(wrapper).not.toHaveAttribute('aria-hidden')
    expect(wrapper).not.toHaveStyle('display: none')
    expect(wrapper).not.toHaveStyle('visibility: hidden')
  })
})
