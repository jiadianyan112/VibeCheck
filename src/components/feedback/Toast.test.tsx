import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ToastProvider, useToast } from './Toast'

function ToastControls() {
  const { pushToast } = useToast()
  return <>
    <button onClick={() => pushToast('操作成功', 'success')}>成功</button>
    <button onClick={() => pushToast('操作失败', 'error')}>失败</button>
  </>
}

afterEach(() => vi.useRealTimers())

it('automatically closes success messages and leaves errors visible longer', () => {
  vi.useFakeTimers()
  render(<ToastProvider><ToastControls /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: '成功' }))
  fireEvent.click(screen.getByRole('button', { name: '失败' }))

  act(() => vi.advanceTimersByTime(5000))
  expect(screen.queryByText('操作成功')).not.toBeInTheDocument()
  expect(screen.getByText('操作失败')).toBeInTheDocument()

  act(() => vi.advanceTimersByTime(3000))
  expect(screen.queryByText('操作失败')).not.toBeInTheDocument()
})

it('allows a message to be closed manually', () => {
  vi.useFakeTimers()
  render(<ToastProvider><ToastControls /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: '成功' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
  expect(screen.queryByText('操作成功')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(5000))
  expect(screen.queryByText('操作成功')).not.toBeInTheDocument()
})
