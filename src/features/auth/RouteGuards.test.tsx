import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { prototypeUsers } from '../../mocks'
import { AppStateProvider, appReducer, createInitialAppState, persistAppState } from '../../state'
import { createLoginAction } from './session'
import { StaffRoute } from './RouteGuards'

function renderStaffRoute() {
  return render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<StaffRoute><h1>后台首页</h1></StaffRoute>} />
          <Route path="/auth" element={<h1>选择原型身份</h1>} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('route permissions', () => {
  beforeEach(() => localStorage.clear())

  it('redirects guests to login with the original route', () => {
    renderStaffRoute()
    expect(screen.getByRole('heading', { name: '选择原型身份' })).toBeInTheDocument()
  })

  it('explains denial to a non-staff account', () => {
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[0]!)))
    renderStaffRoute()
    expect(screen.getByRole('heading', { name: '无后台访问权限' })).toBeInTheDocument()
  })

  it('allows a platform editor into the admin area', () => {
    persistAppState(appReducer(createInitialAppState(), createLoginAction(prototypeUsers[2]!)))
    renderStaffRoute()
    expect(screen.getByRole('heading', { name: '后台首页' })).toBeInTheDocument()
  })
})
