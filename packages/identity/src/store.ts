import type { Pool, PoolClient } from 'pg'

import { identityError } from './errors.js'
import type { AccountStatus, AuthPurpose, IdentityRole } from './types.js'

export interface CreateChallengeRecord {
  readonly challengeId: string
  readonly authFlowId: string
  readonly status: string
  readonly expiresAt: Date
  readonly createdAt: Date
  readonly deliveredAt: Date | null
  readonly sendReceiptRef: string | null
  readonly isNew: boolean
}

export interface CreateChallengeInput {
  readonly challengeId: string
  readonly authFlowId: string
  readonly purpose: AuthPurpose
  readonly normalizedEmailHash: Buffer
  readonly emailCiphertext: Buffer
  readonly emailKeyVersion: string
  readonly otpHash: Buffer
  readonly otpSalt: Buffer
  readonly browserBindingHash: Buffer
  readonly anonymousSubjectId: string
  readonly clientRequestId: string
  readonly requestPayloadHash: string
  readonly returnTo: string
  readonly ipHash: Buffer | null
  readonly primarySessionHash: Buffer | null
  readonly previewTokenHash: Buffer | null
  readonly expiresAt: Date
  readonly now: Date
  readonly resendSeconds: number
  readonly rateWindowSeconds: number
  readonly emailSendLimit: number
  readonly ipSendLimit: number
}

export interface ChallengeForVerification {
  readonly challengeId: string
  readonly authFlowId: string
  readonly purpose: AuthPurpose
  readonly status: string
  readonly otpHash: Buffer
  readonly otpSalt: Buffer
  readonly browserBindingHash: Buffer
  readonly expiresAt: Date
}

export interface StoredSession {
  readonly sessionIdHash: Buffer
  readonly csrfTokenHash: Buffer
  readonly userId: string
  readonly anonymousSubjectId: string
  readonly userStatus: Exclude<AccountStatus, 'disabled'>
  readonly rolesVersion: number
  readonly sessionVersion: number
  readonly recentAuthAt: Date
  readonly expiresAt: Date
  readonly emailCiphertext: Buffer
  readonly emailKeyVersion: string
  readonly normalizedEmailHash: Buffer
  readonly roles: readonly IdentityRole[]
}

export interface CompleteVerificationInput {
  readonly challengeId: string
  readonly authFlowId: string
  readonly browserBindingHash: Buffer
  readonly otpValid: boolean
  readonly currentSessionHash: Buffer | null
  readonly newSessionHash: Buffer
  readonly newCsrfHash: Buffer
  readonly sessionExpiresAt: Date
  readonly ipHash: Buffer | null
  readonly userAgentHash: Buffer | null
  readonly reauthExpiresAt: Date
  readonly identityLinkExpiresAt: Date
  readonly requestId: string
  readonly now: Date
}

export type CompleteVerificationResult =
  | { readonly kind: 'error'; readonly code: string; readonly httpStatus: number }
  | {
      readonly kind: 'login'
      readonly userId: string
      readonly accountStatus: Exclude<AccountStatus, 'disabled'>
      readonly rolesVersion: number
      readonly roles: readonly IdentityRole[]
      readonly anonymousSubjectId: string
      readonly emailCiphertext: Buffer
      readonly emailKeyVersion: string
      readonly recentAuthAt: Date
      readonly expiresAt: Date
      readonly sessionVersion: number
      readonly returnTo: string
      readonly identityLinks: readonly {
        readonly identityLinkId: string
        readonly purpose: 'query_continuation' | 'comparison_merge'
        readonly expiresAt: Date
      }[]
    }
  | {
      readonly kind: 'admin_confirm'
      readonly reauthGrantId: string
      readonly recentAuthAt: Date
      readonly returnTo: string
    }

interface ExistingChallengeRow {
  challenge_id: string
  auth_flow_id: string
  status: string
  expires_at: Date
  created_at: Date
  delivered_at: Date | null
  send_receipt_ref: string | null
  request_payload_hash: string
}

interface VerificationRow {
  challenge_id: string
  auth_flow_id: string
  purpose: AuthPurpose
  status: string
  attempt_count: number
  max_attempts: number
  normalized_email_hash: Buffer
  email_ciphertext: Buffer
  email_key_version: string
  otp_hash: Buffer
  otp_salt: Buffer
  browser_binding_hash: Buffer
  anonymous_subject_id: string
  primary_session_id_hash: Buffer | null
  preview_token_hash: Buffer | null
  return_to: string
  expires_at: Date
}

