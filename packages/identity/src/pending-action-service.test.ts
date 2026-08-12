import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { IdentityConfig } from '@vibecheck/config'

import { IdentityError } from './errors.js'
import { PendingActionService } from './pending-action-service.js'
import type {
  CancelPendingActionStoreInput,
  ConsumePendingActionStoreInput,
  CreatePendingActionStoreInput,
  PendingActionStoredProjection,
  PendingActionStore,
} from './pending-action-store.js'
import type { PendingActionProjection } from './pending-action-types.js'

const now = new Date('2026-08-12T00:00:00.000Z')
const config: IdentityConfig = Object.freeze({
  enabled: true,
  cookieSecure: false,
  sessionTtlSeconds: 2_592_000,
  otpTtlSeconds: 600,
  otpResendSeconds: 60,
  emailSendLimit: 5,
  ipSendLimit: 20,
  rateWindowSeconds: 900,
  emailProvider: 'resend',
  emailFrom: 'test@example.com',
  resendApiKey: 'resend-api-key-at-least-thirty-two-characters',
  emailEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  emailEncryptionKeyVersion: 'test-v1',
  emailHashPepper: 'email-hash-pepper-at-least-thirty-two-characters',
  otpPepper: 'otp-pepper-at-least-thirty-two-characters',
  authTokenSecret: 'auth-token-secret-at-least-thirty-two-characters',
})

class FakePendingActionStore implements PendingActionStore {
  created: CreatePendingActionStoreInput | null = null
  consumed: ConsumePendingActionStoreInput | null = null
  cancelled: CancelPendingActionStoreInput | null = null

  async create(input: CreatePendingActionStoreInput): Promise<PendingActionProjection> {
    this.created = input
    return this.projection('pending')
  }

  async get(): Promise<PendingActionStoredProjection> {
    const created = this.created!
    return Object.freeze({
      ...this.projection('pending'),
      payloadCiphertext: created.payloadCiphertext,
      payloadKeyVersion: created.payloadKeyVersion,
      clientRequestId: created.clientRequestId,
    })
  }

  async consume(input: ConsumePendingActionStoreInput): Promise<PendingActionProjection> {
    this.consumed = input
    return this.projection('consumed')
  }

  async cancel(input: CancelPendingActionStoreInput): Promise<PendingActionProjection> {
    this.cancelled = input
    return this.projection('cancelled')
  }

  private projection(status: 'pending' | 'consumed' | 'cancelled'): PendingActionProjection {
    return Object.freeze({
      pending_action_id: this.created?.pendingActionId ?? '10000000-0000-4000-8000-000000000001',
      action_type: this.created?.actionType ?? 'create_comment',
      return_to: this.created?.returnTo ?? '/projects/10000000-0000-4000-8000-000000000002',
      status,
      expires_at: '2026-08-12T00:15:00.000Z',
      consumed_at: status === 'consumed' ? now.toISOString() : null,
      cancelled_at: status === 'cancelled' ? now.toISOString() : null,
      cancel_reason: status === 'cancelled' ? 'user_cancelled' : null,
    })
  }
}

async function failure(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    Promise.resolve().then(action),
    (error: unknown) => error instanceof IdentityError && error.code === code,
  )
}

describe('PendingActionService', () => {
  it('encrypts a normalized allowlisted payload and only decrypts it for trusted execution', async () => {
    const store = new FakePendingActionStore()
    const service = new PendingActionService({ config, store, now: () => now })
    const created = await service.create({
      subject: { kind: 'anonymous', id: '20000000-0000-4000-8000-000000000001' },
      actionType: 'create_comment',
      parameters: {
        project_id: '20000000-0000-4000-8000-000000000002',
        body: '  一条待审核评论  ',
        parent_comment_id: null,
      },
      returnTo: '/projects/20000000-0000-4000-8000-000000000002',
      clientRequestId: '20000000-0000-4000-8000-000000000003',
      requestId: 'pending_action_create_test',
    })
    assert.equal(created.status, 'pending')
    assert.equal(store.created?.subject.kind, 'anonymous')
    assert.equal(store.created?.subjectHash.length, 32)
    assert.doesNotMatch(store.created?.payloadCiphertext.toString('utf8') ?? '', /待审核评论/)
    assert.match(store.created?.requestPayloadHash ?? '', /^[a-f0-9]{64}$/)

    const execution = await service.getForExecution({
      pendingActionId: created.pending_action_id,
      subject: { kind: 'anonymous', id: '20000000-0000-4000-8000-000000000001' },
      identityLinkId: null,
      requestId: 'pending_action_execute_test',
    })
    assert.deepEqual(execution.payload, {
      action_type: 'create_comment',
      body: '一条待审核评论',
      parent_comment_id: null,
      project_id: '20000000-0000-4000-8000-000000000002',
    })
  })

  it('rejects removed decision actions and completes only through an internally signed receipt', async () => {
    const store = new FakePendingActionStore()
    const service = new PendingActionService({ config, store, now: () => now })
    await failure(() => service.create({
      subject: { kind: 'anonymous', id: '30000000-0000-4000-8000-000000000001' },
      actionType: 'decision',
      parameters: {},
      returnTo: '/compare',
      clientRequestId: '30000000-0000-4000-8000-000000000002',
      requestId: 'pending_action_invalid_test',
    }), 'PENDING_ACTION_TYPE_INVALID')

    await service.create({
      subject: { kind: 'user', id: '30000000-0000-4000-8000-000000000003' },
      actionType: 'set_project_favorite',
      parameters: { project_id: '30000000-0000-4000-8000-000000000004', state: true },
      returnTo: '/projects/30000000-0000-4000-8000-000000000004',
      clientRequestId: '30000000-0000-4000-8000-000000000005',
      requestId: 'pending_action_user_create_test',
    })
    await service.completeExecution({
      pendingActionId: store.created!.pendingActionId,
      subject: { kind: 'user', id: '30000000-0000-4000-8000-000000000003' },
      identityLinkId: '30000000-0000-4000-8000-000000000007',
      businessRequestId: '30000000-0000-4000-8000-000000000005',
      clientRequestId: '30000000-0000-4000-8000-000000000008',
      expectedStatus: 'pending',
      requestId: 'pending_action_consume_test',
    })
    assert.equal(store.consumed?.executionReceiptHash.length, 32)
    assert.equal(store.consumed?.businessRequestId, '30000000-0000-4000-8000-000000000005')
    const receipt = service.issueExecutionReceipt({
      pendingActionId: store.created!.pendingActionId,
      userId: '30000000-0000-4000-8000-000000000003',
      businessRequestId: '30000000-0000-4000-8000-000000000006',
      result: 'success',
      expiresAt: new Date('2026-08-12T00:01:00.000Z'),
    })
    await failure(() => service.consume({
      pendingActionId: store.created!.pendingActionId,
      subject: { kind: 'user', id: '30000000-0000-4000-8000-000000000003' },
      identityLinkId: '30000000-0000-4000-8000-000000000007',
      executionReceipt: `${receipt}x`,
      clientRequestId: '30000000-0000-4000-8000-000000000009',
      expectedStatus: 'pending',
      requestId: 'pending_action_tamper_test',
    }), 'EXECUTION_RECEIPT_INVALID')
  })
})
