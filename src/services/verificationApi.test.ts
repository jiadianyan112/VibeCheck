import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verificationApi } from './verificationApi'
import type { AuthSessionDto } from './authService'

const session = {
  authenticated: true,
  user_id: '11111111-1111-4111-8111-111111111111',
  csrf_token: 'csrf-token',
} as AuthSessionDto

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('verificationApi', () => {
  it('creates an owner request with the developer profile wire shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ verification_id: 'v-1', version: 1 }))

    await verificationApi.create(session, {
      project_id: '22222222-2222-4222-8222-222222222222',
      supersedes_verification_id: null,
      creator_resolution_mode: 'create_new_creator',
      creator_account_link_id: null,
      target_creator_id: null,
      new_creator_profile_input: {
        kind: 'team',
        display_name: 'VibeCheck Studio',
        bio: 'A small product team',
        avatar_url: 'https://example.com/logo.png',
        website_url: 'https://example.com/',
      },
      requested_link_role: 'owner',
      idempotency_key: 'verification-create-0001',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/verification-requests', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
    }))
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      creator_resolution_mode: 'create_new_creator',
      requested_link_role: 'owner',
      new_creator_profile_input: { kind: 'team', display_name: 'VibeCheck Studio' },
    })
  })

  it('uploads a prepared material, completes it, and uses applicant scan state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ material: { material_id: 'm-1', verification_id: 'v-1', applicant_scan_state: 'pending', version: 1 }, upload_url: 'https://upload.example.test/m-1', upload_headers: { 'x-upload-token': 'upload-token' }, upload_expires_at: '2026-10-08T00:00:00Z' }))
      .mockResolvedValueOnce(response({}, { status: 200 }))
      .mockResolvedValueOnce(response({ material: { material_id: 'm-1', verification_id: 'v-1', applicant_scan_state: 'pending', version: 2 }, scan_queued: true }, { status: 202 }))
      .mockResolvedValueOnce(response({ material_id: 'm-1', verification_id: 'v-1', applicant_scan_state: 'accepted', version: 3 }))

    const prepared = await verificationApi.prepareMaterial(session, { verification_id: 'v-1', declared_mime: 'application/pdf', byte_size: 8, checksum: 'a'.repeat(64), idempotency_key: 'material-prep-0001' })
    await verificationApi.uploadMaterial(prepared, new Blob(['evidence'], { type: 'application/pdf' }))
    await verificationApi.completeMaterial(session, 'm-1', { checksum: 'a'.repeat(64), upload_receipt: 'receipt-1', operation_id: 'material-complete-0001' })
    const material = await verificationApi.getMaterial(session, 'm-1')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[1]![0]).toBe('https://upload.example.test/m-1')
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PUT', headers: { 'x-upload-token': 'upload-token' } })
    expect(material.applicant_scan_state).toBe('accepted')
  })

  it('maps server conflict errors to a retryable verification error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: { code: 'VERIFICATION_VERSION_CONFLICT' } }, { status: 409 }))

    await expect(verificationApi.get(session, 'v-1')).rejects.toMatchObject({
      code: 'VERIFICATION_VERSION_CONFLICT',
      status: 409,
      retryable: true,
    })
  })

  it('sends patch idempotency through the header accepted by the workflow endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ verification_id: 'v-1', version: 2 }))

    await verificationApi.patch(session, 'v-1', {
      expected_version: 1,
      creator_resolution_mode: 'create_new_creator',
      creator_account_link_id: null,
      target_creator_id: null,
      new_creator_profile_input: { kind: 'individual', display_name: '林舟' },
      requested_link_role: 'owner',
      method: 'manual_material',
      public_summary: 'proof',
      idempotency_key: 'verification-patch-0001',
    })

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: expect.objectContaining({ 'idempotency-key': 'verification-patch-0001' }) })
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).not.toHaveProperty('idempotency_key')
  })

  it('uses the private-material purpose accepted by the reviewer read-grant endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ read_url: '/grant', expires_at: '2026-10-08T00:05:00Z' }, { status: 201 }))

    await verificationApi.createMaterialReadGrant(session, 'm-1', 'c'.repeat(43))

    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({ purpose: 'author_verification_review' })
  })
})
