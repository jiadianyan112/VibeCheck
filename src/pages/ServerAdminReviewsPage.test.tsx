import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ServerAdminReviewsPage } from './ServerAdminReviewsPage'

const calls = vi.hoisted(() => ({
  listPending: vi.fn(), claim: vi.fn(), preview: vi.fn(), confirm: vi.fn(), decide: vi.fn(), heartbeat: vi.fn(),
}))

vi.mock('../features', async (importOriginal) => ({
  ...await importOriginal<typeof import('../features')>(),
  useAuthSession: () => ({ session: { csrf_token: 'csrf', user_id: 'reviewer' } }),
}))
vi.mock('../services/reviewApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/reviewApi')>(),
  reviewApi: calls,
}))

beforeEach(() => {
  vi.clearAllMocks()
  const queued = {
    work_item_id: 'work-1', target_id: 'submission-1', work_item_status: 'queued', version: 1,
    domain_summary: { status: 'pending_review', version: 2, current_name: '真实待审作品' },
    created_at: '2026-09-27T00:00:00.000Z',
  }
  calls.listPending.mockResolvedValue([queued])
  calls.claim.mockResolvedValue({ ...queued, version: 2, claim_token: 'claim-token' })
  calls.preview.mockResolvedValue({ preview_token: 'preview-token', confirmation_summary_hash: 'summary-hash' })
  calls.confirm.mockResolvedValue({ confirm_token: 'confirm-token' })
  calls.decide.mockResolvedValue({ resulting_status: 'approved', project_id: null })
})

it('approves a database work item without requiring a reason and refreshes the queue', async () => {
  render(<ServerAdminReviewsPage />)
  expect(await screen.findByText('真实待审作品')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '通过' }))
  fireEvent.click(screen.getByRole('button', { name: '确认通过' }))
  await waitFor(() => expect(calls.decide).toHaveBeenCalledOnce())
  expect(screen.queryByText('邮箱再次确认')).not.toBeInTheDocument()
  expect(calls.preview).toHaveBeenCalledWith(expect.objectContaining({ work_item_id: 'work-1' }), expect.anything(), 'approve', 'submission_approved')
  expect(calls.confirm).toHaveBeenCalledWith(expect.objectContaining({ preview_token: 'preview-token' }), expect.anything(), null, expect.any(String))
  expect(calls.decide).toHaveBeenCalledWith(expect.anything(), 'preview-token', 'confirm-token', expect.anything(), 'approve', 'submission_approved', [], expect.any(String))
  expect(calls.listPending).toHaveBeenCalledTimes(2)
})
