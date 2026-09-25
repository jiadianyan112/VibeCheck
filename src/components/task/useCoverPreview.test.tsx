import { renderHook } from '@testing-library/react'
import { useCoverPreview } from './useCoverPreview'

it('releases local cover URLs on replacement and unmount without persisting a file', () => {
  const createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  const revokeObjectURL = vi.fn()
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  try {
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.png', { type: 'image/png' })
    const { result, rerender, unmount } = renderHook(({ file }: { file: File | null }) => useCoverPreview(file), { initialProps: { file: first as File | null } })
    expect(result.current).toBe('blob:first')
    rerender({ file: second })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(result.current).toBe('blob:second')
    rerender({ file: null })
    expect(result.current).toBeUndefined()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})
