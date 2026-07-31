import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'

function renderPage(path = '/compare/comparison-anonymous-pdf') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  return router
}

describe('CompareSessionPage management', () => {
  beforeEach(() => localStorage.clear())

  it('restores a routed session and exposes its stable share path', async () => {
    renderPage('/compare/comparison-mia-speaking')
    expect(await screen.findByRole('heading', { name: '比较会话' })).toBeInTheDocument()
    expect(screen.getByText('/compare/comparison-mia-speaking')).toBeInTheDocument()
    expect(screen.getByText('3/5 个作品')).toBeInTheDocument()
    expect(screen.getByText('已满足正式比较数量规则。')).toBeInTheDocument()
  })

  it('reorders, replaces, removes, adds and saves the current session', async () => {
    const user = userEvent.setup()
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('题练工坊')
    await user.click(screen.getByRole('button', { name: '下移题练工坊' }))
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('题练工坊')

    await user.click(within(list).getAllByRole('button', { name: '替换' })[0]!)
    await user.selectOptions(screen.getByLabelText(/替换/), 'project-papertopractice')
    expect(within(list).getByText('Paper to Practice')).toBeInTheDocument()

    await user.click(within(list).getAllByRole('button', { name: '移除' })[0]!)
    expect(screen.getByText('1/5 个作品')).toBeInTheDocument()
    expect(screen.getByText('至少选择两个作品，才能进入正式比较。')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('添加一个作品'), 'project-speakmirror')
    expect(screen.getByText('2/5 个作品')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存比较' }))
    expect(screen.getByText('比较会话已保存。')).toBeInTheDocument()
    expect(screen.getByText(/^已保存 ·/)).toBeInTheDocument()
  })

  it('offers a recovery path for an unknown session', async () => {
    renderPage('/compare/comparison-missing')
    expect(await screen.findByText('比较会话不存在')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回选择作品' })).toHaveAttribute('href', '/projects')
  })
})
