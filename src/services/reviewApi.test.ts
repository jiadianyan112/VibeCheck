import { afterEach, expect, it, vi } from 'vitest'
import { reviewApi, type SubmissionWorkItem } from './reviewApi'
import type { AuthSessionDto } from './authService'

const session = { csrf_token: 'csrf-test' } as AuthSessionDto
const queued: SubmissionWorkItem = {
  work_item_id: 'review-1', target_id: 'submission-1', work_item_status: 'queued', version: 1,
  domain_summary: { status: 'pending_review', version: 3, current_name: '待发布作品' },
  created_at: '2026-09-27T00:00:00.000Z',
}

afterEach(() => vi.unstubAllGlobals())

it('uses the database review queue and carries submission and claim versions into the secured decision', async () => {
  const captured: Array<{ url: string; body: Record<string, unknown> | null; csrf: string | null }> = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    captured.push({ url, body, csrf: new Headers(init.headers).get('x-csrf-token') })
    if (url.includes('/work-items?')) return Promise.resolve(Response.json({ items: [queued], next_cursor: null }))
    if (url.endsWith('/claim')) return Promise.resolve(Response.json({ ...queued, version: 2, work_item_status: 'claimed', claim_token: 'x'.repeat(43) }))
    if (url.endsWith('/preview')) return Promise.resolve(Response.json({ preview_token: 'p'.repeat(43), confirmation_summary_hash: 'h'.repeat(64) }))
    if (url.endsWith('/confirm')) return Promise.resolve(Response.json({ confirm_token: 'c'.repeat(43) }))
    if (url.endsWith('/decision')) return Promise.resolve(Response.json({ review_decision_id: 'decision-1', resulting_status: 'approved', project_id: null }))
    throw new Error(`unexpected request ${url}`)
  }))

  const [item] = await reviewApi.listPending()
  expect(item?.domain_summary.current_name).toBe('待发布作品')
  const claimed = await reviewApi.claim(item!, session)
  const preview = await reviewApi.preview(claimed, session, 'approve', 'submission_approved')
  const confirmed = await reviewApi.confirm(preview, session, null, 'confirmation-1')
  await reviewApi.decide(claimed, preview.preview_token, confirmed.confirm_token, session, 'approve', 'submission_approved', [], 'decision-1')

  expect(captured[2]?.body).toMatchObject({
    operation_type: 'submission_review', expected_versions: { submission: 3, work_item: 2 },
    proposed_diff: { review_status: 'approved' },
  })
  expect(captured[4]?.body).toMatchObject({ decision: 'approve', expected_version: 2, claim_token: 'x'.repeat(43) })
  expect(captured.slice(1).every((request) => request.csrf === 'csrf-test')).toBe(true)
})
