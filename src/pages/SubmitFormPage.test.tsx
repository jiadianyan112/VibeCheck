import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { configureServiceRuntime } from '../services'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import { submissionDraftId, type SubmissionDraft } from '../types'

const draftId = submissionDraftId('draft-t38-form')

function seedDraft() {
  let state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[0]! })
  const draft: SubmissionDraft = {
    id: draftId,
    userId: prototypeUsers[0]!.id,
    status: 'draft',
    step: 'prefill',
    fields: { publicUrl: 'https://example.test/t38-tool' },
    originalExtraction: { publicUrl: 'https://example.test/t38-tool' },
    assetIds: [],
    duplicateProjectId: null,
    validationErrors: {},
    reviewMessages: {},
    createdAt: '2026-07-31T10:00:00+08:00',
    updatedAt: '2026-07-31T10:00:00+08:00',
    submittedAt: null,
  }
  state = appReducer(state, { type: 'DRAFT_UPSERT', draft })
  persistAppState(state)
}

function renderForm(step: string = 'prefill') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/submit/new?draft=${draftId}&step=${step}`] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedDraft(): SubmissionDraft {
  const state = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!)
  return state.submissionDrafts.find((draft: SubmissionDraft) => draft.id === draftId)
}

describe('new project multi-step submission form', () => {
  beforeEach(() => {
    localStorage.clear()
    configureServiceRuntime({ defaultDelayMs: 0 })
    seedDraft()
  })

  it('supports correction, required validation, optional skips and a complete saved draft', async () => {
    const user = userEvent.setup()
    renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    expect(name).toHaveValue('自动提取的作品名称')
    expect(screen.getByText(/名称原始提取：/).closest('p')).toHaveTextContent('自动提取的作品名称')
    await user.clear(name)
    await user.type(name, '五分钟发布测试')
    await user.clear(screen.getByRole('textbox', { name: '截图地址（可跳过）' }))
    await user.type(screen.getByRole('textbox', { name: '截图地址（可跳过）' }), 'https://example.test/changed-cover.png')
    await user.selectOptions(screen.getByRole('combobox', { name: '基础访问状态（必填）' }), 'login_required')
    await user.click(screen.getByRole('button', { name: '保存并继续' }))

    expect(await screen.findByRole('heading', { name: '产品定义' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(await screen.findByText('至少选择一个目标用户。')).toBeInTheDocument()
    expect(screen.getByText('请填写要解决的核心问题。')).toBeInTheDocument()
    expect(screen.getByText('至少选择一个使用场景。')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '大学生' }))
    await user.type(screen.getByRole('textbox', { name: '核心问题（必填）' }), '把 PDF 学习材料快速转成练习')
    await user.click(screen.getByRole('checkbox', { name: '生成题目' }))
    await user.click(screen.getByRole('button', { name: '保存并继续' }))

    expect(await screen.findByRole('heading', { name: '方案与功能' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'PDF' }))
    await user.click(screen.getByRole('checkbox', { name: '题目' }))
    await user.type(screen.getByRole('textbox', { name: '核心流程（必填，每行一步）' }), '上传材料\n生成练习\n查看反馈')
    await user.click(screen.getByRole('button', { name: '保存并继续' }))

    expect(await screen.findByRole('heading', { name: '开发与资产' })).toBeInTheDocument()
    expect(screen.getByText('100%', { selector: '.submission-percent' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Codex/ }))
    await user.click(screen.getByRole('checkbox', { name: /PDF 题库页面模板/ }))
    await user.click(screen.getByRole('button', { name: '保存完整草稿' }))
    expect(await screen.findByText('结构化草稿已保存')).toBeInTheDocument()

    await waitFor(() => expect(persistedDraft()).toMatchObject({
      step: 'development',
      fields: {
        currentName: '五分钟发布测试',
        screenshotUrl: 'https://example.test/changed-cover.png',
        accessStatus: 'login_required',
        targetUsers: ['university_students'],
        useScenarios: ['question_generation'],
        mainInputs: ['pdf'],
        mainOutputs: ['questions'],
        aiCodingTools: ['codex'],
      },
    }))
    expect(persistedDraft().originalExtraction.currentName).toBe('自动提取的作品名称')
    expect(persistedDraft().assetIds).toContain('asset-pdfquiz-template')
  })

  it('restores corrected automatic fields after an unmount and direct cross-page return', async () => {
    const user = userEvent.setup()
    const first = renderForm()
    const name = await screen.findByRole('textbox', { name: '作品名称' })
    await user.clear(name)
    await user.type(name, '刷新后仍保留')
    await waitFor(() => expect(persistedDraft().fields.currentName).toBe('刷新后仍保留'))
    first.unmount()

    renderForm()
    expect(await screen.findByRole('textbox', { name: '作品名称' })).toHaveValue('刷新后仍保留')
    expect(screen.getByText(/名称原始提取：/).closest('p')).toHaveTextContent('自动提取的作品名称')
  })
})
