import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { PublishPage } from './PublishPage'
import { emptyPublishFields, type PublishSavedDraft } from '../features/submission/publishDraft'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn(), get: vi.fn(), check: vi.fn(), create: vi.fn(), patch: vi.fn(), preview: vi.fn(), submit: vi.fn(), uploadCover: vi.fn(), ensureCoverReference: vi.fn(), createCoverReference: vi.fn(), removeCoverReferences: vi.fn() }))
vi.mock('../features/auth/AuthSessionContext', () => ({ useOptionalAuthSession: mocks.auth }))
vi.mock('../state', () => ({ useAppState: () => ({ dispatch: vi.fn() }) }))
vi.mock('../features/submission/publishDraft', async importOriginal => ({ ...await importOriginal<typeof import('../features/submission/publishDraft')>(), readPublishDraft: mocks.read, savePublishDraft: mocks.save }))
vi.mock('../services/submissionApi', async importOriginal => ({ ...await importOriginal<typeof import('../services/submissionApi')>(), remoteDraftToLocalDraft: () => ({ fields: {}, assetIds: [] }), submissionApi: { get: mocks.get, check: mocks.check, create: mocks.create, patch: mocks.patch, preview: mocks.preview, submit: mocks.submit } }))
vi.mock('../services/submissionAssetsApi', () => ({ submissionAssetsApi: { uploadCover: mocks.uploadCover, ensureCoverReference: mocks.ensureCoverReference, createCoverReference: mocks.createCoverReference, removeCoverReferences: mocks.removeCoverReferences } }))

function page(url = '/submit') { return <MemoryRouter initialEntries={[url]}><PublishPage /></MemoryRouter> }

beforeEach(() => { vi.clearAllMocks(); URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn(); mocks.auth.mockReturnValue({ status: 'guest', session: null }); mocks.read.mockResolvedValue(undefined); mocks.save.mockResolvedValue(undefined) })

it('waits for authentication before reading a guest draft', async () => {
  mocks.auth.mockReturnValue({ status: 'loading', session: null })
  const view = render(page())
  expect(screen.getByText('正在恢复草稿…')).toBeInTheDocument()
  expect(mocks.read).not.toHaveBeenCalled()
  mocks.auth.mockReturnValue({ status: 'guest', session: null })
  view.rerender(page())
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('guest'))
})

it('prefills category and resume URL without forcing link checks for guests', async () => {
  render(page('/submit?category=personal_site_portfolio&resumeUrl=https%3A%2F%2Fexample.com'))
  await waitFor(() => expect(screen.getByLabelText('作品链接 *')).toHaveValue('https://example.com'))
  expect(screen.getByLabelText('作品分类 *')).toHaveValue('personal_site_portfolio')
})

it('does not request a legacy local draft identifier from the API', async () => {
  mocks.auth.mockReturnValue({ status: 'authenticated', session: { user_id: 'user-a' } })
  render(page('/submit?draft=local-draft-123'))
  await waitFor(() => expect(screen.queryByText('正在恢复草稿…')).not.toBeInTheDocument())
  expect(mocks.get).not.toHaveBeenCalled()
})

it('claims a guest draft once and clears fields when another account opens the editor', async () => {
  const stored = new Map<string, PublishSavedDraft>([['guest', { fields: { ...emptyPublishFields, name: 'Guest work' }, images: [] }]])
  mocks.read.mockImplementation(async (key: string) => stored.get(key))
  mocks.save.mockImplementation(async (key: string, value: PublishSavedDraft) => { stored.set(key, value) })
  mocks.auth.mockReturnValue({ status: 'authenticated', session: { user_id: 'user-a' } })
  const view = render(page())
  await waitFor(() => expect(screen.getByLabelText('作品名称 *')).toHaveValue('Guest work'))
  expect(stored.get('guest')?.ownerId).toBe('user-a')
  mocks.auth.mockReturnValue({ status: 'authenticated', session: { user_id: 'user-b' } })
  view.rerender(page())
  await waitFor(() => expect(screen.getByLabelText('作品名称 *')).toHaveValue(''))
  expect(stored.get('user-b')).toBeUndefined()
})

