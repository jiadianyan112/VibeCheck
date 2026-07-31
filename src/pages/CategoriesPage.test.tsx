import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'

describe('CategoriesPage', () => {
  beforeEach(() => localStorage.clear())

  it('renders all eight problem-led categories with fixture counts', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/categories'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    expect(await screen.findByRole('heading', { name: '按学习问题与练习场景探索' })).toBeInTheDocument()
    for (const name of ['AI 出题', 'PDF 转题库', '刷题', '模拟考试', '背词', '口语', '听写', '错题复习']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getAllByText('3 个作品').length).toBeGreaterThanOrEqual(2)
  })

  it('links every category to its topic detail and keeps technology secondary', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/categories'] })
    render(<AppProviders><RouterProvider router={router} /></AppProviders>)
    expect(await screen.findByRole('link', { name: '进入口语专题' })).toHaveAttribute('href', '/categories/speaking-practice')
    expect(screen.getByText(/技术栈只作为辅助标签/)).toBeInTheDocument()
    expect(screen.getAllByText('技术辅助标签：').length).toBeGreaterThan(0)
  })
})
