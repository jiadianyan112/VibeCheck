import type { IdentityConfig } from '@vibecheck/config'

import { identityError } from './errors.js'
import type { EmailOtpMessage, EmailSender } from './types.js'

interface ResendResponse {
  id?: unknown
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly config: Pick<IdentityConfig, 'emailFrom' | 'resendApiKey'>,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async sendOtp(message: EmailOtpMessage): Promise<{ readonly receiptId: string }> {
    let response: Response
    try {
      response = await this.fetchImplementation('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.resendApiKey}`,
          'content-type': 'application/json',
          'idempotency-key': `vibecheck-auth/${message.idempotencyKey}`,
          'user-agent': 'VibeCheck/0.2',
        },
        body: JSON.stringify({
          from: this.config.emailFrom,
          to: [message.to],
          subject: '你的 VibeCheck 登录验证码',
          text: `你的验证码是 ${message.code}。验证码将在 ${message.expiresInMinutes} 分钟后失效，请勿转发。`,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw identityError('EMAIL_PROVIDER_UNAVAILABLE', 503, true)
    }

    if (!response.ok) throw identityError('EMAIL_PROVIDER_UNAVAILABLE', 503, true)
    const body = await response.json() as ResendResponse
    if (typeof body.id !== 'string' || body.id.length === 0) {
      throw identityError('EMAIL_PROVIDER_RESPONSE_INVALID', 503, true)
    }
    return Object.freeze({ receiptId: body.id })
  }
}
