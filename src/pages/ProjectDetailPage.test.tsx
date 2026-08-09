import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../components'
import { AuthGateProvider, ComparisonProvider } from '../features'
import { AppStateProvider } from '../state'
import { ProjectDetailPage } from './ProjectDetailPage'

function renderProject(id: string) {
  return render(<MemoryRouter initialEntries={[`/project/${id}`]}><AppStateProvider><ToastProvider><AuthGateProvider><ComparisonProvider><Routes><Route path="/project/:id" element={<ProjectDetailPage />} /></Routes></ComparisonProvider></AuthGateProvider></ToastProvider></AppStateProvider></MemoryRouter>)
}

describe('ProjectDetailPage hero', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('shows current status, verification time and verified creator above the fold', async () => {
    renderProject('project-quizforge')
    expect(await screen.findByRole('heading', { name: '题练工坊' })).toBeInTheDocument()
    expect(screen.getAllByText('正常可访问').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/核验于 2026年7月28日/).length).toBeGreaterThan(0)
    expect(screen.getByText('已关联验证作者')).toBeInTheDocument()
    expect(screen.getByText('林序 · 已验证')).toBeInTheDocument()
  })

  it('guards the external experience link before leaving the prototype', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    await user.click(await screen.findByRole('button', { name: '立即体验 ↗' }))
    expect(screen.getByRole('dialog', { name: '即将离开 VibeCheck' })).toBeInTheDocument()
    expect(screen.getByText('目标站点：example.test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '继续访问' })).toHaveAttribute('target', '_blank')
  })

  it('keeps the unlinked author claim secondary to core actions', async () => {
    renderProject('project-pdfquizlab')
    expect(await screen.findByText('尚未关联作者')).toBeInTheDocument()
    expect(screen.getByText('平台编辑收录')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '我是作者，申请关联' })).toHaveClass('weak-link')
    expect(screen.getByLabelText('作品核心操作')).toContainElement(screen.getByRole('button', { name: '收藏' }))
  })

  it('routes protected collection through login while sharing remains available', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    await user.click(await screen.findByRole('button', { name: '收藏' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭弹层' }))
    await user.click(screen.getByRole('button', { name: '分享' }))
    expect(screen.getByText('已准备分享：题练工坊 · VibeCheck')).toBeInTheDocument()
  })

  it('toggles collection directly without opening follow settings', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    await user.click(await screen.findByRole('button', { name: '收藏' }))
    await user.click(screen.getByRole('button', { name: /米娅/ }))
    const cancel = await screen.findByRole('button', { name: '取消收藏' })
    expect(cancel).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('收藏设置')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关注更新' })).not.toBeInTheDocument()
    await user.click(cancel)
    expect(screen.getByRole('button', { name: '收藏' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('ProjectDetailPage structured profile', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('renders product fields in design order with a unified four-node flow', async () => {
    renderProject('project-quizforge')
    expect(await screen.findByRole('heading', { name: '产品结构' })).toBeInTheDocument()
    const labels = screen.getAllByRole('term').map((element) => element.textContent)
    expect(labels.slice(0, 8)).toEqual(['目标用户', '核心问题', '使用场景', '主要输入', '主要输出', '核心功能', '登录要求', '分享能力'])
    expect(screen.getByText('材料输入')).toBeInTheDocument()
    expect(screen.getByText('内容处理')).toBeInTheDocument()
    expect(screen.getByText('完成练习')).toBeInTheDocument()
    expect(screen.getByText('反馈与记录')).toBeInTheDocument()
    const similar = screen.getByRole('link', { name: '查找相似作品' })
    expect(similar).toHaveAttribute('href', expect.stringContaining('scenario=question_generation'))
    expect(similar).toHaveAttribute('href', expect.stringContaining('input=pdf'))
  })

  it('renders PortfolioSchema fields for a portfolio without showing learning structure', async () => {
    renderProject('project-atlas-home')
    expect(await screen.findByRole('heading', { name: 'Atlas Home' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '定位与内容结构' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '项目展示与 Case Study' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '视觉与交互' })).toBeInTheDocument()
    expect(screen.getByText('个人主页', { selector: '.tag' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '产品结构' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查找相似作品' })).toHaveAttribute('href', expect.stringContaining('category=personal_site_portfolio'))
    expect(screen.getAllByRole('button', { name: /展开本作品证据/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /网站类型来源/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /AI 编程工具来源/ })).not.toBeInTheDocument()
  })

  it('marks unknown development fields with their recorded reasons', async () => {
    renderProject('project-learntrack')
    expect(await screen.findByRole('heading', { name: '开发信息' })).toBeInTheDocument()
    expect(screen.getByText('未知：公开页面未说明使用的模型')).toBeInTheDocument()
    expect(screen.getByText('未知：未发现可验证的技术栈信息')).toBeInTheDocument()
    expect(screen.getByText('未知：作者未公开开发周期')).toBeInTheDocument()
  })

  it('uses one consolidated project evidence entry instead of field-level sources', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    const evidenceEntries = await screen.findAllByRole('button', { name: /展开本作品证据/ })
    expect(evidenceEntries).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '核心问题来源（1）' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '核心流程来源（1）' })).not.toBeInTheDocument()
    await user.click(evidenceEntries[0]!)
    expect(screen.getByRole('dialog', { name: '事实来源与核验记录' })).toBeInTheDocument()
    expect(screen.getByText('公开页面可访问并展示 PDF 生成题目流程。')).toBeInTheDocument()
  })
})

describe('ProjectDetailPage lifecycle, assets and relations', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('keeps reusable assets available after a product has ended', async () => {
    renderProject('project-echoscore')
    expect(await screen.findByRole('heading', { name: 'EchoScore' })).toBeInTheDocument()
    expect(screen.getAllByText('已结束').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: '复用资产' })).toBeInTheDocument()
    expect(screen.getByText('录音波形与回放组件')).toBeInTheDocument()
    expect(screen.getByText(/作品停止维护后，公开的代码、模板或组件仍可能继续使用/)).toBeInTheDocument()
  })

  it('shows old and pending new addresses for a suspected migration', async () => {
    renderProject('project-dictaflow')
    expect(await screen.findByText('疑似迁移，身份尚待确认')).toBeInTheDocument()
    expect(screen.getByText('旧地址：https://example.test/old/dictaflow')).toBeInTheDocument()
    expect(screen.getByText(/待确认新地址：https:\/\/example\.test\/products\/project-dictaflow/)).toBeInTheDocument()
  })

  it('renders addressable timeline events with source and before-after changes', async () => {
    renderProject('project-quizforge')
    expect(await screen.findByRole('heading', { name: '作品时间线' })).toBeInTheDocument()
    const event = document.getElementById('event-quizforge-v11')
    expect(event).not.toBeNull()
    expect(event).toHaveTextContent('已验证作者声明')
    expect(event).toHaveTextContent('之前：选择题')
    expect(event).toHaveTextContent('之后：选择题、简答题、答案解析')
  })

  it('shows relation type, direction and confirmation beside recommendations', async () => {
    renderProject('project-speakmirror')
    expect(await screen.findByRole('heading', { name: '相关作品' })).toBeInTheDocument()
    expect(screen.getByText('替代')).toBeInTheDocument()
    expect(screen.getByText('平台确认')).toBeInTheDocument()
    expect(screen.getAllByText('复用资产').length).toBeGreaterThan(1)
    expect(screen.getByText('一方确认')).toBeInTheDocument()
    expect(screen.getByText('OralExam AI')).toBeInTheDocument()
    expect(screen.getByText('EchoScore')).toBeInTheDocument()
  })
})

describe('ProjectDetailPage discussion interactions', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('only renders comments bound to the current project and treats likes as weak signals', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    expect(await screen.findByRole('heading', { name: '作品讨论' })).toBeInTheDocument()
    expect(screen.getByText('PDF 章节较长时，先拆成小节再生成题目更容易检查。')).toBeInTheDocument()
    expect(screen.queryByText('分项评分在短录音场景下是否也使用相同权重？')).not.toBeInTheDocument()
    expect(screen.getByLabelText('社区互动')).toHaveTextContent('点赞')
    await user.click(screen.getByRole('button', { name: '点赞' }))
    expect(screen.getByRole('button', { name: '已点赞' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('restores a guest comment body and category after login', async () => {
    const user = userEvent.setup(); renderProject('project-papertopractice')
    await screen.findByRole('heading', { name: '作品讨论' })
    expect(screen.getByText('还没有人讨论这个作品')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('评论类别'), 'development_question')
    await user.type(screen.getByLabelText('评论内容'), 'OCR 超时时是否会保留已经识别的段落？')
    await user.click(screen.getByRole('button', { name: '发布评论' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    expect(screen.getByLabelText('评论内容')).toHaveValue('OCR 超时时是否会保留已经识别的段落？')
    await user.click(screen.getByRole('button', { name: /米娅/ }))
    const posted = await screen.findByText('OCR 超时时是否会保留已经识别的段落？')
    expect(within(posted.closest('.comment-card') as HTMLElement).getByText('开发问题')).toBeInTheDocument()
    expect(screen.getByLabelText('评论内容')).toHaveValue('')
  })

  it('keeps reported history visible and allows a structured reply target', async () => {
    const user = userEvent.setup(); renderProject('project-quizforge')
    const body = await screen.findByText('PDF 章节较长时，先拆成小节再生成题目更容易检查。')
    const card = body.closest('.comment-card') as HTMLElement
    await user.click(within(card).getByRole('button', { name: '回复' }))
    expect(screen.getByRole('heading', { name: '回复评论' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: '举报' }))
    expect(screen.getByText('举报已记录，评论历史保留并进入审核。')).toBeInTheDocument()
    expect(screen.getByText('PDF 章节较长时，先拆成小节再生成题目更容易检查。')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '已举报审核中' })).toBeInTheDocument()
  })

  it('collapses the fixed malicious example without deleting it', async () => {
    renderProject('project-pdfquizlab')
    const summary = await screen.findByText('该评论因与作品无关而折叠')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(summary.closest('.comment-card')).toHaveTextContent('3 次举报记录')
  })
})

describe('ProjectDetailPage trust variants', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it.each([
    ['project-pdfquizlab', '尚未关联验证作者'],
    ['project-papertopractice', '部分流程异常，其他事实仍保留'],
    ['project-dictaflow', '新地址身份等待确认'],
    ['project-mocksprint', '暂停更新不等于失败'],
    ['project-echoscore', '作品已结束，不等于失败'],
  ])('opens %s as a fixed trust-state URL', async (id, expected) => {
    renderProject(id)
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('keeps an expired unknown project visible with reduced-trust language', async () => {
    renderProject('project-learntrack')
    expect(await screen.findByText('没有足够证据确认当前可用性')).toBeInTheDocument()
    expect(screen.getByText('未知不是异常或失败；历史记录仍可查看。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '产品结构' })).toBeInTheDocument()
    expect(screen.queryByText(/作品失败/)).not.toBeInTheDocument()
  })

  it('holds the original public status during a first anomaly check', async () => {
    renderProject('project-quizforge?variant=first-anomaly')
    expect(await screen.findByText('首次异常验证中')).toBeInTheDocument()
    expect(screen.getByText('维持原公开状态：normal')).toBeInTheDocument()
    expect(screen.getAllByText('正常可访问').length).toBeGreaterThan(0)
  })

  it('places disputed sources and their update times side by side', async () => {
    renderProject('project-dictaflow?variant=disputed')
    expect(await screen.findByText('争议并列来源')).toBeInTheDocument()
    expect(screen.getByText('平台核验记录')).toBeInTheDocument()
    expect(screen.getByText('提交方补充说明')).toBeInTheDocument()
    expect(screen.getByText('2026/7/30 18:00 更新')).toBeInTheDocument()
    expect(screen.getByText('核查完成前不选择性覆盖')).toBeInTheDocument()
  })

  it('exposes supplement, report and evidence entry points', async () => {
    renderProject('project-quizforge')
    expect(await screen.findByRole('link', { name: '补充作品信息' })).toHaveAttribute('href', '/submit?mode=supplement&project=project-quizforge')
    expect(screen.getByText('报告状态问题')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /展开本作品证据/ })).toBeInTheDocument()
  })
})
