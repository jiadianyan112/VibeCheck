import type { Pool, PoolClient } from 'pg'
import type { AccountStatus, IdentityRole } from './types.js'
import type { PasswordCredential, PasswordStore } from './password-service.js'

export function canSetPasswordFromSession(authMethod: string, recentAuthAt: Date | null, now: Date): boolean {
  if (!recentAuthAt) return false
  const elapsed = now.getTime() - recentAuthAt.getTime()
  return authMethod === 'email_otp' && elapsed >= 0 && elapsed <= 300_000
}

async function audit(client: PoolClient, eventType: string, requestId: string): Promise<void> {
  await client.query(
    `INSERT INTO audit.security_events (event_type,severity,request_id,metadata_json)
     VALUES ($1,'info',$2,'{}'::jsonb)`, [eventType, requestId],
  )
}

export class PostgresPasswordStore implements PasswordStore {
  constructor(private readonly pool: Pool) {}

  async consumeAttempt(emailHash: Buffer, ipHash: Buffer | null, now: Date, windowSeconds: number): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const hit = async (key: Buffer, scope: string): Promise<number> => {
        const result = await client.query<{ hit_count: number }>(
          `INSERT INTO iam.auth_rate_limit_buckets (bucket_key_hash,scope,window_started_at,hit_count,updated_at)
           VALUES ($1,$2,date_bin(make_interval(secs => $3),$4::timestamptz,timestamptz '2000-01-01'),1,$4)
           ON CONFLICT (bucket_key_hash,scope,window_started_at)
           DO UPDATE SET hit_count=iam.auth_rate_limit_buckets.hit_count+1,updated_at=$4
           RETURNING hit_count`, [key, scope, windowSeconds, now],
        )
        return result.rows[0]!.hit_count
      }
      const emailCount = await hit(emailHash, 'password_email')
      const ipCount = ipHash ? await hit(ipHash, 'password_ip') : 0
      await client.query('COMMIT')
      return emailCount <= 5 && ipCount <= 20
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async findCredential(emailHash: Buffer): Promise<PasswordCredential | null> {
    const result = await this.pool.query<{
      user_id: string; status: AccountStatus; role_version: string; password_hash: string
      email_ciphertext: Buffer; key_version: string; roles: IdentityRole[]
    }>(
      `SELECT identity.user_id,account.status,account.role_version,credential.password_hash,
         identity.email_ciphertext,identity.key_version,
         COALESCE(array_agg(role.role ORDER BY role.role) FILTER (WHERE role.role IS NOT NULL),ARRAY['user']::varchar[]) AS roles
       FROM iam.user_email_identities identity
       JOIN iam.users account ON account.user_id=identity.user_id
       JOIN iam.user_password_credentials credential ON credential.user_id=identity.user_id
       LEFT JOIN iam.user_roles role ON role.user_id=identity.user_id
         AND role.valid_from<=now() AND (role.valid_to IS NULL OR role.valid_to>now())
       WHERE identity.normalized_email_hash=$1 AND identity.status='active'
       GROUP BY identity.user_id,account.status,account.role_version,credential.password_hash,
         identity.email_ciphertext,identity.key_version`, [emailHash],
    )
    const row = result.rows[0]
    return row ? {
      userId: row.user_id, accountStatus: row.status, rolesVersion: Number(row.role_version),
      roles: row.roles, passwordHash: row.password_hash,
      emailCiphertext: row.email_ciphertext, emailKeyVersion: row.key_version,
    } : null
  }

