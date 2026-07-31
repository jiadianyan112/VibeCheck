import { render, screen } from '@testing-library/react'
import { App } from './app'

describe('App', () => {
  it('renders the initialized prototype shell', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'VibeCheck 原型工程' }),
    ).toBeInTheDocument()
  })
})
