import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'

import type { AdminOperationSecurityStore } from './admin-operation-store.js'
import { AdminOperationSecurityService } from './admin-operation-service.js'
import type { ConfirmAdminOperationStoreResult } from './admin-operation-types.js'
import { WorkflowError } from './errors.js'

const tokenSecret = 'workflow-admin-token-secret-at-least-thirty-two-characters'
const authTokenSecret = 'identity-auth-token-secret-at-least-thirty-two-characters'
const sessionToken = 'session-token-with-at-least-thirty-two-characters'
const actor = Object.freeze({
  userId: '71000000-0000-4000-8000-000000000001',
  roles: Object.freeze(['admin'] as const),
  permissions: Object.freeze(['admin:access', 'admin:review']),
})
const now = new Date('2026-08-13T12:00:00.000Z')

class FakeStore implements AdminOperationSecurityStore {
  created: Parameters<AdminOperationSecurityStore['createPreview']>[0] | null = null
  confirmed: Parameters<AdminOperationSecurityStore['confirmPreview']>[0] | null = null
  confirmResult: ConfirmAdminOperationStoreResult | null = null

  async createPreview(input: Parameters<AdminOperationSecurityStore['createPreview']>[0]) {
    this.created = input
    return Object.freeze({
      previewId: input.previewId,
      operationType: input.operationType,
      targetCount: input.targets.length,
      confirmationSummaryHash: input.confirmationSummaryHash,
      expectedConflictPrincipalVersion: input.expectedConflictPrincipalVersion,
      expiresAt: input.expiresAt,
    })
  }

  async confirmPreview(input: Parameters<AdminOperationSecurityStore['confirmPreview']>[0]) {
    this.confirmed = input
    if (this.confirmResult) return this.confirmResult
    return Object.freeze({
      kind: 'issued' as const,
      confirmGrantId: input.confirmGrantId,
      preview: Object.freeze({
        previewId: '72000000-0000-4000-8000-000000000001',
        operationType: 'submission_review',
        targetCount: 1,
        confirmationSummaryHash: input.confirmationSummaryHash,
        expectedConflictPrincipalVersion: null,
        expiresAt: new Date(now.getTime() + 600_000),
      }),
      assuranceSource: 'recent_session' as const,
      expiresAt: new Date(now.getTime() + 120_000),
    })
  }
}

function service(store: FakeStore) {
  return new AdminOperationSecurityService(store, {
    tokenSecret,
    authTokenSecret,
    previewTtlSeconds: 600,
    confirmTtlSeconds: 120,
    recentAuthWindowSeconds: 300,
  }, () => now)
}

describe('AdminOperationSecurityService', () => {
  it('canonicalizes a preview and binds it to the primary session without exposing raw claim data', async () => {
    const store = new FakeStore()
    const result = await service(store).preview({
      actor,
      sessionToken,
      operationType: 'submission_review',
      targets: Object.freeze([Object.freeze({ target_type: 'submission', target_id: 'submission-1' })]),
      expectedVersions: Object.freeze({ work_item: 2, submission: 3 }),
      proposedDiff: Object.freeze({ review_status: 'approved', reason: 'verified' }),
      reasonCode: 'submission_approved',
      claimToken: 'c'.repeat(43),
      expectedConflictPrincipalVersion: null,
      requestId: 'request_preview_0001',
    })
    assert.match(result.preview_token, /^[A-Za-z0-9_-]{43}$/)
    assert.match(result.confirmation_summary_hash, /^[a-f0-9]{64}$/)
    assert.equal(result.expires_at, '2026-08-13T12:10:00.000Z')
    assert.equal(store.created?.primarySessionIdHash.toString('hex'), createHmac('sha256', authTokenSecret)
      .update(sessionToken).digest('hex'))
    assert.notEqual(store.created?.claimTokenHash?.toString('utf8'), 'c'.repeat(43))
    assert.deepEqual(result.impact.changed_top_level_fields, ['reason', 'review_status'])
  })

  it('returns one deterministic confirm token for an issued or replayed grant', async () => {
    const store = new FakeStore()
    const preview = await service(store).preview({
      actor,
      sessionToken,
      operationType: 'submission_review',
      targets: [{ target_type: 'submission', target_id: 'submission-1' }],
      expectedVersions: { work_item: 2 },
      proposedDiff: { review_status: 'approved' },
      reasonCode: 'submission_approved',
      claimToken: null,
      expectedConflictPrincipalVersion: null,
      requestId: 'request_preview_0002',
    })
    const confirm = await service(store).confirm({
      actor,
      sessionToken,
      previewToken: preview.preview_token,
      confirmationSummaryHash: preview.confirmation_summary_hash,
      confirmRequestId: 'confirm_request_0001',
      reauthGrantId: null,
      expectedConflictPrincipalVersion: null,
      requestId: 'request_confirm_0001',
    })
    assert.match(confirm.confirm_token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(confirm.assurance_source, 'recent_session')
    assert.equal(confirm.replayed, false)
    assert.equal(store.confirmed?.confirmTtlSeconds, 120)
  })

  it('turns a stale session result into a bounded reauthentication challenge', async () => {
    const store = new FakeStore()
    store.confirmResult = Object.freeze({
      kind: 'reauth_required',
      preview: Object.freeze({
        previewId: '72000000-0000-4000-8000-000000000001',
        operationType: 'project_archive',
        targetCount: 1,
        confirmationSummaryHash: 'a'.repeat(64),
        expectedConflictPrincipalVersion: null,
        expiresAt: new Date(now.getTime() + 600_000),
      }),
    })
    await assert.rejects(
      () => service(store).confirm({
        actor,
        sessionToken,
        previewToken: 'p'.repeat(43),
        confirmationSummaryHash: 'a'.repeat(64),
        confirmRequestId: 'confirm_request_0002',
        reauthGrantId: null,
        expectedConflictPrincipalVersion: null,
        requestId: 'request_confirm_0002',
      }),
      (error: unknown) => error instanceof WorkflowError && error.code === 'REAUTH_REQUIRED' &&
        error.httpStatus === 401 && error.details?.purpose === 'admin_confirm',
    )
  })

  it('rejects malformed or prototype-bearing preview input before storage', async () => {
    const store = new FakeStore()
    await assert.rejects(
      () => service(store).preview({
        actor,
        sessionToken,
        operationType: 'Submission-Review',
        targets: [{ target_type: 'submission', target_id: 'submission-1' }],
        expectedVersions: { work_item: 2 },
        proposedDiff: {},
        reasonCode: 'approved',
        claimToken: null,
        expectedConflictPrincipalVersion: null,
        requestId: 'request_preview_0003',
      }),
      (error: unknown) => error instanceof WorkflowError && error.code === 'ADMIN_OPERATION_TYPE_INVALID',
    )
    assert.equal(store.created, null)
  })
})
