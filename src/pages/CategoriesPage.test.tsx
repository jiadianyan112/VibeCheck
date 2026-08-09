import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'

describe('CategoriesPage', () => {
  beforeEach(() => localStorage.clear())

  it('keeps all eight learning topics and adds the portfolio category', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/categories'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    expect(await screen.findByRole('heading', { name: '选择品类，再寻找同类参考' })).toBeInTheDocument()
    for (const name of ['个人主页与作品集', 'AI 出题', 'PDF 转题库', '刷题', '模拟考试', '背词', '口语', '听写', '错题复习']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByText('26 个作品')).toBeInTheDocument()
    expect(screen.getAllByText('3 个作品').length).toBeGreaterThanOrEqual(2)
  })

  it('links every category to its topic detail and keeps technology secondary', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/categories'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    expect(await screen.findByRole('link', { name: '进入口语专题' })).toHaveAttribute('href', '/categories/speaking-practice')
    expect(screen.getByText(/AI 学习与题库保持原有问题专题/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '进入个人主页与作品集专题' })).toHaveAttribute('href', '/categories/personal-sites-portfolios')
    expect(screen.getAllByText('常用构建工具：').length).toBeGreaterThan(0)
  })
})
