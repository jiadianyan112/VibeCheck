import { randomUUID } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import type { IdentityConfig } from '@vibecheck/config'
import { decryptText, keyedHash, opaqueToken } from './crypto.js'
import { identityError } from './errors.js'
import { canUseReturnTo, maskEmail, normalizeEmail, normalizeReturnTo } from './normalize.js'
import { permissionsFor, primaryRole } from './permissions.js'
import type { AccountStatus, IdentityRole, SessionProjection } from './types.js'

export interface PasswordCredential {
  readonly userId: string
  readonly accountStatus: AccountStatus
  readonly rolesVersion: number
  readonly roles: readonly IdentityRole[]
  readonly passwordHash: string
  readonly emailCiphertext: Buffer
  readonly emailKeyVersion: string
}

export interface PasswordStore {
  consumeAttempt(emailHash: Buffer, ipHash: Buffer | null, now: Date, windowSeconds: number): Promise<boolean>
  findCredential(emailHash: Buffer): Promise<PasswordCredential | null>
  completeLogin(input: {
    readonly credential: PasswordCredential
    readonly emailHash: Buffer
    readonly sessionHash: Buffer
    readonly csrfHash: Buffer
    readonly previousSessionHash: Buffer | null
    readonly anonymousSubjectId: string
    readonly authFlowId: string
    readonly ipHash: Buffer | null
    readonly userAgentHash: Buffer | null
    readonly expiresAt: Date
    readonly now: Date
    readonly requestId: string
  }): Promise<boolean>
  getStatus(userId: string, sessionHash: Buffer, now: Date): Promise<{ hasPassword: boolean; canSetPassword: boolean; passwordHash: string | null }>
  consumeChangeAttempt(userHash: Buffer, ipHash: Buffer | null, now: Date, windowSeconds: number): Promise<boolean>
  setPassword(input: { userId: string; sessionHash: Buffer; passwordHash: string; expectedPasswordHash: string | null; allowRecentOtp: boolean; now: Date; requestId: string }): Promise<boolean>
  resetPassword(input: { grantHash: Buffer; sessionHash: Buffer | null; passwordHash: string; now: Date; requestId: string }): Promise<boolean>
}

const options = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 }
const dummyHash = hash('vibecheck-dummy-password', options)

export class PasswordService {
  private readonly config: IdentityConfig
  private readonly store: PasswordStore
  private readonly now: () => Date

  constructor(input: { config: IdentityConfig; store: PasswordStore; now?: () => Date }) {
    this.config = input.config
    this.store = input.store
    this.now = input.now ?? (() => new Date())
  }

  private enabled() {
    if (!this.config.enabled) throw identityError('AUTH_SERVICE_UNAVAILABLE', 503, true)
  }

