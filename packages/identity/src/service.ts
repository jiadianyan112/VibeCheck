import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { IdentityConfig } from '@vibecheck/config'

import {
  decryptText,
  encryptText,
  hashOtp,
  keyedHash,
  opaqueToken,
  sixDigitOtp,
  verifyHash,
} from './crypto.js'
import { identityError } from './errors.js'
import { canUseReturnTo, maskEmail, normalizeEmail, normalizeReturnTo } from './normalize.js'
import { permissionsFor, primaryRole } from './permissions.js'
import type {
  ChallengeForVerification,
  CompleteVerificationInput,
  CompleteVerificationResult,
  CreateChallengeInput,
  CreateChallengeRecord,
  StoredSession,
} from './store.js'
import type {
  EmailSender,
  SessionProjection,
  StartChallengeCommand,
  StartChallengeResult,
  VerifyChallengeCommand,
  VerifyChallengeResult,
} from './types.js'

export interface IdentityStore {
  createChallenge(input: CreateChallengeInput): Promise<CreateChallengeRecord>
  markChallengeDelivered(challengeId: string, receiptId: string, now: Date): Promise<void>
  markChallengeDeliveryFailed(challengeId: string, now: Date): Promise<void>
  getChallenge(challengeId: string, authFlowId: string): Promise<ChallengeForVerification | null>
  completeVerification(input: CompleteVerificationInput): Promise<CompleteVerificationResult>
  getSession(sessionHash: Buffer, now: Date): Promise<StoredSession | null>
  revokeSession(
    sessionHash: Buffer,
    expectedVersion: number,
    requestId: string,
    now: Date,
  ): Promise<boolean>
}

export interface IdentityServiceDependencies {
  readonly config: IdentityConfig
  readonly store: IdentityStore
  readonly emailSender: EmailSender
  readonly now?: () => Date
}

