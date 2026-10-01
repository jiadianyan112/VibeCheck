import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorialHero } from './EditorialHero'
import { MarqueeStrip } from './MarqueeStrip'
import { SectionLead } from './SectionLead'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('editorial structures', () => {
  it('labels the hero artwork and preserves heading semantics', () => {
    render(
      <EditorialHero
        eyebrow="社区精选"
        title="看懂作品，再开始创造。"
        description="描述"
        actions={<a href="/projects">探索</a>}
        artwork={<span>视觉</span>}
        label="作品广场首屏"
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '看懂作品，再开始创造。' })).toBeInTheDocument()
    expect(screen.getByLabelText('作品广场首屏')).toBeInTheDocument()
    expect(screen.getByText('社区精选')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '探索' })).toHaveAttribute('href', '/projects')
  })

  it('renders a labelled section lead with an id and action', () => {
    render(
      <SectionLead
        eyebrow="先看这里"
        title="精选作品"
        description="从真实案例开始。"
        action={<a href="#all-projects">查看全部</a>}
        id="featured-projects"
      />,
    )

    const heading = screen.getByRole('heading', { level: 2, name: '精选作品' })
    expect(heading).toHaveAttribute('id', 'featured-projects')
    expect(heading.closest('section')).toHaveAttribute('aria-labelledby', 'featured-projects')
    expect(screen.getByRole('link', { name: '查看全部' })).toHaveAttribute('href', '#all-projects')
  })

  it('keeps section content as a sibling after the header while action stays in the header', () => {
    render(
      <SectionLead
        title="精选作品"
        action={<a href="#all-projects">查看全部</a>}
        id="section-with-body"
      >
        <div data-testid="section-body">正文内容</div>
      </SectionLead>,
    )

    const section = screen.getByRole('heading', { name: '精选作品' }).closest('section')!
    const header = section.querySelector('header')!
    const body = screen.getByTestId('section-body')
    expect(body.parentElement).toBe(section)
    expect(Array.from(section.children)).toEqual([header, body])
    expect(header).toContainElement(screen.getByRole('link', { name: '查看全部' }))
    expect(header).not.toContainElement(body)
    expect(section).toHaveAttribute('aria-labelledby', 'section-with-body')
  })

  it('renders a user-scrollable marquee region without timers or duplicated content', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    render(
      <MarqueeStrip label="热门标签">
        <span>设计</span>
        <span>研究</span>
      </MarqueeStrip>,
    )

    const region = screen.getByRole('region', { name: '热门标签' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveClass('marquee-strip')
    expect(region.querySelector('.marquee-strip__track')).toBeInTheDocument()
    expect(region.querySelectorAll('.marquee-strip__track > *')).toHaveLength(2)
    expect(region.textContent).toBe('设计研究')
    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })
})