  async login(command: {
    email: string; password: string; returnTo: string; anonymousSubjectId: string
    currentSessionToken: string | null; ipAddress: string | null; userAgent: string | null; requestId: string
  }): Promise<{ session: SessionProjection; sessionToken: string; returnTo: string }> {
    this.enabled()
    const email = normalizeEmail(command.email)
    const returnTo = normalizeReturnTo(command.returnTo)
    const now = this.now()
    const emailHash = keyedHash(this.config.emailHashPepper, email)
    const ipHash = command.ipAddress ? keyedHash(this.config.authTokenSecret, command.ipAddress) : null
    if (!await this.store.consumeAttempt(emailHash, ipHash, now, this.config.rateWindowSeconds)) {
      throw identityError('AUTH_RATE_LIMITED', 429, true, this.config.rateWindowSeconds)
    }
    const credential = await this.store.findCredential(emailHash)
    const expectedHash = credential?.passwordHash ?? await dummyHash
    let correct = false
    try { correct = await verify(expectedHash, command.password) } catch { /* malformed hash is not an account oracle */ }
    if (!correct || !credential || credential.accountStatus === 'disabled') {
      throw identityError('PASSWORD_LOGIN_INVALID', 401)
    }
    if (credential.emailKeyVersion !== this.config.emailEncryptionKeyVersion) throw identityError('EMAIL_KEY_VERSION_UNAVAILABLE', 503, true)
    const storedEmail = decryptText(this.config.emailEncryptionKey, credential.emailCiphertext)
    const sessionToken = opaqueToken()
    const csrfToken = opaqueToken()
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1_000)
    const completed = await this.store.completeLogin({
      credential, emailHash,
      sessionHash: keyedHash(this.config.authTokenSecret, sessionToken),
      csrfHash: keyedHash(this.config.authTokenSecret, csrfToken),
      previousSessionHash: command.currentSessionToken ? keyedHash(this.config.authTokenSecret, command.currentSessionToken) : null,
      anonymousSubjectId: command.anonymousSubjectId,
      authFlowId: randomUUID(), ipHash,
      userAgentHash: command.userAgent ? keyedHash(this.config.authTokenSecret, command.userAgent) : null,
      expiresAt, now, requestId: command.requestId,
    })
    if (!completed) throw identityError('PASSWORD_LOGIN_INVALID', 401)
    const session: SessionProjection = Object.freeze({
      authenticated: true,
      userId: credential.userId,
      displayName: maskEmail(storedEmail),
      accountStatus: credential.accountStatus as Exclude<AccountStatus, 'disabled'>,
      roles: credential.roles,
      primaryRole: primaryRole(credential.roles),
      permissions: Object.freeze(permissionsFor(credential.roles, credential.accountStatus)),
      sessionVersion: 1, csrfToken,
      recentAuthAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
    })
    return { session, sessionToken, returnTo: canUseReturnTo(returnTo, credential.roles) ? returnTo : '/me' }
  }

  async getStatus(sessionToken: string, userId: string) {
    this.enabled()
    const { hasPassword, canSetPassword } = await this.store.getStatus(userId, keyedHash(this.config.authTokenSecret, sessionToken), this.now())
    return { hasPassword, canSetPassword: !hasPassword && canSetPassword, canSetWithoutCurrentPassword: canSetPassword }
  }

  async setPassword(command: { sessionToken: string; userId: string; password: string; currentPassword?: string | null; ipAddress?: string | null; requestId: string }): Promise<void> {
    this.enabled()
    const length = Array.from(command.password).length
    if (length < 8 || length > 64 || Buffer.byteLength(command.password, 'utf8') > 1024) {
      throw identityError('PASSWORD_INVALID', 422)
    }
    const sessionHash = keyedHash(this.config.authTokenSecret, command.sessionToken)
    const now = this.now()
    const status = await this.store.getStatus(command.userId, sessionHash, now)
    let expectedPasswordHash: string | null = null
    let allowRecentOtp = false
    if (status.hasPassword && command.currentPassword) {
      const userHash = keyedHash(this.config.authTokenSecret, command.userId)
      const ipHash = command.ipAddress ? keyedHash(this.config.authTokenSecret, command.ipAddress) : null
      if (!await this.store.consumeChangeAttempt(userHash, ipHash, now, this.config.rateWindowSeconds)) {
        throw identityError('AUTH_RATE_LIMITED', 429, true, this.config.rateWindowSeconds)
      }
      let valid = false
      try { valid = await verify(status.passwordHash ?? await dummyHash, command.currentPassword) } catch { /* malformed stored hash */ }
      if (!valid || !status.passwordHash) throw identityError('CURRENT_PASSWORD_INVALID', 403)
      expectedPasswordHash = status.passwordHash
    } else {
      if (!status.canSetPassword) throw identityError('OTP_REAUTH_REQUIRED', 403)
      allowRecentOtp = true
    }
    const passwordHash = await hash(command.password, options)
    if (!await this.store.setPassword({
      userId: command.userId,
      sessionHash,
      passwordHash, expectedPasswordHash, allowRecentOtp, now, requestId: command.requestId,
    })) throw identityError('OTP_REAUTH_REQUIRED', 403)
  }

  async resetPassword(command: { resetGrant: string; sessionToken: string | null; password: string; requestId: string }): Promise<void> {
    this.enabled()
    const length = Array.from(command.password).length
    if (length < 8 || length > 64 || Buffer.byteLength(command.password, 'utf8') > 1024) throw identityError('PASSWORD_INVALID', 422)
    if (!/^[A-Za-z0-9_-]{43}$/.test(command.resetGrant)) throw identityError('PASSWORD_RESET_INVALID', 403)
    const passwordHash = await hash(command.password, options)
    const updated = await this.store.resetPassword({
      grantHash: keyedHash(this.config.authTokenSecret, command.resetGrant),
      sessionHash: command.sessionToken ? keyedHash(this.config.authTokenSecret, command.sessionToken) : null,
      passwordHash, now: this.now(), requestId: command.requestId,
    })
    if (!updated) throw identityError('PASSWORD_RESET_INVALID', 403)
  }
}