interface SessionRow {
  session_id_hash: Buffer
  csrf_token_hash: Buffer
  user_id: string
  anonymous_subject_id: string
  user_status: Exclude<AccountStatus, 'disabled'>
  roles_version: string
  session_version: string
  recent_auth_at: Date
  expires_at: Date
  email_ciphertext: Buffer
  email_key_version: string
  normalized_email_hash: Buffer
  roles: IdentityRole[]
}

function asChallenge(row: ExistingChallengeRow, isNew: boolean): CreateChallengeRecord {
  return Object.freeze({
    challengeId: row.challenge_id,
    authFlowId: row.auth_flow_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    sendReceiptRef: row.send_receipt_ref,
    isNew,
  })
}

function sortedRoles(roles: readonly IdentityRole[]): IdentityRole[] {
  const order = new Map<IdentityRole, number>([
    ['user', 0],
    ['verified_author', 1],
    ['editor', 2],
    ['admin', 3],
  ])
  return [...new Set(roles)].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
}

async function rolesFor(client: PoolClient, userId: string): Promise<IdentityRole[]> {
  const result = await client.query<{ role: IdentityRole }>(
    `SELECT role
     FROM iam.user_roles
     WHERE user_id = $1 AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
    [userId],
  )
  return sortedRoles(result.rows.map(({ role }) => role).length ? result.rows.map(({ role }) => role) : ['user'])
}

export class PostgresIdentityStore {
  constructor(private readonly pool: Pool) {}

  async createChallenge(input: CreateChallengeInput): Promise<CreateChallengeRecord> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query<ExistingChallengeRow>(
        `SELECT challenge_id,auth_flow_id,status,expires_at,created_at,delivered_at,send_receipt_ref,
           request_payload_hash
         FROM iam.auth_email_challenges
         WHERE anonymous_subject_id=$1 AND purpose=$2 AND client_request_id=$3`,
        [input.anonymousSubjectId, input.purpose, input.clientRequestId],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].request_payload_hash !== input.requestPayloadHash) {
          throw identityError('IDEMPOTENCY_PAYLOAD_MISMATCH', 409)
        }
        await client.query('COMMIT')
        return asChallenge(existing.rows[0], false)
      }

      const emailRate = await this.incrementRateBucket(
        client,
        input.normalizedEmailHash,
        'email_send',
        input.rateWindowSeconds,
      )
      const ipRate = input.ipHash === null
        ? 0
        : await this.incrementRateBucket(client, input.ipHash, 'ip_send', input.rateWindowSeconds)
      if (emailRate > input.emailSendLimit || ipRate > input.ipSendLimit) {
        await client.query('COMMIT')
        throw identityError('AUTH_RATE_LIMITED', 429, true, input.rateWindowSeconds)
      }

      const recent = await client.query<{ retry_after: number }>(
        `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM
           (created_at + make_interval(secs => $2) - $3::timestamptz))))::int AS retry_after
         FROM iam.auth_email_challenges
         WHERE normalized_email_hash=$1 AND created_at > $3::timestamptz - make_interval(secs => $2)
         ORDER BY created_at DESC LIMIT 1`,
        [input.normalizedEmailHash, input.resendSeconds, input.now],
      )
      if (recent.rows[0]) {
        await client.query('COMMIT')
        throw identityError('OTP_RESEND_TOO_SOON', 429, true, recent.rows[0].retry_after)
      }

      await client.query(
        `UPDATE iam.auth_email_challenges
         SET status='cancelled',cancelled_at=$2
         WHERE normalized_email_hash=$1 AND status='pending'`,
        [input.normalizedEmailHash, input.now],
      )
      const inserted = await client.query<ExistingChallengeRow>(
        `INSERT INTO iam.auth_email_challenges (
           challenge_id,auth_flow_id,purpose,normalized_email_hash,email_ciphertext,
           email_key_version,otp_hash,otp_salt,browser_binding_hash,anonymous_subject_id,
           client_request_id,request_payload_hash,return_to,ip_hash,primary_session_id_hash,
           preview_token_hash,status,attempt_count,max_attempts,expires_at,created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
           'pending',0,5,$17,$18
         )
         RETURNING challenge_id,auth_flow_id,status,expires_at,created_at,delivered_at,send_receipt_ref,
           request_payload_hash`,
        [
          input.challengeId,
          input.authFlowId,
          input.purpose,
          input.normalizedEmailHash,
          input.emailCiphertext,
          input.emailKeyVersion,
          input.otpHash,
          input.otpSalt,
          input.browserBindingHash,
          input.anonymousSubjectId,
          input.clientRequestId,
          input.requestPayloadHash,
          input.returnTo,
          input.ipHash,
          input.primarySessionHash,
          input.previewTokenHash,
          input.expiresAt,
          input.now,
        ],
      )
      await client.query('COMMIT')
      return asChallenge(inserted.rows[0]!, true)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async incrementRateBucket(
    client: PoolClient,
    keyHash: Buffer,
    scope: 'email_send' | 'ip_send',
    windowSeconds: number,
  ): Promise<number> {
    const result = await client.query<{ hit_count: number }>(
      `INSERT INTO iam.auth_rate_limit_buckets (
         bucket_key_hash,scope,window_started_at,hit_count,updated_at
       ) VALUES (
         $1,$2,date_bin(make_interval(secs => $3),now(),timestamptz '2000-01-01'),1,now()
       )
       ON CONFLICT (bucket_key_hash,scope,window_started_at)
       DO UPDATE SET hit_count=iam.auth_rate_limit_buckets.hit_count+1,updated_at=now()
       RETURNING hit_count`,
      [keyHash, scope, windowSeconds],
    )
    return result.rows[0]!.hit_count
  }

  async markChallengeDelivered(challengeId: string, receiptId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE iam.auth_email_challenges
       SET send_receipt_ref=$2,delivered_at=$3
       WHERE challenge_id=$1 AND status='pending' AND delivered_at IS NULL`,
      [challengeId, receiptId.slice(0, 255), now],
    )
  }

  async markChallengeDeliveryFailed(challengeId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE iam.auth_email_challenges
       SET status='cancelled',cancelled_at=$2
       WHERE challenge_id=$1 AND status='pending' AND delivered_at IS NULL`,
      [challengeId, now],
    )
  }

  async getChallenge(challengeId: string, authFlowId: string): Promise<ChallengeForVerification | null> {
    const result = await this.pool.query<VerificationRow>(
      `SELECT challenge_id,auth_flow_id,purpose,status,attempt_count,max_attempts,
         normalized_email_hash,email_ciphertext,email_key_version,otp_hash,otp_salt,
         browser_binding_hash,anonymous_subject_id,primary_session_id_hash,
         preview_token_hash,return_to,expires_at
       FROM iam.auth_email_challenges
       WHERE challenge_id=$1 AND auth_flow_id=$2`,
      [challengeId, authFlowId],
    )
    const row = result.rows[0]
    if (!row) return null
    return Object.freeze({
      challengeId: row.challenge_id,
      authFlowId: row.auth_flow_id,
      purpose: row.purpose,
      status: row.status,
      otpHash: row.otp_hash,
      otpSalt: row.otp_salt,
      browserBindingHash: row.browser_binding_hash,
      expiresAt: row.expires_at,
    })
  }

  async completeVerification(input: CompleteVerificationInput): Promise<CompleteVerificationResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<VerificationRow>(
        `SELECT challenge_id,auth_flow_id,purpose,status,attempt_count,max_attempts,
           normalized_email_hash,email_ciphertext,email_key_version,otp_hash,otp_salt,
           browser_binding_hash,anonymous_subject_id,primary_session_id_hash,
           preview_token_hash,return_to,expires_at
         FROM iam.auth_email_challenges
         WHERE challenge_id=$1 AND auth_flow_id=$2
         FOR UPDATE`,
        [input.challengeId, input.authFlowId],
      )
      const challenge = result.rows[0]
      if (!challenge) {
        await client.query('COMMIT')
        return { kind: 'error', code: 'AUTH_CHALLENGE_NOT_FOUND', httpStatus: 404 }
      }
      if (!challenge.browser_binding_hash.equals(input.browserBindingHash)) {
        await this.insertSecurityEvent(client, 'auth_browser_binding_rejected', 'warning', input.requestId, 'AUTH_FLOW_MISMATCH')
        await client.query('COMMIT')
        return { kind: 'error', code: 'AUTH_FLOW_MISMATCH', httpStatus: 403 }
      }
      if (challenge.status !== 'pending') {
        const mapped = challenge.status === 'consumed'
          ? ['OTP_ALREADY_USED', 410] as const
          : challenge.status === 'attempts_exceeded'
            ? ['OTP_ATTEMPTS_EXCEEDED', 422] as const
            : challenge.status === 'expired'
              ? ['OTP_EXPIRED', 410] as const
              : ['OTP_CANCELLED', 410] as const
        await client.query('COMMIT')
        return { kind: 'error', code: mapped[0], httpStatus: mapped[1] }
      }
      if (challenge.expires_at <= input.now) {
        await client.query(
          `UPDATE iam.auth_email_challenges SET status='expired' WHERE challenge_id=$1`,
          [challenge.challenge_id],
        )
        await client.query('COMMIT')
        return { kind: 'error', code: 'OTP_EXPIRED', httpStatus: 410 }
      }
      if (!input.otpValid) {
        const nextAttempts = challenge.attempt_count + 1
        const nextStatus = nextAttempts >= challenge.max_attempts ? 'attempts_exceeded' : 'pending'
        await client.query(
          `UPDATE iam.auth_email_challenges SET attempt_count=$2,status=$3 WHERE challenge_id=$1`,
          [challenge.challenge_id, nextAttempts, nextStatus],
        )
        await this.insertSecurityEvent(
          client,
          'auth_otp_rejected',
          nextStatus === 'attempts_exceeded' ? 'high' : 'warning',
          input.requestId,
          nextStatus === 'attempts_exceeded' ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID',
        )
        await client.query('COMMIT')
        return {
          kind: 'error',
          code: nextStatus === 'attempts_exceeded' ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID',
          httpStatus: 422,
        }
      }

      const completed = challenge.purpose === 'login'
        ? await this.completeLogin(client, challenge, input)
        : await this.completeAdminConfirm(client, challenge, input)
      await client.query('COMMIT')
      return completed
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async completeLogin(
    client: PoolClient,
    challenge: VerificationRow,
    input: CompleteVerificationInput,
  ): Promise<CompleteVerificationResult> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea,'hex'),0))`,
      [challenge.normalized_email_hash],
    )
    const identity = await client.query<{ user_id: string; status: AccountStatus; role_version: string }>(
      `SELECT identity.user_id,user_account.status,user_account.role_version
       FROM iam.user_email_identities identity
       JOIN iam.users user_account ON user_account.user_id=identity.user_id
       WHERE identity.normalized_email_hash=$1 AND identity.status='active'
       FOR UPDATE OF identity,user_account`,
      [challenge.normalized_email_hash],
    )
    let userId: string
    let accountStatus: AccountStatus
    let rolesVersion: number
    if (identity.rows[0]) {
      userId = identity.rows[0].user_id
      accountStatus = identity.rows[0].status
      rolesVersion = Number(identity.rows[0].role_version)
    } else {
      const user = await client.query<{ user_id: string; status: AccountStatus; role_version: string }>(
        `INSERT INTO iam.users (status,role_version,privacy_state,created_at,updated_at)
         VALUES ('active',1,'active',$1,$1)
         RETURNING user_id,status,role_version`,
        [input.now],
      )
      userId = user.rows[0]!.user_id
      accountStatus = user.rows[0]!.status
      rolesVersion = Number(user.rows[0]!.role_version)
      await client.query(
        `INSERT INTO iam.user_email_identities (
           user_id,normalized_email_hash,email_ciphertext,key_version,status,verified_at,created_at
         ) VALUES ($1,$2,$3,$4,'active',$5,$5)`,
        [
          userId,
          challenge.normalized_email_hash,
          challenge.email_ciphertext,
          challenge.email_key_version,
          input.now,
        ],
      )
      await client.query(
        `INSERT INTO iam.user_roles (user_id,role,granted_by_operation_id,valid_from,created_at)
         VALUES ($1,'user','OP-AUTH-CALLBACK',$2,$2)`,
        [userId, input.now],
      )
    }

    await client.query(
      `UPDATE iam.auth_email_challenges SET status='consumed',consumed_at=$2 WHERE challenge_id=$1`,
      [challenge.challenge_id, input.now],
    )
    if (accountStatus === 'disabled') {
      await this.insertSecurityEvent(client, 'auth_disabled_account_rejected', 'high', input.requestId, 'ACCOUNT_DISABLED')
      return { kind: 'error', code: 'ACCOUNT_DISABLED', httpStatus: 403 }
    }
    if (input.currentSessionHash !== null) {
      await client.query(
        `UPDATE iam.sessions SET status='revoked',revoked_at=$2
         WHERE session_id_hash=$1 AND status='active'`,
        [input.currentSessionHash, input.now],
      )
    }
    await client.query(
      `INSERT INTO iam.sessions (
         session_id_hash,csrf_token_hash,user_id,anonymous_subject_id,roles_version,
         session_version,status,recent_auth_at,expires_at,created_at,last_seen_at,
         auth_method,ip_hash,user_agent_hash
       ) VALUES ($1,$2,$3,$4,$5,1,'active',$6,$7,$6,$6,'email_otp',$8,$9)`,
      [
        input.newSessionHash,
        input.newCsrfHash,
        userId,
        challenge.anonymous_subject_id,
        rolesVersion,
        input.now,
        input.sessionExpiresAt,
        input.ipHash,
        input.userAgentHash,
      ],
    )
    const roles = await rolesFor(client, userId)
    const identityLinks = await client.query<{
      identity_link_id: string
      purpose: 'query_continuation' | 'comparison_merge'
      expires_at: Date
    }>(
      `INSERT INTO iam.identity_links (
         anonymous_subject_id,user_id,auth_flow_id,purpose,status,issued_at,expires_at
       ) VALUES
         ($1,$2,$3,'query_continuation','active',$4,$5),
         ($1,$2,$3,'comparison_merge','active',$4,$5)
       RETURNING identity_link_id,purpose,expires_at`,
      [
        challenge.anonymous_subject_id,
        userId,
        challenge.auth_flow_id,
        input.now,
        input.identityLinkExpiresAt,
      ],
    )
    await this.insertSecurityEvent(client, 'auth_login_completed', 'info', input.requestId, null)
    return {
      kind: 'login',
      userId,
      accountStatus,
      rolesVersion,
      roles,
      anonymousSubjectId: challenge.anonymous_subject_id,
      emailCiphertext: challenge.email_ciphertext,
      emailKeyVersion: challenge.email_key_version,
      recentAuthAt: input.now,
      expiresAt: input.sessionExpiresAt,
      sessionVersion: 1,
      returnTo: challenge.return_to,
      identityLinks: Object.freeze(identityLinks.rows.map((link) => Object.freeze({
        identityLinkId: link.identity_link_id,
        purpose: link.purpose,
        expiresAt: link.expires_at,
      }))),
    }
  }

  private async completeAdminConfirm(
    client: PoolClient,
    challenge: VerificationRow,
    input: CompleteVerificationInput,
  ): Promise<CompleteVerificationResult> {
    if (challenge.primary_session_id_hash === null || challenge.preview_token_hash === null) {
      return { kind: 'error', code: 'ADMIN_CONFIRM_BINDING_INVALID', httpStatus: 403 }
    }
    if (input.currentSessionHash === null || !challenge.primary_session_id_hash.equals(input.currentSessionHash)) {
      return { kind: 'error', code: 'ADMIN_CONFIRM_SESSION_MISMATCH', httpStatus: 403 }
    }
    const session = await client.query<{
      user_id: string
      user_status: AccountStatus
      roles_version: string
      user_role_version: string
      email_hash: Buffer
    }>(
      `SELECT session.user_id,user_account.status AS user_status,session.roles_version,
         user_account.role_version AS user_role_version,
         identity.normalized_email_hash AS email_hash
       FROM iam.sessions session
       JOIN iam.users user_account ON user_account.user_id=session.user_id
       JOIN iam.user_email_identities identity ON identity.user_id=session.user_id AND identity.status='active'
       WHERE session.session_id_hash=$1 AND session.status='active' AND session.expires_at>$2
       FOR UPDATE OF session`,
      [input.currentSessionHash, input.now],
    )
    const active = session.rows[0]
    if (
      !active ||
      active.user_status !== 'active' ||
      active.roles_version !== active.user_role_version ||
      !active.email_hash.equals(challenge.normalized_email_hash)
    ) {
      return { kind: 'error', code: 'ADMIN_CONFIRM_SESSION_MISMATCH', httpStatus: 403 }
    }
    const roles = await rolesFor(client, active.user_id)
    if (!roles.includes('editor') && !roles.includes('admin')) {
      return { kind: 'error', code: 'PERMISSION_DENIED', httpStatus: 403 }
    }
    const grant = await client.query<{ reauth_grant_id: string }>(
      `INSERT INTO iam.admin_reauth_grants (
         user_id,primary_session_id_hash,preview_token_hash,roles_version,status,issued_at,expires_at
       ) VALUES ($1,$2,$3,$4,'active',$5,$6)
       RETURNING reauth_grant_id`,
      [
        active.user_id,
        input.currentSessionHash,
        challenge.preview_token_hash,
        Number(active.roles_version),
        input.now,
        input.reauthExpiresAt,
      ],
    )
    await client.query(
      `UPDATE iam.sessions SET recent_auth_at=$2,last_seen_at=$2 WHERE session_id_hash=$1`,
      [input.currentSessionHash, input.now],
    )
    await client.query(
      `UPDATE iam.auth_email_challenges SET status='consumed',consumed_at=$2 WHERE challenge_id=$1`,
      [challenge.challenge_id, input.now],
    )
    await this.insertSecurityEvent(client, 'auth_admin_reauthenticated', 'info', input.requestId, null)
    return {
      kind: 'admin_confirm',
      reauthGrantId: grant.rows[0]!.reauth_grant_id,
      recentAuthAt: input.now,
      returnTo: challenge.return_to,
    }
  }

  async getSession(sessionHash: Buffer, now: Date): Promise<StoredSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT session.session_id_hash,session.csrf_token_hash,session.user_id,
         session.anonymous_subject_id,user_account.status AS user_status,
         session.roles_version,session.session_version,session.recent_auth_at,
         session.expires_at,identity.email_ciphertext,identity.key_version AS email_key_version,
         identity.normalized_email_hash,
         COALESCE(array_agg(role.role ORDER BY role.role) FILTER (WHERE role.role IS NOT NULL),ARRAY['user']::varchar[]) AS roles
       FROM iam.sessions session
       JOIN iam.users user_account ON user_account.user_id=session.user_id
       JOIN iam.user_email_identities identity ON identity.user_id=session.user_id AND identity.status='active'
       LEFT JOIN iam.user_roles role ON role.user_id=session.user_id
         AND role.valid_from<=$2 AND (role.valid_to IS NULL OR role.valid_to>$2)
       WHERE session.session_id_hash=$1 AND session.status='active' AND session.expires_at>$2
         AND user_account.status IN ('active','restricted')
         AND session.roles_version=user_account.role_version
       GROUP BY session.session_id_hash,session.csrf_token_hash,session.user_id,
         session.anonymous_subject_id,user_account.status,session.roles_version,
         session.session_version,session.recent_auth_at,session.expires_at,
         identity.email_ciphertext,identity.key_version,identity.normalized_email_hash`,
      [sessionHash, now],
    )
    const row = result.rows[0]
    if (!row) return null
    await this.pool.query(
      `UPDATE iam.sessions SET last_seen_at=$2
       WHERE session_id_hash=$1 AND last_seen_at<$2-make_interval(mins => 5)`,
      [sessionHash, now],
    )
    return Object.freeze({
      sessionIdHash: row.session_id_hash,
      csrfTokenHash: row.csrf_token_hash,
      userId: row.user_id,
      anonymousSubjectId: row.anonymous_subject_id,
      userStatus: row.user_status,
      rolesVersion: Number(row.roles_version),
      sessionVersion: Number(row.session_version),
      recentAuthAt: row.recent_auth_at,
      expiresAt: row.expires_at,
      emailCiphertext: row.email_ciphertext,
      emailKeyVersion: row.email_key_version,
      normalizedEmailHash: row.normalized_email_hash,
      roles: Object.freeze(sortedRoles(row.roles)),
    })
  }

  async revokeSession(
    sessionHash: Buffer,
    expectedVersion: number,
    requestId: string,
    now: Date,
  ): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE iam.sessions
         SET status='revoked',revoked_at=$3,session_version=session_version+1
         WHERE session_id_hash=$1 AND session_version=$2 AND status='active'`,
        [sessionHash, expectedVersion, now],
      )
      if ((result.rowCount ?? 0) === 1) {
        await client.query(
          `UPDATE iam.identity_links link
           SET status='revoked',revoked_at=$2
           FROM iam.sessions session
           WHERE session.session_id_hash=$1
             AND link.user_id=session.user_id
             AND link.status='active'`,
          [sessionHash, now],
        )
        await this.insertSecurityEvent(client, 'auth_logout_completed', 'info', requestId, null)
      }
      await client.query('COMMIT')
      return (result.rowCount ?? 0) === 1
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async insertSecurityEvent(
    client: PoolClient,
    eventType: string,
    severity: 'info' | 'warning' | 'high' | 'critical',
    requestId: string,
    errorCode: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.security_events (
         event_type,severity,error_code,request_id,metadata_json
       ) VALUES ($1,$2,$3,$4,'{}'::jsonb)`,
      [eventType, severity, errorCode, requestId],
    )
  }
}
