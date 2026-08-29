import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../app/providers'
import { createLoginAction } from '../features/auth/session'
import { prototypeUsers } from '../mocks'
import { appReducer, createInitialAppState, persistAppState } from '../state'
import { FrontstageLayout } from './FrontstageLayout'

function renderFrontstage(path: string) {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<FrontstageLayout />}>
            <Route path="*" element={<div data-testid="frontstage-outlet">内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  )
}

describe('FrontstageLayout', () => {
  beforeEach(() => localStorage.clear())

  it('renders the accessible frontstage shell and guest submit path', () => {
    renderFrontstage('/projects')

    const brandLink = screen.getByRole('link', { name: 'VibeCheck 作品广场' })
    expect(brandLink).toHaveAttribute('href', '/projects')
    expect(brandLink.querySelector('.brand-mark')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    expect(footer).toContainElement(screen.getByRole('link', { name: '了解收录规则' }))
    expect(screen.getByRole('link', { name: '发布' })).toHaveAttribute(
      'href',
      '/auth?return_to=%2Fsubmit',
    )
    expect(within(footer).getAllByRole('link')).toHaveLength(4)
  })

  it('uses the direct submit path for logged-in users', () => {
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[0]!)))
    renderFrontstage('/projects')

    expect(screen.getByRole('link', { name: '发布' })).toHaveAttribute('href', '/submit')
  })

  it('keeps the focused flow footer compact while retaining contentinfo and about', () => {
    renderFrontstage('/submit')

    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveClass('site-footer', 'site-footer--compact')
    expect(footer).toContainElement(screen.getByRole('link', { name: '了解收录规则' }))
  })

  it('preserves comparison, notification, and mobile navigation destinations', () => {
    renderFrontstage('/projects')

    const headerActions = screen.getByLabelText('账户与创作入口')
    expect(within(headerActions).getByRole('link', { name: /比较/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/compare/'),
    )
    expect(within(headerActions).getByRole('link', { name: '通知' })).toHaveAttribute(
      'href',
      '/auth?return_to=%2Fnotifications',
    )

    const mobileNavigation = screen.getByRole('navigation', { name: '移动导航' })
    expect(within(mobileNavigation).getByRole('link', { name: '发布作品' })).toHaveAttribute(
      'href',
      '/auth?return_to=%2Fsubmit',
    )
  })
})
