import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectUpdateApi, type ProjectUpdateProjection } from './projectUpdateApi'

const session = { csrf_token: 'csrf-token' }

const projection: ProjectUpdateProjection = {
  update_id: 'update-1', project_id: 'project-1', owner_user_id: 'user-1', origin_review_status: 'published_author',
  base_version_id: 'version-1', current_version_id: 'version-1', update_type: 'description', category_change_type: null,
  payload_diff: [], before_after: [], evidence_draft_ids: [], media_reference_ids: [],
  authorization_snapshot: {
    creator_account_link_id: 'link-1', creator_id: 'creator-1', author_relation_id: 'relation-1', permission_profile_id: 'OWNER_V1',
    permission_profile_version: 1, permission_profile_config_hash: 'a'.repeat(64), link_version: 1, author_relation_version: 1,
    capabilities: ['ownership.view', 'project_update.create', 'project_update.submit'], field_paths: [],
  },
  effective_capabilities: ['ownership.view', 'project_update.create', 'project_update.submit'], effective_field_paths: [],
  authorization_state: 'active', status: 'editing', review_work_item_id: null, apply_attempt_count: 0, version: 1,
  created_at: '2026-10-08T00:00:00.000Z', updated_at: '2026-10-08T00:00:00.000Z',
}

describe('projectUpdateApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('uses the exact create wire shape and CSRF cookie session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projection), { status: 201 }))

    await expect(projectUpdateApi.create({
      session, projectId: 'project-1', updateType: 'description', baseVersionId: 'version-1', clientRequestId: 'create-request-1',
    })).resolves.toEqual(projection)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/project-updates', expect.objectContaining({
      method: 'POST', credentials: 'include',
      headers: expect.objectContaining({ 'content-type': 'application/json', 'x-csrf-token': 'csrf-token' }),
      body: JSON.stringify({ project_id: 'project-1', update_type: 'description', base_version_id: 'version-1', client_request_id: 'create-request-1' }),
    }))
  })

  it('sends server preview and submit tokens without inventing evidence', async () => {
    const preview = { update_id: 'update-1', version: 2, preview_hash: 'b'.repeat(64), base_version_id: 'version-1', current_version_id: 'version-1', before_after: [], authorization_snapshot: projection.authorization_snapshot, validation: { ready_for_submit: true, changed_field_count: 1, evidence_draft_count: 0, media_reference_count: 0 } }
    const submit = { update_id: 'update-1', status: 'update_pending' as const, version: 3, review_work_item_id: 'work-1', work_item_status: 'queued' as const, submitted_at: '2026-10-08T00:00:00.000Z' }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(submit), { status: 202 }))

    await expect(projectUpdateApi.preview({ session, updateId: 'update-1', expectedVersion: 2 })).resolves.toEqual(preview)
    await expect(projectUpdateApi.submit({ session, updateId: 'update-1', version: 2, previewHash: preview.preview_hash, submissionKey: 'submit-request-1' })).resolves.toEqual(submit)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ expected_version: 2 })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ version: 2, preview_hash: preview.preview_hash, submission_key: 'submit-request-1' })
  })

  it('sends an explicit withdrawal receipt request with the expected version', async () => {
    const withdrawal = { update_id: 'update-1', from_status: 'update_pending' as const, status: 'withdrawn' as const, version: 4, review_work_item_id: null, work_item_status: 'cancelled' as const, withdrawn_at: '2026-10-08T00:00:00.000Z' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(withdrawal), { status: 200 }))

    await expect(projectUpdateApi.withdraw({ session, updateId: 'update-1', expectedVersion: 3, operationId: 'withdraw-request-1', reasonCode: 'owner_cancelled' })).resolves.toEqual(withdrawal)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ expected_version: 3, operation_id: 'withdraw-request-1', reason_code: 'owner_cancelled' })
  })
})
