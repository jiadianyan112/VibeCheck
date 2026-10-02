import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthGateProvider } from '../features/auth'
import { AppStateProvider } from '../state'
import { experienceApi, type Experience } from '../services/experienceApi'
import { ExperienceSection } from './ExperienceSection'

vi.mock('../services/experienceApi', () => ({
  ExperienceApiError: class extends Error {},
  experienceApi: {
    list: vi.fn(async () => ({ items: [], next_cursor: null })),
    create: vi.fn(), reply: vi.fn(), report: vi.fn(), screenshotUrl: vi.fn(),
  },
}))

const projectId = '10000000-0000-4000-8000-000000000001'

const firstExperience: Experience = {
  comment_id: 'experience-1',
  project_id: projectId,
  task: '批量整理课程资料',
  outcome: '生成练习集并发现一处格式问题',
  scenario: '适合固定格式教材',
  limitation: '复杂表格需要手工修正',
  screenshot_media_resource_ids: ['media-1', 'media-2'],
  author_label: '匿名体验者',
  author_reply: '感谢反馈，已修复格式问题。',
  author_reply_at: '2026-09-30T10:00:00.000Z',
  replies: [{
    comment_id: 'reply-1',
    body: '我也遇到过类似情况。',
    created_at: '2026-09-30T11:00:00.000Z',
    moderation_state: 'visible',
  }],
  created_at: '2026-09-30T09:00:00.000Z',
}

function renderSection() {
  return render(<MemoryRouter><AppStateProvider><AuthGateProvider><ExperienceSection projectId={projectId} /></AuthGateProvider></AppStateProvider></MemoryRouter>)
}

describe('ExperienceSection', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(experienceApi.list).mockResolvedValue({ items: [], next_cursor: null })
    vi.mocked(experienceApi.screenshotUrl).mockImplementation((experienceId, mediaId) => `/screenshots/${experienceId}/${mediaId}`)
  })

  it('requires task and result, and preserves a guest draft for login', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByRole('heading', { name: '实际体验' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发布实际体验' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写完成的任务')
    await user.type(screen.getByLabelText('完成的任务 *'), '整理课程资料')
    await user.click(screen.getByRole('button', { name: '发布实际体验' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写实际结果')
    await user.type(screen.getByLabelText('实际结果 *'), '生成练习集')
    await user.click(screen.getByRole('button', { name: '发布实际体验' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    expect(sessionStorage.getItem(`vibecheck-experience-draft:${projectId}`)).toContain('整理课程资料')
  })

  it('renders server supplied fields, author reply, discussion reply, and screenshot URLs', async () => {
    vi.mocked(experienceApi.list).mockResolvedValueOnce({ items: [firstExperience], next_cursor: null })
    const view = renderSection()

    const task = await screen.findByText(firstExperience.task)
    const card = task.closest('li')!
    expect(within(card).getByText(firstExperience.outcome)).toBeInTheDocument()
    expect(within(card).getByText(firstExperience.scenario!)).toBeInTheDocument()
    expect(within(card).getByText(firstExperience.limitation!)).toBeInTheDocument()
    expect(within(card).getByText(firstExperience.author_label)).toBeInTheDocument()
    expect(within(card).getByText(firstExperience.author_reply!)).toBeInTheDocument()
    expect(within(card).getByText(firstExperience.replies[0]!.body)).toBeInTheDocument()
    expect(card.querySelector('time')).toHaveAttribute('datetime', firstExperience.created_at)
    expect(screen.getByRole('img', { name: '体验截图 1' })).toHaveAttribute('src', '/screenshots/experience-1/media-1')
    expect(screen.getByRole('img', { name: '体验截图 2' })).toHaveAttribute('src', '/screenshots/experience-1/media-2')
    expect(view.container.querySelector('.experience-facts')).toHaveTextContent('完成任务')
    expect(view.container.querySelector('.experience-facts')).toHaveTextContent('实际结果')
  })

  it('loads the next page with the server cursor and appends its records', async () => {
    const secondExperience: Experience = { ...firstExperience, comment_id: 'experience-2', task: '复核导出的练习集', outcome: '确认题目顺序正确', screenshot_media_resource_ids: [] }
    vi.mocked(experienceApi.list).mockImplementation(async (_id, cursor = null) => cursor
      ? { items: [secondExperience], next_cursor: null }
      : { items: [firstExperience], next_cursor: 'page-2' })
    const user = userEvent.setup()
    renderSection()

    expect(await screen.findByText(firstExperience.task)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '加载更多体验' }))

    expect(await screen.findByText(secondExperience.task)).toBeInTheDocument()
    expect(screen.getByText(firstExperience.task)).toBeInTheDocument()
    expect(experienceApi.list).toHaveBeenNthCalledWith(1, projectId, null)
    expect(experienceApi.list).toHaveBeenNthCalledWith(2, projectId, 'page-2')
    expect(screen.queryByRole('button', { name: '加载更多体验' })).not.toBeInTheDocument()
  })

  it('restores a guest reply draft after the login gate and a remount', async () => {
    vi.mocked(experienceApi.list).mockResolvedValue({ items: [firstExperience], next_cursor: null })
    const user = userEvent.setup()
    const firstRender = renderSection()

    await screen.findByText(firstExperience.task)
    await user.click(screen.getByRole('button', { name: '讨论回复' }))
    const replyDraft = '登录后继续后再提交'
    await user.type(screen.getByRole('textbox', { name: '回复内容' }), replyDraft)
    await user.click(screen.getByRole('button', { name: '发送回复' }))

    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '回复内容' })).toHaveValue(replyDraft)
    expect(sessionStorage.getItem(`vibecheck-experience-draft:${projectId}:reply`)).toContain(replyDraft)

    firstRender.unmount()
    renderSection()
    expect(await screen.findByRole('textbox', { name: '回复内容' })).toHaveValue(replyDraft)
  })
})
