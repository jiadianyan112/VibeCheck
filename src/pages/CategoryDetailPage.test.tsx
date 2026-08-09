import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AuthGateProvider, ComparisonProvider } from '../features'
import { AppStateProvider } from '../state'
import { CategoryDetailPage } from './CategoryDetailPage'

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前查询">{location.search}</output>
}

function renderTopic(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider><ToastProvider><AuthGateProvider><ComparisonProvider>
        <Routes><Route path="/categories/:slug" element={<><CategoryDetailPage /><LocationProbe /></>} /></Routes>
      </ComparisonProvider></AuthGateProvider></ToastProvider></AppStateProvider>
    </MemoryRouter>,
  )
}

describe('CategoryDetailPage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('renders complete PDF topic data from structured fields', async () => {
    renderTopic('/categories/pdf-to-quiz')
    expect(await screen.findByRole('heading', { name: '把 PDF 讲义或试卷转换为题库' })).toBeInTheDocument()
    expect(screen.getByText('直接解析文字 PDF')).toBeInTheDocument()
    expect(screen.getByText('OCR 处理扫描 PDF')).toBeInTheDocument()
    expect(screen.getByText('3 个结果')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '复用资产' })).toBeInTheDocument()
  })

  it('updates URL filters and result count without losing topic state', async () => {
    const user = userEvent.setup()
    renderTopic('/categories/pdf-to-quiz')
    await screen.findByText('3 个结果')
    await user.selectOptions(screen.getByLabelText('材料输入'), 'image')
    expect(screen.getByText('1 个结果')).toBeInTheDocument()
    expect(screen.getByLabelText('当前查询')).toHaveTextContent('input=image')
    expect(screen.getByRole('link', { name: 'Paper to Practice' })).toBeInTheDocument()
  })

  it('renders the speaking topic and handles an unknown slug', async () => {
    const view = renderTopic('/categories/speaking-practice')
    expect(await screen.findByRole('heading', { name: '练习口语表达并获得结构化反馈' })).toBeInTheDocument()
    view.unmount()
    renderTopic('/categories/not-real')
    expect(screen.getByRole('heading', { name: '未找到该专题' })).toBeInTheDocument()
  })

  it('renders portfolio-specific groups and filters without learning fields', async () => {
    const user = userEvent.setup()
    renderTopic('/categories/personal-sites-portfolios')
    expect(await screen.findByRole('heading', { name: '从身份、内容结构、视觉和实现方式寻找建站参考' })).toBeInTheDocument()
    expect(screen.getByText('26 个结果')).toBeInTheDocument()
    expect(screen.getByLabelText('策展子群')).toBeInTheDocument()
    expect(screen.getByLabelText('网站类型')).toBeInTheDocument()
    expect(screen.queryByLabelText('材料输入')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('策展子群'), '开发者')
    expect(screen.getByText('4 个结果')).toBeInTheDocument()
    expect(screen.getByLabelText('当前查询')).toHaveTextContent('group=%E5%BC%80%E5%8F%91%E8%80%85')
  })
})
