import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { PublishPage } from './PublishPage'
import { emptyPublishFields, type PublishSavedDraft } from '../features/submission/publishDraft'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn(), get: vi.fn() }))
vi.mock('../features/auth/AuthSessionContext', () => ({ useOptionalAuthSession: mocks.auth }))
vi.mock('../state', () => ({ useAppState: () => ({ dispatch: vi.fn() }) }))
vi.mock('../features/submission/publishDraft', async importOriginal => ({ ...await importOriginal<typeof import('../features/submission/publishDraft')>(), readPublishDraft: mocks.read, savePublishDraft: mocks.save }))
vi.mock('../services/submissionApi', async importOriginal => ({ ...await importOriginal<typeof import('../services/submissionApi')>(), submissionApi: { get: mocks.get } }))

function page(url = '/submit') { return <MemoryRouter initialEntries={[url]}><PublishPage /></MemoryRouter> }

beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ status: 'guest', session: null }); mocks.read.mockResolvedValue(undefined); mocks.save.mockResolvedValue(undefined) })

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
