import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authorContentP0V1FieldPaths } from '@vibecheck/contracts'
import { developerReviewApi } from './developerReviewApi'
import type { AuthSessionDto } from './authService'

const session = { authenticated: true, user_id: '11111111-1111-4111-8111-111111111111', csrf_token: 'csrf-token' } as AuthSessionDto
const item = {
  work_item_id: '33333333-3333-4333-8333-333333333333',
  target_id: '44444444-4444-4444-8444-444444444444',
  work_item_status: 'queued' as const,
  version: 2,
  domain_summary: { status: 'pending' },
  created_at: '2026-10-08T00:00:00.000Z',
}

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

beforeEach(() => vi.restoreAllMocks())

describe('developerReviewApi', () => {
  it('lists only queued identity work items and follows cursors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ items: [item], next_cursor: 'next' }))
      .mockResolvedValueOnce(response({ items: [], next_cursor: null }))

    expect(await developerReviewApi.listPending()).toEqual([item])
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/admin/work-items?work_type=verification&status=queued')
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/admin/work-items?work_type=verification&status=queued&cursor=next')
  })

  it('builds verification preview and owner decision from the server policy snapshot', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ ...item, version: 3, claim_token: 'c'.repeat(43) }))
      .mockResolvedValueOnce(response({ viewer_schema: 'reviewer', verification_id: item.target_id, project_id: '55555555-5555-4555-8555-555555555555', creator_resolution_mode: 'claim_existing_creator', creator_account_link_id: null, target_creator_id: '88888888-8888-4888-8888-888888888888', new_creator_profile_input: null, requested_link_role: 'owner', link_policy_snapshot: { policy_version: 'creator_link.v1', target_creator_aggregate_version: 7, owner_link_set_version: 2, allowed_link_roles: ['owner'], default_link_role: 'owner', allowed_permission_profile_refs: [{ profile_id: 'OWNER_V1', profile_version: 1, config_hash: 'b'.repeat(64) }], observed_owner_link_id: null, observed_owner_link_version: null, reused_link_id: null, reused_link_version: null }, method: 'manual_material', public_summary: 'proof', material_ids: ['66666666-6666-4666-8666-666666666666'], evidence_refs: [], submission_revision: 1, status: 'pending', review_work_item_id: item.work_item_id, version: 4 }))
      .mockResolvedValueOnce(response({ preview_token: 'p'.repeat(43), confirmation_summary_hash: 'd'.repeat(64), conflict_principal_version: null }))
      .mockResolvedValueOnce(response({ confirm_token: 'f'.repeat(43) }))
      .mockResolvedValueOnce(response({ review_decision_id: '77777777-7777-4777-8777-777777777777', resulting_status: 'verified' }))

    const claimed = await developerReviewApi.claim(item, session)
    const detail = await developerReviewApi.getClaimedDetail(claimed, session)
    const preview = await developerReviewApi.preview(claimed, detail, session, 'approve', 'verification_approved')
    const confirmed = await developerReviewApi.confirm(preview, session, 'verification-confirm-0001')
    await developerReviewApi.decide(claimed, detail, preview.preview_token, confirmed.confirm_token, session, 'approve', 'verification_approved', 'verification-decision-0001')

    const previewBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string)
    const decisionBody = JSON.parse(fetchMock.mock.calls[4]![1]!.body as string)
    expect(previewBody).toMatchObject({ operation_type: 'verification_review', expected_versions: { verification_request: 4, work_item: 3 }, proposed_diff: { status: 'verified' } })
    expect(decisionBody.decision_payload).toMatchObject({ author_role: 'owner', approved_link_role: 'owner', approved_permission_profile_ref: { profile_id: 'OWNER_V1', profile_version: 1, config_hash: 'b'.repeat(64) }, policy_version: 'creator_link.v1' })
    expect(decisionBody.decision_payload.field_permissions).toEqual(authorContentP0V1FieldPaths)
    expect(fetchMock.mock.calls[1]![1]!.headers).toMatchObject({ 'x-review-claim-token': 'c'.repeat(43) })
  })

  it('omits approved link fields when the server will create or reuse the link', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ review_decision_id: '77777777-7777-4777-8777-777777777777', resulting_status: 'verified' }))
    const claimed = { ...item, work_item_status: 'claimed' as const, claim_token: 'c'.repeat(43) }
    const snapshot = { policy_version: 'creator_link.v1' as const, target_creator_aggregate_version: null, owner_link_set_version: null, allowed_link_roles: ['owner' as const], default_link_role: 'owner' as const, allowed_permission_profile_refs: [{ profile_id: 'OWNER_V1' as const, profile_version: 1 as const, config_hash: 'a'.repeat(64) }], observed_owner_link_id: null, observed_owner_link_version: null, reused_link_id: null, reused_link_version: null }

    for (const creator_resolution_mode of ['create_new_creator', 'use_existing_link'] as const) {
      const detail = { creator_resolution_mode, requested_link_role: creator_resolution_mode === 'create_new_creator' ? 'owner' : null, link_policy_snapshot: snapshot } as unknown as Parameters<typeof developerReviewApi.decide>[1]
      await developerReviewApi.decide(claimed, detail, 'p'.repeat(43), 'f'.repeat(43), session, 'approve', 'verification_approved')
    }

    const payloads = fetchMock.mock.calls.map(call => JSON.parse(call[1]!.body as string).decision_payload)
    expect(payloads).toHaveLength(2)
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty('approved_link_role')
      expect(payload).not.toHaveProperty('approved_permission_profile_ref')
      expect(payload).toMatchObject({ author_role: 'owner', policy_version: 'creator_link.v1' })
    }
  })

  it('blocks approving a legacy manager application from the owner-only UI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const claimed = { ...item, work_item_status: 'claimed' as const, claim_token: 'c'.repeat(43) }
    const snapshot = { policy_version: 'creator_link.v1' as const, target_creator_aggregate_version: 3, owner_link_set_version: 1, allowed_link_roles: ['owner', 'manager'] as const, default_link_role: 'manager' as const, allowed_permission_profile_refs: [{ profile_id: 'MANAGER_V1' as const, profile_version: 1 as const, config_hash: 'a'.repeat(64) }], observed_owner_link_id: null, observed_owner_link_version: null, reused_link_id: null, reused_link_version: null }
    const detail = { creator_resolution_mode: 'claim_existing_creator' as const, requested_link_role: 'manager' as const, link_policy_snapshot: snapshot } as unknown as Parameters<typeof developerReviewApi.decide>[1]

    expect(() => developerReviewApi.decide(claimed, detail, 'p'.repeat(43), 'f'.repeat(43), session, 'approve', 'verification_approved')).toThrow('LEGACY_MANAGER_APPROVAL_UNSUPPORTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