function requireUuid(name: string, value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw identityError(`${name}_INVALID`, 422)
  }
  return value.toLowerCase()
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export class IdentityService {
  private readonly config: IdentityConfig
  private readonly store: IdentityStore
  private readonly emailSender: EmailSender
  private readonly now: () => Date

  constructor(dependencies: IdentityServiceDependencies) {
    this.config = dependencies.config
    this.store = dependencies.store
    this.emailSender = dependencies.emailSender
    this.now = dependencies.now ?? (() => new Date())
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw identityError('AUTH_SERVICE_UNAVAILABLE', 503, true)
  }

  private hashOptional(value: string | null): Buffer | null {
    return value === null ? null : keyedHash(this.config.authTokenSecret, value)
  }

  async startChallenge(command: StartChallengeCommand): Promise<StartChallengeResult> {
    this.assertEnabled()
    const now = this.now()
    const email = normalizeEmail(command.email)
    const returnTo = normalizeReturnTo(command.returnTo)
    const clientRequestId = requireUuid('CLIENT_REQUEST_ID', command.clientRequestId)
    const anonymousSubjectId = requireUuid('ANONYMOUS_SUBJECT_ID', command.anonymousSubjectId)
    const pendingActionId = command.pendingActionId === null
      ? null
      : requireUuid('PENDING_ACTION_ID', command.pendingActionId)
    const normalizedEmailHash = keyedHash(this.config.emailHashPepper, email)
    const currentSession = command.sessionToken === null
      ? null
      : await this.getStoredSession(command.sessionToken)

    if (command.purpose === 'admin_confirm') {
      if (pendingActionId !== null) throw identityError('PENDING_ACTION_NOT_ALLOWED', 422)
      if (currentSession === null) throw identityError('AUTHENTICATION_REQUIRED', 401)
      if (!currentSession.normalizedEmailHash.equals(normalizedEmailHash)) {
        throw identityError('ADMIN_CONFIRM_ACCOUNT_MISMATCH', 403)
      }
      if (!currentSession.roles.includes('editor') && !currentSession.roles.includes('admin')) {
        throw identityError('PERMISSION_DENIED', 403)
      }
      if (command.previewToken === null || command.previewToken.length < 32) {
        throw identityError('PREVIEW_TOKEN_REQUIRED', 422)
      }
    }

    const otp = sixDigitOtp()
    const otpSalt = randomBytes(16)
    const browserBindingToken = command.browserBindingToken ?? opaqueToken()
    const challengeId = randomUUID()
    const authFlowId = randomUUID()
    const expiresAt = addSeconds(now, this.config.otpTtlSeconds)
    const resendAfter = addSeconds(now, this.config.otpResendSeconds)
    const ipHash = this.hashOptional(command.ipAddress)
    const payloadHash = sha256(JSON.stringify({
      email_hash: normalizedEmailHash.toString('hex'),
      purpose: command.purpose,
      return_to: returnTo,
      preview_hash: this.hashOptional(command.previewToken)?.toString('hex') ?? null,
      pending_action_id: pendingActionId,
    }))
    const created = await this.store.createChallenge({
      challengeId,
      authFlowId,
      purpose: command.purpose,
      normalizedEmailHash,
      emailCiphertext: encryptText(this.config.emailEncryptionKey, email),
      emailKeyVersion: this.config.emailEncryptionKeyVersion,
      otpHash: hashOtp(this.config.otpPepper, otpSalt, otp),
      otpSalt,
      browserBindingHash: keyedHash(this.config.authTokenSecret, browserBindingToken),
      anonymousSubjectId,
      anonymousSubjectHash: keyedHash(this.config.authTokenSecret, `anonymous:${anonymousSubjectId}`),
      pendingActionId,
      clientRequestId,
      requestPayloadHash: payloadHash,
      returnTo,
      ipHash,
      primarySessionHash: currentSession?.sessionIdHash ?? null,
      previewTokenHash: this.hashOptional(command.previewToken),
      expiresAt,
      now,
      resendSeconds: this.config.otpResendSeconds,
      rateWindowSeconds: this.config.rateWindowSeconds,
      emailSendLimit: this.config.emailSendLimit,
      ipSendLimit: this.config.ipSendLimit,
    })

    if (created.isNew) {
      try {
        const delivery = await this.emailSender.sendOtp({
          to: email,
          code: otp,
          expiresInMinutes: Math.ceil(this.config.otpTtlSeconds / 60),
          idempotencyKey: created.challengeId,
        })
        await this.store.markChallengeDelivered(created.challengeId, delivery.receiptId, now)
      } catch (error) {
        await this.store.markChallengeDeliveryFailed(created.challengeId, now)
        throw error
      }
    }

    return Object.freeze({
      authFlowId: created.authFlowId,
      challengeId: created.challengeId,
      expiresAt: created.expiresAt.toISOString(),
      resendAfter: created.isNew
        ? resendAfter.toISOString()
        : addSeconds(created.createdAt, this.config.otpResendSeconds).toISOString(),
      maskedEmail: maskEmail(email),
      browserBindingToken,
    })
  }

  async verifyChallenge(command: VerifyChallengeCommand): Promise<VerifyChallengeResult> {
    this.assertEnabled()
    const challengeId = requireUuid('CHALLENGE_ID', command.challengeId)
    const authFlowId = requireUuid('AUTH_FLOW_ID', command.authFlowId)
    requireUuid('CLIENT_REQUEST_ID', command.clientRequestId)
    if (command.browserBindingToken === null) throw identityError('AUTH_FLOW_MISMATCH', 403)

    const challenge = await this.store.getChallenge(challengeId, authFlowId)
    if (challenge === null) throw identityError('AUTH_CHALLENGE_NOT_FOUND', 404)
    const submittedOtpHash = /^\d{6}$/.test(command.otp)
      ? hashOtp(this.config.otpPepper, challenge.otpSalt, command.otp)
      : randomBytes(challenge.otpHash.length)
    const otpValid = verifyHash(challenge.otpHash, submittedOtpHash)
    const now = this.now()
    const sessionToken = opaqueToken()
    const csrfToken = opaqueToken()
    const result = await this.store.completeVerification({
      challengeId,
      authFlowId,
      browserBindingHash: keyedHash(this.config.authTokenSecret, command.browserBindingToken),
      otpValid,
      currentSessionHash: this.hashOptional(command.currentSessionToken),
      newSessionHash: keyedHash(this.config.authTokenSecret, sessionToken),
      newCsrfHash: keyedHash(this.config.authTokenSecret, csrfToken),
      sessionExpiresAt: addSeconds(now, this.config.sessionTtlSeconds),
      ipHash: this.hashOptional(command.ipAddress),
      userAgentHash: this.hashOptional(command.userAgent),
      reauthExpiresAt: addSeconds(now, 300),
      identityLinkExpiresAt: addSeconds(now, 300),
      requestId: command.requestId,
      now,
    })
    if (result.kind === 'error') throw identityError(result.code, result.httpStatus)
    if (result.kind === 'admin_confirm') {
      return Object.freeze({
        purpose: 'admin_confirm',
        reauthGrantId: result.reauthGrantId,
        recentAuthAt: result.recentAuthAt.toISOString(),
        returnTo: result.returnTo,
      })
    }

    const email = this.decryptStoredEmail(result.emailCiphertext, result.emailKeyVersion)
    const safeReturnTo = canUseReturnTo(result.returnTo, result.roles) ? result.returnTo : '/me'
    return Object.freeze({
      purpose: 'login',
      session: this.sessionProjection({
        sessionIdHash: keyedHash(this.config.authTokenSecret, sessionToken),
        csrfTokenHash: keyedHash(this.config.authTokenSecret, csrfToken),
        userId: result.userId,
        anonymousSubjectId: result.anonymousSubjectId,
        userStatus: result.accountStatus,
        rolesVersion: result.rolesVersion,
        sessionVersion: result.sessionVersion,
        recentAuthAt: result.recentAuthAt,
        expiresAt: result.expiresAt,
        emailCiphertext: result.emailCiphertext,
        emailKeyVersion: result.emailKeyVersion,
        normalizedEmailHash: Buffer.alloc(0),
        roles: result.roles,
      }, csrfToken, email),
      sessionToken,
      anonymousSubjectId: result.anonymousSubjectId,
      pendingActionId: result.pendingActionId,
      returnTo: safeReturnTo,
      identityLinks: Object.freeze(result.identityLinks.map((link) => Object.freeze({
        identityLinkId: link.identityLinkId,
        purpose: link.purpose,
        expiresAt: link.expiresAt.toISOString(),
      }))),
    })
  }

  async getSession(sessionToken: string | null, csrfToken: string | null): Promise<SessionProjection> {
    this.assertEnabled()
    if (sessionToken === null || csrfToken === null) throw identityError('AUTHENTICATION_REQUIRED', 401)
    const stored = await this.getStoredSession(sessionToken)
    if (stored === null) throw identityError('SESSION_INVALID', 401)
    const suppliedCsrfHash = keyedHash(this.config.authTokenSecret, csrfToken)
    if (!verifyHash(stored.csrfTokenHash, suppliedCsrfHash)) throw identityError('CSRF_INVALID', 403)
    const email = this.decryptStoredEmail(stored.emailCiphertext, stored.emailKeyVersion)
    return this.sessionProjection(stored, csrfToken, email)
  }

  async logout(
    sessionToken: string | null,
    csrfToken: string | null,
    expectedVersion: number,
    requestId: string,
  ): Promise<void> {
    const session = await this.getSession(sessionToken, csrfToken)
    const revoked = await this.store.revokeSession(
      keyedHash(this.config.authTokenSecret, sessionToken!),
      expectedVersion,
      requestId,
      this.now(),
    )
    if (!revoked) throw identityError('SESSION_VERSION_CONFLICT', 409)
    if (session.sessionVersion !== expectedVersion) throw identityError('SESSION_VERSION_CONFLICT', 409)
  }

  private async getStoredSession(sessionToken: string): Promise<StoredSession | null> {
    if (sessionToken.length < 32 || sessionToken.length > 128) return null
    return this.store.getSession(keyedHash(this.config.authTokenSecret, sessionToken), this.now())
  }

  private decryptStoredEmail(ciphertext: Buffer, keyVersion: string): string {
    if (keyVersion !== this.config.emailEncryptionKeyVersion) {
      throw identityError('EMAIL_KEY_VERSION_UNAVAILABLE', 503, true)
    }
    return decryptText(this.config.emailEncryptionKey, ciphertext)
  }

  private sessionProjection(
    session: StoredSession,
    csrfToken: string,
    email: string,
  ): SessionProjection {
    return Object.freeze({
      authenticated: true,
      userId: session.userId,
      displayName: maskEmail(email),
      accountStatus: session.userStatus,
      roles: Object.freeze([...session.roles]),
      primaryRole: primaryRole(session.roles),
      permissions: Object.freeze(permissionsFor(session.roles, session.userStatus)),
      sessionVersion: session.sessionVersion,
      csrfToken,
      recentAuthAt: session.recentAuthAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    })
  }
}
