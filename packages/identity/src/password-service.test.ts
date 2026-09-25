import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PasswordService, type PasswordStore } from './password-service.js'
import { encryptText } from './crypto.js'

const now = new Date('2026-09-25T00:00:00.000Z')
const config = {
  enabled: true, cookieSecure: false, sessionTtlSeconds: 2_592_000,
  otpTtlSeconds: 600, otpResendSeconds: 60, emailSendLimit: 5,
  ipSendLimit: 20, rateWindowSeconds: 900, emailProvider: 'resend' as const,
  emailFrom: '', resendApiKey: '', emailEncryptionKey: Buffer.alloc(32).toString('base64'),
  emailEncryptionKeyVersion: 'test', emailHashPepper: 'pepper'.repeat(8),
  otpPepper: '', authTokenSecret: 'secret'.repeat(8),
}

class MemoryPasswordStore implements PasswordStore {
  hash: string | null = null
  lastLogin: Parameters<PasswordStore['completeLogin']>[0] | null = null
  allowed = true
  eligible = true
  accountStatus: 'active' | 'disabled' = 'active'
  readonly userId = '11111111-1111-4111-8111-111111111111'
  async consumeAttempt() { return this.allowed }
  async findCredential() {
    return this.hash ? {
      userId: this.userId, accountStatus: this.accountStatus, rolesVersion: 1,
      roles: ['user'] as const, passwordHash: this.hash,
      emailCiphertext: encryptText(config.emailEncryptionKey, 'user@example.com'), emailKeyVersion: 'test',
    } : null
  }
  async completeLogin(input: Parameters<PasswordStore['completeLogin']>[0]) { this.lastLogin = input; return true }
  async getStatus() { return { hasPassword: this.hash !== null, canSetPassword: this.eligible } }
  async setPassword(input: { passwordHash: string }) { this.hash = input.passwordHash; return true }
}

describe('PasswordService', () => {
  it('accepts an 8-character password including spaces and rejects shorter or longer input', async () => {
    const store = new MemoryPasswordStore()
    const service = new PasswordService({ config, store, now: () => now })
    await service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId, password: 'abcd 123', requestId: 'test' })
    assert.match(store.hash!, /^\$argon2id\$/)
    await assert.rejects(() => service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId, password: '1234567', requestId: 'test' }), { code: 'PASSWORD_INVALID' })
    await assert.rejects(() => service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId, password: 'a'.repeat(65), requestId: 'test' }), { code: 'PASSWORD_INVALID' })
  })

  it('returns one error for wrong, absent, and unknown credentials', async () => {
    const store = new MemoryPasswordStore()
    const service = new PasswordService({ config, store, now: () => now })
    const command = { email: 'user@example.com', password: 'wrong pass', returnTo: '/me', anonymousSubjectId: store.userId, currentSessionToken: null, ipAddress: '127.0.0.1', userAgent: null, requestId: 'test' }
    await assert.rejects(() => service.login(command), { code: 'PASSWORD_LOGIN_INVALID' })
    await service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId, password: 'correct password', requestId: 'test' })
    await assert.rejects(() => service.login(command), { code: 'PASSWORD_LOGIN_INVALID' })
  })

  it('issues a masked-email session after a valid password and keeps the safe return path', async () => {
    const store = new MemoryPasswordStore()
    const service = new PasswordService({ config, store, now: () => now })
    await service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId, password: 'correct password', requestId: 'test' })
    const login = await service.login({ email: 'USER@example.com', password: 'correct password', returnTo: '/me#security',
      anonymousSubjectId: store.userId, currentSessionToken: null, ipAddress: '127.0.0.1', userAgent: null, requestId: 'test' })
    assert.equal(login.session.userId, store.userId)
    assert.equal(login.session.displayName, 'us***@example.com')
    assert.equal(login.returnTo, '/me#security')
    assert.ok(store.lastLogin)
    const unsafe = await service.login({ email: 'user@example.com', password: 'correct password', returnTo: '//evil.example',
      anonymousSubjectId: store.userId, currentSessionToken: null, ipAddress: '127.0.0.1', userAgent: null, requestId: 'test' })
    assert.equal(unsafe.returnTo, '/me')
    store.allowed = false
    await assert.rejects(() => service.login({ email: 'user@example.com', password: 'correct password', returnTo: '/me',
      anonymousSubjectId: store.userId, currentSessionToken: null, ipAddress: null, userAgent: null, requestId: 'test' }), { code: 'AUTH_RATE_LIMITED' })
  })

  it('requires a fresh OTP-authenticated session before hashing a password', async () => {
    const store = new MemoryPasswordStore()
    store.eligible = false
    const service = new PasswordService({ config, store, now: () => now })
    await assert.rejects(() => service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId,
      password: 'correct password', requestId: 'test' }), { code: 'OTP_REAUTH_REQUIRED' })
    assert.equal(store.hash, null)
  })

  it('uses the same login error for a disabled account', async () => {
    const store = new MemoryPasswordStore()
    const service = new PasswordService({ config, store, now: () => now })
    await service.setPassword({ sessionToken: 's'.repeat(43), userId: store.userId,
      password: 'correct password', requestId: 'test' })
    store.accountStatus = 'disabled'
    await assert.rejects(() => service.login({ email: 'user@example.com', password: 'correct password',
      returnTo: '/me', anonymousSubjectId: store.userId, currentSessionToken: null,
      ipAddress: null, userAgent: null, requestId: 'test' }), { code: 'PASSWORD_LOGIN_INVALID' })
  })
})
