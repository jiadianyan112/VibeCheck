import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AboutPage } from './AboutPage'

describe('AboutPage', () => {
  it('explains scope, exclusions and non-commercial status boundaries', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '发现作品，也看懂它是怎么做的。' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '收录范围' })).toBeInTheDocument()
    expect(screen.getByText(/数量多不等于竞争激烈/)).toBeInTheDocument()
    expect(screen.getByText(/不代表收入、活跃度、质量或商业结果/)).toBeInTheDocument()
  })

  it('documents sources, submission, low-frequency verification and correction', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '来源与验证时间' })).toBeInTheDocument()
    expect(screen.getByText('平台直接核验')).toBeInTheDocument()
    expect(screen.getByText('作者发布')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '认领已有作品' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '提交纠错信息' })).toHaveAttribute('href', '/submit?mode=correction')
  })
})
