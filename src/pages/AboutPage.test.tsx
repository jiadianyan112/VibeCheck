import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AboutPage } from './AboutPage'

describe('AboutPage', () => {
  it('explains scope, exclusions and non-commercial status boundaries', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '作品社区在前，结构化项目档案在内。' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '首期收录范围' })).toBeInTheDocument()
    expect(screen.getByText(/数量多不自动意味着竞争激烈/)).toBeInTheDocument()
    expect(screen.getByText(/不等同收入、活跃度、质量或商业结果/)).toBeInTheDocument()
  })

  it('documents sources, submission, low-frequency verification and correction', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '来源与验证时间' })).toBeInTheDocument()
    expect(screen.getByText('平台建档')).toBeInTheDocument()
    expect(screen.getByText('作者提交新作品')).toBeInTheDocument()
    expect(screen.getByText(/低频的管理权限流程/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '提交纠错线索' })).toHaveAttribute('href', '/submit?mode=correction')
  })
})
