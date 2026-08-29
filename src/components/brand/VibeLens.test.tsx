import { render, screen } from '@testing-library/react'
import { lensCoordinates, VibeLens } from './VibeLens'

describe('VibeLens', () => {
  it('derives stable coordinates from a project seed', () => {
    expect(lensCoordinates('project-pdfquizlab')).toEqual(lensCoordinates('project-pdfquizlab'))
    expect(lensCoordinates('project-pdfquizlab')).not.toEqual(lensCoordinates('project-speakingecho'))
  })

  it('has an explicit accessible label and state', () => {
    render(<VibeLens seed="project-pdfquizlab" tone="lime" state="active" label="题练工坊视觉占位" />)
    expect(screen.getByRole('img', { name: '题练工坊视觉占位' })).toHaveAttribute('data-state', 'active')
  })
})