  async completeLogin(input: Parameters<PasswordStore['completeLogin']>[0]): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<{ password_hash: string; status: AccountStatus; role_version: string }>(
        `SELECT credential.password_hash,account.status,account.role_version
         FROM iam.user_password_credentials credential
         JOIN iam.users account ON account.user_id=credential.user_id
         JOIN iam.user_email_identities identity ON identity.user_id=credential.user_id
         WHERE credential.user_id=$1 AND identity.normalized_email_hash=$2 AND identity.status='active'
         FOR UPDATE OF credential,account,identity`, [input.credential.userId, input.emailHash],
      )
      const row = current.rows[0]
      if (!row || row.password_hash !== input.credential.passwordHash || row.status === 'disabled' || Number(row.role_version) !== input.credential.rolesVersion) {
        await client.query('ROLLBACK')
        return false
      }
      if (input.previousSessionHash) await client.query(
        `UPDATE iam.sessions SET status='revoked',revoked_at=$2 WHERE session_id_hash=$1 AND status='active'`,
        [input.previousSessionHash, input.now],
      )
      await client.query(
        `INSERT INTO iam.sessions (
          session_id_hash,csrf_token_hash,user_id,anonymous_subject_id,roles_version,
          session_version,status,recent_auth_at,expires_at,created_at,last_seen_at,
          auth_method,ip_hash,user_agent_hash
        ) VALUES ($1,$2,$3,$4,$5,1,'active',$6,$7,$6,$6,'email_password',$8,$9)`,
        [input.sessionHash, input.csrfHash, input.credential.userId, input.anonymousSubjectId,
          input.credential.rolesVersion, input.now, input.expiresAt, input.ipHash, input.userAgentHash],
      )
      await client.query(
        `INSERT INTO iam.identity_links (
          anonymous_subject_id,user_id,auth_flow_id,purpose,status,issued_at,expires_at
        ) VALUES ($1,$2,$3,'query_continuation','active',$4,$5)`,
        [input.anonymousSubjectId, input.credential.userId, input.authFlowId,
          input.now, new Date(input.now.getTime() + 300_000)],
      )
      await audit(client, 'auth_password_login_completed', input.requestId)
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async getStatus(userId: string, sessionHash: Buffer, now: Date): Promise<{ hasPassword: boolean; canSetPassword: boolean }> {
    const result = await this.pool.query<{ has_password: boolean; auth_method: string; recent_auth_at: Date | null }>(
      `SELECT (credential.user_id IS NOT NULL) AS has_password,session.auth_method,session.recent_auth_at
       FROM iam.sessions session
       LEFT JOIN iam.user_password_credentials credential ON credential.user_id=session.user_id
       WHERE session.session_id_hash=$1 AND session.user_id=$2 AND session.status='active' AND session.expires_at>$3`,
      [sessionHash, userId, now],
    )
    const row = result.rows[0]
    if (!row) return { hasPassword: false, canSetPassword: false }
    return {
      hasPassword: row.has_password,
      canSetPassword: canSetPasswordFromSession(row.auth_method, row.recent_auth_at, now),
    }
  }

  async setPassword(input: Parameters<PasswordStore['setPassword']>[0]): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{ auth_method: string; recent_auth_at: Date | null }>(
        `SELECT auth_method,recent_auth_at FROM iam.sessions
         WHERE session_id_hash=$1 AND user_id=$2 AND status='active' AND expires_at>$3
         FOR UPDATE`, [input.sessionHash, input.userId, input.now],
      )
      const row = result.rows[0]
      if (!row || !canSetPasswordFromSession(row.auth_method, row.recent_auth_at, input.now)) {
        await client.query('ROLLBACK')
        return false
      }
      await client.query(
        `INSERT INTO iam.user_password_credentials (user_id,password_hash,created_at,updated_at)
         VALUES ($1,$2,$3,$3)
         ON CONFLICT (user_id) DO UPDATE SET password_hash=$2,updated_at=$3`,
        [input.userId, input.passwordHash, input.now],
      )
      await client.query(
        `UPDATE iam.sessions SET status='revoked',revoked_at=$3
         WHERE user_id=$1 AND session_id_hash<>$2 AND status='active'`,
        [input.userId, input.sessionHash, input.now],
      )
      await audit(client, 'auth_password_changed', input.requestId)
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }
}
