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
  getStatus(userId: string, sessionHash: Buffer, now: Date): Promise<{ hasPassword: boolean; canSetPassword: boolean }>
  setPassword(input: { userId: string; sessionHash: Buffer; passwordHash: string; now: Date; requestId: string }): Promise<boolean>
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
    return this.store.getStatus(userId, keyedHash(this.config.authTokenSecret, sessionToken), this.now())
  }

  async setPassword(command: { sessionToken: string; userId: string; password: string; requestId: string }): Promise<void> {
    this.enabled()
    const length = Array.from(command.password).length
    if (length < 8 || length > 64 || Buffer.byteLength(command.password, 'utf8') > 1024) {
      throw identityError('PASSWORD_INVALID', 422)
    }
    const sessionHash = keyedHash(this.config.authTokenSecret, command.sessionToken)
    const status = await this.store.getStatus(command.userId, sessionHash, this.now())
    if (!status.canSetPassword) throw identityError('OTP_REAUTH_REQUIRED', 403)
    const passwordHash = await hash(command.password, options)
    if (!await this.store.setPassword({
      userId: command.userId,
      sessionHash,
      passwordHash, now: this.now(), requestId: command.requestId,
    })) throw identityError('OTP_REAUTH_REQUIRED', 403)
  }
}
