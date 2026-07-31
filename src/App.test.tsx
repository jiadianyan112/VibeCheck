import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('renders the initialized prototype shell', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'VibeCheck 低保真原型' }),
    ).toBeInTheDocument()
  })
})