it('waits for a pending cover scan and submits on the first click', async () => {
  const draftId = '11111111-1111-4111-8111-111111111111'
  const mediaId = '22222222-2222-4222-8222-222222222222'
  const referenceId = '33333333-3333-4333-8333-333333333333'
  const session = { user_id: '44444444-4444-4444-8444-444444444444' }
  const image = { id: 'image-1', file: new File(['image'], 'cover.png', { type: 'image/png' }) }
  const fields = { ...emptyPublishFields, name: '作品', summary: '作品简介', url: 'https://example.com/', category: 'ai_learning_quiz' as const }
  const draft = { draft_id: draftId, category_id: 'ai_learning_quiz', check_id: 'check-1', fields: { publicUrl: fields.url }, media_reference_ids: [], payload_snapshot: {}, version: 1, status: 'editing' }
  mocks.auth.mockReturnValue({ status: 'authenticated', session })
  mocks.read.mockResolvedValue({ fields, images: [image], ownerId: session.user_id, remoteId: draftId })
  mocks.get.mockResolvedValue(draft)
  mocks.check.mockResolvedValue({ normalizedUrl: fields.url, checks: [], duplicateProjectId: null, canCreateDraft: true, checkId: 'check-1', categoryId: fields.category })
  mocks.uploadCover.mockResolvedValue({ status: 'pending', media: { media_resource_id: mediaId } })
  const reference = { media_reference_id: referenceId }
  mocks.ensureCoverReference.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'ready', reference })
  mocks.createCoverReference.mockRejectedValue(new Error('媒体仍在安全处理中，不能创建封面引用。'))
  mocks.removeCoverReferences.mockResolvedValue(undefined)
  mocks.patch.mockResolvedValue({ ...draft, version: 2, media_reference_ids: [referenceId] })
  mocks.preview.mockResolvedValue({ previewHash: 'preview-hash' })
  mocks.submit.mockResolvedValue({ submissionId: 'submission-1', reviewWorkItemId: 'work-1' })

  render(page())
  await waitFor(() => expect(screen.getByLabelText('作品名称 *')).toHaveValue('作品'))
  fireEvent.click(screen.getAllByRole('button', { name: '提交审核' })[0]!)
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1), { timeout: 4000 })
  expect(mocks.ensureCoverReference).toHaveBeenCalledTimes(2)
  expect(mocks.ensureCoverReference).toHaveBeenCalledWith(expect.objectContaining({
    replaceAtSortOrder: true,
    sortOrder: 0,
    replacementOperationId: expect.any(Function),
  }))
  expect(mocks.removeCoverReferences).toHaveBeenCalledWith(expect.objectContaining({ draftId, keepIds: [referenceId] }))
  expect(mocks.createCoverReference).not.toHaveBeenCalled()
  expect(screen.queryByText(/第 1 张图片未就绪/)).not.toBeInTheDocument()
})

it('uses a fresh URL check with the same remote draft before previewing and submitting', async () => {
  const draftId = '11111111-1111-4111-8111-111111111111'
  const session = { user_id: '44444444-4444-4444-8444-444444444444' }
  const fields = { ...emptyPublishFields, name: '作品', summary: '作品简介', url: 'https://example.com/', category: 'ai_learning_quiz' as const }
  const oldDraft = { draft_id: draftId, category_id: fields.category, check_id: 'old-check', fields: { publicUrl: fields.url }, media_reference_ids: [], payload_snapshot: {}, version: 4, status: 'editing' }
  const patched = { ...oldDraft, version: 5 }
  mocks.auth.mockReturnValue({ status: 'authenticated', session })
  mocks.read.mockResolvedValue({ fields, images: [], ownerId: session.user_id, remoteId: draftId, pendingSubmission: { draftId, draftVersion: 4, checkId: 'old-check', previewHash: 'old-preview', submissionKey: 'old-submission' } })
  mocks.get.mockResolvedValueOnce(oldDraft).mockResolvedValueOnce(oldDraft).mockResolvedValueOnce(oldDraft).mockResolvedValueOnce(patched)
  mocks.check.mockResolvedValue({ normalizedUrl: fields.url, checks: [], duplicateProjectId: null, canCreateDraft: true, checkId: 'new-check', categoryId: fields.category })
  mocks.patch.mockResolvedValue(patched)
  mocks.preview.mockResolvedValue({ previewHash: 'preview-hash' })
  mocks.submit.mockResolvedValue({ submissionId: 'submission-1', reviewWorkItemId: 'work-1' })

  render(page(`/submit?draft=${draftId}`))
  await waitFor(() => expect(screen.getByLabelText('作品名称 *')).toHaveValue('作品'))
  fireEvent.click(screen.getAllByRole('button', { name: '提交审核' })[0]!)
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ draftId, expectedVersion: 5, checkId: 'new-check' }))
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ draftId, draftVersion: 5, checkId: 'new-check' }))
  expect(screen.queryByText(/内容已在其他位置更新/)).not.toBeInTheDocument()
})

it('uses the styled button for retrying a failed image', async () => {
  const image = { id: 'image-1', file: new File(['image'], 'cover.png', { type: 'image/png' }), error: '安全检查失败' }
  mocks.read.mockResolvedValue({ fields: { ...emptyPublishFields }, images: [image] })
  render(page())
  const retry = await screen.findByRole('button', { name: '重试这张图片' })
  expect(retry).toHaveClass('button', 'button--secondary')
})
