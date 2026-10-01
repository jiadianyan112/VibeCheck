import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiscoveryFilters, DiscoveryShell, MatchExplanation } from './index'

type MediaQueryController = MediaQueryList & { setMatches: (matches: boolean) => void }

function mockMatchMedia(matches: boolean): MediaQueryController {
  let current = matches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    get matches() {
      return current
    },
    media: '(min-width: 64rem)',
    onchange: null,
    addListener: (listener: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null) => {
      if (listener) listeners.add((event) => listener.call(query as unknown as MediaQueryList, event))
    },
    removeListener: () => undefined,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (typeof listener === 'function') listeners.add(listener as (event: MediaQueryListEvent) => void)
    },
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    setMatches: (next: boolean) => {
      current = next
      const event = { matches: current, media: query.media } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    },
  } as unknown as MediaQueryController
  return query
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

describe('discovery workspace', () => {
  it('provides one labelled h1, description, query, filter region, and content landmark', () => {
    render(
      <DiscoveryShell
        title="搜索作品"
        description={<p>按真实条件找到可参考的作品。</p>}
        query={<input aria-label="关键词" defaultValue="PDF" />}
        filters={<DiscoveryFilters label="搜索筛选"><label>状态<select aria-label="状态"><option>全部</option></select></label></DiscoveryFilters>}
      >
        <section aria-label="搜索结果"><p>结果内容</p></section>
      </DiscoveryShell>,
    )

    expect(screen.getAllByRole('heading', { level: 1, name: '搜索作品' })).toHaveLength(1)
    expect(screen.getByText('按真实条件找到可参考的作品。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '关键词' })).toHaveValue('PDF')
    expect(screen.getByRole('region', { name: '搜索结果' })).toBeInTheDocument()
    expect(document.querySelector('.highfi-scope > .discovery-shell')).toBeInTheDocument()
    expect(document.querySelector('.discovery-shell__layout')).toBeInTheDocument()
  })

  it('uses a supplied hero as the title source without adding a second h1', () => {
    render(
      <DiscoveryShell
        title="备用标题"
        hero={<section className="editorial-hero"><header><h1>专题发现</h1></header></section>}
      >
        <p>专题内容</p>
      </DiscoveryShell>,
    )

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: '专题发现' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: '备用标题' })).not.toBeInTheDocument()
  })

  it('defaults to desktop when matchMedia is unavailable and keeps one filter input', () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })

    render(
      <DiscoveryFilters label="搜索筛选">
        <label>关键词<input aria-label="关键词" /></label>
      </DiscoveryFilters>,
    )

    expect(screen.queryByRole('button', { name: '筛选与排序' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: '关键词' })).toHaveLength(1)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  })

  it('keeps mobile filters closed until requested, traps the drawer, and restores focus on Escape', async () => {
    const user = userEvent.setup()
    const media = mockMatchMedia(false)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => media) })

    render(
      <DiscoveryFilters label="搜索筛选">
        <label>关键词<input aria-label="关键词" /></label>
      </DiscoveryFilters>,
    )

    const trigger = screen.getByRole('button', { name: '筛选与排序' })
    expect(screen.queryByRole('dialog', { name: '搜索筛选' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '关键词' })).not.toBeInTheDocument()

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '搜索筛选' })
    expect(dialog).toBeVisible()
    expect(within(dialog).getAllByRole('textbox', { name: '关键词' })).toHaveLength(1)
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '搜索筛选' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '筛选与排序' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes and cleans up the mobile drawer when the viewport crosses the desktop breakpoint', async () => {
    const user = userEvent.setup()
    const media = mockMatchMedia(false)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => media) })

    render(
      <DiscoveryFilters label="搜索筛选">
        <label>关键词<input aria-label="关键词" /></label>
      </DiscoveryFilters>,
    )

    await user.click(screen.getByRole('button', { name: '筛选与排序' }))
    expect(screen.getByRole('dialog', { name: '搜索筛选' })).toBeInTheDocument()
    act(() => media.setMatches(true))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '搜索筛选' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '筛选与排序' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('textbox', { name: '关键词' })).toHaveLength(1)
      expect(document.body.style.overflow).toBe('')
    })
  })

  it('renders each supplied match reason as a Tag and does not invent one for empty reasons', () => {
    const { rerender } = render(<MatchExplanation reasons={['命中了 PDF 关键词', '支持公开访问']} />)

    expect(screen.getByRole('heading', { level: 2, name: '为什么匹配' })).toBeInTheDocument()
    expect(screen.getByText('命中了 PDF 关键词')).toHaveClass('tag')
    expect(screen.getByText('支持公开访问')).toHaveClass('tag')
    expect(document.querySelectorAll('.discovery-reasons .tag')).toHaveLength(2)

    rerender(<MatchExplanation reasons={[]} />)
    expect(screen.getByRole('heading', { level: 2, name: '为什么匹配' })).toBeInTheDocument()
    expect(document.querySelectorAll('.discovery-reasons .tag')).toHaveLength(0)
  })
})
