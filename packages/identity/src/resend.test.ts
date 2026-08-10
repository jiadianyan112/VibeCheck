import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { IdentityError } from './errors.js'
import { ResendEmailSender } from './resend.js'

describe('Resend email adapter', () => {
  it('uses provider idempotency without exposing the API key in the payload', async () => {
    let request: RequestInit | null = null
    const sender = new ResendEmailSender(
      { emailFrom: 'VibeCheck <login@example.com>', resendApiKey: 'resend-secret-key' },
      async (_input, init) => {
        request = init ?? null
        return new Response(JSON.stringify({ id: 'email-receipt-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    )
    const result = await sender.sendOtp({
      to: 'user@example.com',
      code: '012345',
      expiresInMinutes: 10,
      idempotencyKey: 'challenge-1',
    })
    assert.equal(result.receiptId, 'email-receipt-1')
    assert.equal((request?.headers as Record<string, string>)['idempotency-key'], 'vibecheck-auth/challenge-1')
    assert.equal(JSON.stringify(request?.body).includes('resend-secret-key'), false)
  })

  it('maps provider errors to a stable retryable error without returning provider content', async () => {
    const sender = new ResendEmailSender(
      { emailFrom: 'VibeCheck <login@example.com>', resendApiKey: 'resend-secret-key' },
      async () => new Response('provider account details must not leak', { status: 429 }),
    )
    await assert.rejects(
      () => sender.sendOtp({
        to: 'user@example.com',
        code: '012345',
        expiresInMinutes: 10,
        idempotencyKey: 'challenge-1',
      }),
      (error: unknown) => {
        assert(error instanceof IdentityError)
        assert.equal(error.code, 'EMAIL_PROVIDER_UNAVAILABLE')
        assert.equal(error.retryable, true)
        assert.equal(error.message.includes('provider account'), false)
        return true
      },
    )
  })
})
