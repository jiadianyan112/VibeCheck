import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { VerificationRequestService, type VerificationRequestStorePort } from './verification-request-service.js'
import type {
  ProvisionalLinkPolicy,
  VerificationRequestProjection,
} from './verification-request-types.js'

const userId = '52000000-0000-4000-8000-000000000001'
const projectId = '53000000-0000-4000-8000-000000000001'
const verificationId = '54000000-0000-4000-8000-000000000001'
const ownerPolicy: ProvisionalLinkPolicy = Object.freeze({
  policy_version: 'creator_link.v1',
  target_creator_aggregate_version: null,
  owner_link_set_version: null,
  allowed_link_roles: Object.freeze(['owner'] as const),
  default_link_role: 'owner',
  allowed_permission_profile_refs: Object.freeze([Object.freeze({
    profile_id: 'OWNER_V1',
    profile_version: 1,
    config_hash: 'a'.repeat(64),
  })]),
})

describe('VerificationRequestService', () => {
  it('creates an idempotent private draft projection without applicant identity', async () => {
    const fake = fakeStore()
    const service = new VerificationRequestService(fake.store, () => new Date('2026-08-13T16:00:00Z'))
    const result = await service.create({
      userId,
      projectId,
      supersedesVerificationId: null,
      creatorResolutionMode: 'create_new_creator',
      creatorAccountLinkId: null,
      targetCreatorId: null,
      newCreatorProfileInput: { display_name: 'Creator' },
      requestedLinkRole: null,
      idempotencyKey: 'verification-create-0001',
    })
    assert.equal(result.status, 'draft')
    assert.equal(result.requested_link_role, 'owner')
    assert.equal(Object.hasOwn(result, 'applicant_user_id'), false)
    assert.equal(fake.createCalls, 1)
  })

  it('rejects malformed create-new profile input before any store write', async () => {
    const fake = fakeStore()
    const service = new VerificationRequestService(fake.store)
    await assert.rejects(
      service.create({
        userId,
        projectId,
        supersedesVerificationId: null,
        creatorResolutionMode: 'create_new_creator',
        creatorAccountLinkId: null,
        targetCreatorId: null,
        newCreatorProfileInput: { display_name: '' },
        requestedLinkRole: null,
        idempotencyKey: 'verification-create-0002',
      }),
      (error: unknown) => error instanceof Error && error.message === 'NEW_CREATOR_PROFILE_INVALID',
    )
    assert.equal(fake.createCalls, 0)
  })

  it('checks draft ownership before resolving link or creator identifiers on patch', async () => {
    const fake = fakeStore({ owned: false })
    const service = new VerificationRequestService(fake.store)
    await assert.rejects(
      service.patch({
        userId,
        verificationId,
        expectedVersion: 1,
        creatorResolutionMode: 'claim_existing_creator',
        creatorAccountLinkId: null,
        targetCreatorId: '55000000-0000-4000-8000-000000000001',
        newCreatorProfileInput: null,
        requestedLinkRole: null,
        method: null,
        publicSummary: null,
        operationId: 'verification-patch-0001',
      }),
      (error: unknown) => error instanceof Error && error.message === 'VERIFICATION_REQUEST_NOT_FOUND',
    )
    assert.equal(fake.resolveCalls, 0)
  })
})

function fakeStore(options: { readonly owned?: boolean } = {}) {
  let createCalls = 0
  let resolveCalls = 0
  const row = {
    verification_id: verificationId,
    project_id: projectId,
    applicant_user_id: userId,
    creator_resolution_mode: 'create_new_creator',
    creator_account_link_id: null,
    target_creator_id: null,
    new_creator_profile_input_json: { display_name: 'Creator' },
    requested_link_role: 'owner',
    method: null,
    public_summary: null,
    status: 'draft',
    status_history_json: [{ status: 'draft', at: '2026-08-13T16:00:00.000Z' }],
    supersedes_verification_id: null,
    version: '1',
    created_at: new Date('2026-08-13T16:00:00Z'),
    updated_at: new Date('2026-08-13T16:00:00Z'),
    request_hash: 'b'.repeat(64),
  } as const
  const selection = Object.freeze({
    mode: 'create_new_creator' as const,
    creatorAccountLinkId: null,
    targetCreatorId: null,
    newCreatorProfileInput: Object.freeze({ display_name: 'Creator' }),
    requestedLinkRole: 'owner' as const,
    provisionalPolicy: ownerPolicy,
  })
  const projection: VerificationRequestProjection = Object.freeze({
    verification_id: verificationId,
    project_id: projectId,
    creator_resolution_mode: 'create_new_creator',
    creator_account_link_id: null,
    target_creator_id: null,
    new_creator_profile_input: Object.freeze({ display_name: 'Creator' }),
    requested_link_role: 'owner',
    provisional_link_policy: ownerPolicy,
    link_policy_snapshot: null,
    method: null,
    public_summary: null,
    material_summaries: Object.freeze([]),
    status: 'draft',
    status_history: Object.freeze([Object.freeze({ status: 'draft', at: '2026-08-13T16:00:00.000Z' })]),
    latest_public_review_message: null,
    supersedes_verification_id: null,
    resulting_creator_id: null,
    resulting_link_id: null,
    resulting_author_relation_id: null,
    resulting_profile_version_id: null,
    approved_link_role: null,
    approved_permission_profile_ref: null,
    version: 1,
    created_at: '2026-08-13T16:00:00.000Z',
    updated_at: '2026-08-13T16:00:00.000Z',
  })
  const implementation = {
    async findCreateReplay() { return null },
    async getOwned() { return options.owned === false ? null : row },
    async create() { createCalls += 1; return row },
    async patch() { return row },
    async resolveSelection() { resolveCalls += 1; return selection },
    projection() { return projection },
  }
  return {
    store: implementation as unknown as VerificationRequestStorePort,
    get createCalls() { return createCalls },
    get resolveCalls() { return resolveCalls },
  }
}
