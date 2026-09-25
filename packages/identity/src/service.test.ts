import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { IdentityConfig } from '@vibecheck/config'

import { IdentityService, type IdentityStore } from './service.js'
import type {
  ChallengeForVerification,
  CompleteVerificationInput,
  CreateChallengeInput,
} from './store.js'
import type { EmailOtpMessage, EmailSender } from './types.js'

const now = new Date('2026-08-11T00:00:00.000Z')
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
  emailFrom: 'VibeCheck <login@example.com>',
  resendApiKey: 'resend-test-key-at-least-thirty-two-characters',
  emailEncryptionKey: Buffer.alloc(32, 9).toString('base64'),
  emailEncryptionKeyVersion: 'test-v1',
  emailHashPepper: 'email-hash-pepper-at-least-thirty-two-characters',
  otpPepper: 'otp-pepper-at-least-thirty-two-characters',
  authTokenSecret: 'auth-token-secret-at-least-thirty-two-characters',
})

class CapturingSender implements EmailSender {
  message: EmailOtpMessage | null = null

  async sendOtp(message: EmailOtpMessage) {
    this.message = message
    return { receiptId: 'receipt-1' }
  }
}

class InMemoryFlowStore implements IdentityStore {
  created: CreateChallengeInput | null = null
  completed: CompleteVerificationInput | null = null

  async createChallenge(input: CreateChallengeInput) {
    this.created = input
    return {
      challengeId: input.challengeId,
      authFlowId: input.authFlowId,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: input.now,
      deliveredAt: null,
      sendReceiptRef: null,
      isNew: true,
    }
  }

  async markChallengeDelivered() {}
  async markChallengeDeliveryFailed() {}

  async getChallenge(challengeId: string, authFlowId: string): Promise<ChallengeForVerification | null> {
    const created = this.created
    if (!created || created.challengeId !== challengeId || created.authFlowId !== authFlowId) return null
    return {
      challengeId,
      authFlowId,
      purpose: created.purpose,
      status: 'pending',
      otpHash: created.otpHash,
      otpSalt: created.otpSalt,
      browserBindingHash: created.browserBindingHash,
      expiresAt: created.expiresAt,
    }
  }

  async completeVerification(input: CompleteVerificationInput) {
    this.completed = input
    const created = this.created!
    if (!input.otpValid) return { kind: 'error', code: 'OTP_INVALID', httpStatus: 422 } as const
    return {
      kind: 'login',
      userId: '11111111-1111-4111-8111-111111111111',
      accountStatus: 'active',
      rolesVersion: 1,
      roles: ['user'] as const,
      anonymousSubjectId: created.anonymousSubjectId,
      emailCiphertext: created.emailCiphertext,
      emailKeyVersion: created.emailKeyVersion,
      recentAuthAt: now,
      expiresAt: new Date('2026-09-10T00:00:00.000Z'),
      sessionVersion: 1,
      returnTo: created.returnTo,
      pendingActionId: null,
      identityLinks: [{
        identityLinkId: '88888888-8888-4888-8888-888888888888',
        purpose: 'query_continuation',
        expiresAt: new Date('2026-08-11T00:05:00.000Z'),
      }] as const,
    } as const
  }

  async getSession() { return null }
  async revokeSession() { return true }
}

describe('IdentityService', () => {
  it('sends a six-digit OTP and returns a rotated opaque session after one valid verification', async () => {
    const store = new InMemoryFlowStore()
    const sender = new CapturingSender()
    const service = new IdentityService({ config, store, emailSender: sender, now: () => now })
    const challenge = await service.startChallenge({
      email: 'USER@example.com',
      purpose: 'login',
      returnTo: '/notifications',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      anonymousSubjectId: '33333333-3333-4333-8333-333333333333',
      browserBindingToken: null,
      sessionToken: null,
      previewToken: null,
      pendingActionId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'identity-test',
      requestId: 'request_identity_test',
    })
    assert.match(sender.message?.code ?? '', /^\d{6}$/)
    assert.equal(challenge.maskedEmail, 'us***@example.com')
    assert.equal(challenge.resendAfter, '2026-08-11T00:01:00.000Z')

    const verified = await service.verifyChallenge({
      challengeId: challenge.challengeId,
      authFlowId: challenge.authFlowId,
      otp: sender.message!.code,
      clientRequestId: '44444444-4444-4444-8444-444444444444',
      browserBindingToken: challenge.browserBindingToken,
      currentSessionToken: null,
      ipAddress: '127.0.0.1',
      userAgent: 'identity-test',
      requestId: 'request_identity_verify',
    })
    assert.equal(verified.purpose, 'login')
    if (verified.purpose !== 'login') assert.fail('expected login result')
    assert.ok(verified.sessionToken.length >= 32)
    assert.ok(verified.session.csrfToken.length >= 32)
    assert.equal(verified.returnTo, '/notifications')
    assert.deepEqual(verified.identityLinks, [{
      identityLinkId: '88888888-8888-4888-8888-888888888888',
      purpose: 'query_continuation',
      expiresAt: '2026-08-11T00:05:00.000Z',
    }])
    assert.equal(store.completed?.identityLinkExpiresAt.toISOString(), '2026-08-11T00:05:00.000Z')
    assert.equal(store.completed?.otpValid, true)
  })

  it('does not turn an invalid OTP into a session', async () => {
    const store = new InMemoryFlowStore()
    const sender = new CapturingSender()
    const service = new IdentityService({ config, store, emailSender: sender, now: () => now })
    const challenge = await service.startChallenge({
      email: 'user@example.com',
      purpose: 'login',
      returnTo: '/me',
      clientRequestId: '55555555-5555-4555-8555-555555555555',
      anonymousSubjectId: '66666666-6666-4666-8666-666666666666',
      browserBindingToken: null,
      sessionToken: null,
      previewToken: null,
      pendingActionId: null,
      ipAddress: null,
      userAgent: null,
      requestId: 'request_identity_invalid',
    })
    await assert.rejects(
      () => service.verifyChallenge({
        challengeId: challenge.challengeId,
        authFlowId: challenge.authFlowId,
        otp: sender.message!.code === '000000' ? '999999' : '000000',
        clientRequestId: '77777777-7777-4777-8777-777777777777',
        browserBindingToken: challenge.browserBindingToken,
        currentSessionToken: null,
        ipAddress: null,
        userAgent: null,
        requestId: 'request_identity_invalid_verify',
      }),
      /OTP_INVALID/,
    )
    assert.equal(store.completed?.otpValid, false)
  })
})
