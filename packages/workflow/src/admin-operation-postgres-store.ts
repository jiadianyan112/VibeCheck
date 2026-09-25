import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import type { AdminOperationSecurityStore } from './admin-operation-store.js'
import type {
  ConfirmAdminOperationStoreResult,
  StoredAdminOperationPreview,
} from './admin-operation-types.js'
import { workflowError } from './errors.js'

interface PreviewRow extends QueryResultRow {
  readonly preview_id: string
  readonly actor_user_id: string
  readonly primary_session_id_hash: Buffer
  readonly roles_version: string
  readonly operation_type: string
  readonly targets_json: unknown
  readonly expected_conflict_principal_version: number | null
  readonly confirmation_summary_hash: string
  readonly status: 'active' | 'reauth_required' | 'consumed' | 'expired' | 'revoked'
  readonly expires_at: Date
}

interface ConfirmRow extends QueryResultRow {
  readonly confirm_grant_id: string
  readonly assurance_source: 'recent_session' | 'step_up_grant'
  readonly status: 'active' | 'consumed' | 'expired' | 'revoked'
  readonly expires_at: Date
}

export class PostgresAdminOperationSecurityStore implements AdminOperationSecurityStore {
  constructor(private readonly pool: Pool) {}

  async createPreview(
    input: Parameters<AdminOperationSecurityStore['createPreview']>[0],
  ): Promise<StoredAdminOperationPreview> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const session = await client.query<{
        readonly user_id: string
        readonly roles_version: string
        readonly role_version: string
        readonly status: string
      } & QueryResultRow>(
        `SELECT session.user_id,session.roles_version,user_account.role_version,user_account.status
         FROM iam.sessions session
         JOIN iam.users user_account ON user_account.user_id=session.user_id
         WHERE session.session_id_hash=$1 AND session.status='active'
           AND session.expires_at>$2 FOR UPDATE OF session`,
        [input.primarySessionIdHash, input.createdAt],
      )
      const active = session.rows[0]
      if (
        !active || active.user_id !== input.actor.userId || active.status !== 'active' ||
        active.roles_version !== active.role_version
      ) throw workflowError('SESSION_INVALID', 401)

      const inserted = await client.query<PreviewRow>(
        `INSERT INTO workflow.admin_operation_previews (
           preview_id,preview_token_hash,actor_user_id,primary_session_id_hash,roles_version,
           operation_type,targets_json,expected_versions_json,proposed_diff_json,reason_code,
           claim_token_hash,expected_conflict_principal_version,diff_hash,impact_hash,
           confirmation_summary_hash,status,created_at,expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,
           'active',$16,$17
         ) RETURNING *`,
        [
          input.previewId, input.previewTokenHash, input.actor.userId, input.primarySessionIdHash,
          Number(active.roles_version), input.operationType, JSON.stringify(input.targets),
          JSON.stringify(input.expectedVersions), JSON.stringify(input.proposedDiff), input.reasonCode,
          input.claimTokenHash, input.expectedConflictPrincipalVersion, input.diffHash,
          input.impactHash, input.confirmationSummaryHash, input.createdAt, input.expiresAt,
        ],
      )
      const row = inserted.rows[0]!
      await this.securityEvent(client, row, null, input.actor.userId, 'preview_issued', input.requestId, {
        impact: input.impact,
      }, input.createdAt)
      await this.audit(client, 'OP-ADMIN-PREVIEW', input.actor.userId, input.actor.roles, row.preview_id,
        input.diffHash, input.impactHash, input.reasonCode, input.requestId, input.createdAt)
      await client.query('COMMIT')
      return this.preview(row)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async confirmPreview(
    input: Parameters<AdminOperationSecurityStore['confirmPreview']>[0],
  ): Promise<ConfirmAdminOperationStoreResult> {
    const client = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const selected = await client.query<PreviewRow>(
        `SELECT * FROM workflow.admin_operation_previews
         WHERE preview_token_hash=$1 FOR UPDATE`,
        [input.previewTokenHash],
      )
      const preview = selected.rows[0]
      if (!preview) return await this.commitError(client, 'PREVIEW_TOKEN_INVALID', 403)
      if (preview.expires_at <= input.now || preview.status === 'expired') {
        if (preview.status === 'active' || preview.status === 'reauth_required') {
          await client.query(
            `UPDATE workflow.admin_operation_previews SET status='expired'
             WHERE preview_id=$1`,
            [preview.preview_id],
          )
        }
        return await this.commitError(client, 'PREVIEW_TOKEN_EXPIRED', 410)
      }
      if (preview.status === 'consumed' || preview.status === 'revoked') {
        return await this.commitError(client, `PREVIEW_TOKEN_${preview.status.toUpperCase()}`, 410)
      }
      if (
        preview.actor_user_id !== input.actor.userId ||
        !preview.primary_session_id_hash.equals(input.primarySessionIdHash)
      ) return await this.commitError(client, 'PREVIEW_BINDING_MISMATCH', 403)
      if (preview.confirmation_summary_hash !== input.confirmationSummaryHash) {
        return await this.commitError(client, 'PREVIEW_SUMMARY_CONFLICT', 409)
      }
      if (preview.expected_conflict_principal_version !== input.expectedConflictPrincipalVersion) {
        return await this.commitError(client, 'CONFLICT_PRINCIPAL_VERSION_CONFLICT', 409)
      }

      const session = await client.query<{
        readonly user_id: string
        readonly roles_version: string
        readonly role_version: string
        readonly recent_auth_at: Date
        readonly user_status: string
      } & QueryResultRow>(
        `SELECT session.user_id,session.roles_version,user_account.role_version,
           session.recent_auth_at,user_account.status AS user_status
         FROM iam.sessions session
         JOIN iam.users user_account ON user_account.user_id=session.user_id
         WHERE session.session_id_hash=$1 AND session.status='active'
           AND session.expires_at>$2 FOR UPDATE OF session`,
        [input.primarySessionIdHash, input.now],
      )
      const active = session.rows[0]
      if (
        !active || active.user_id !== input.actor.userId || active.user_status !== 'active' ||
        active.roles_version !== active.role_version || Number(active.roles_version) !== Number(preview.roles_version)
      ) return await this.commitError(client, 'PREVIEW_BINDING_STALE', 409)

      // Idempotent replay is still authorization-sensitive: a role or primary
      // session change must invalidate even an already-issued response.
      const existing = await client.query<ConfirmRow>(
        `SELECT confirm_grant_id,assurance_source,status,expires_at
         FROM workflow.admin_operation_confirm_grants
         WHERE primary_session_id_hash=$1 AND preview_id=$2 AND confirm_request_id=$3`,
        [input.primarySessionIdHash, preview.preview_id, input.confirmRequestId],
      )
      if (existing.rows[0]) {
        const replay = existing.rows[0]
        if (replay.status !== 'active' || replay.expires_at <= input.now) {
          return await this.commitError(client, 'CONFIRM_TOKEN_EXPIRED', 410)
        }
        await this.securityEvent(client, preview, replay.confirm_grant_id, input.actor.userId,
          'confirm_replayed', input.requestId, {}, input.now)
        await client.query('COMMIT')
        committed = true
        return Object.freeze({
          kind: 'replayed',
          confirmGrantId: replay.confirm_grant_id,
          preview: this.preview(preview),
          assuranceSource: replay.assurance_source,
          expiresAt: replay.expires_at,
        })
      }

      const assuranceSource = await this.assurance(client, preview, input, active.recent_auth_at)
      if (assuranceSource !== null && typeof assuranceSource === 'object') {
        return await this.commitError(client, assuranceSource.code, assuranceSource.httpStatus)
      }
      if (assuranceSource === null) {
        if (preview.status === 'active') {
          await client.query(
            `UPDATE workflow.admin_operation_previews
             SET status='reauth_required',challenged_at=$2 WHERE preview_id=$1`,
            [preview.preview_id, input.now],
          )
          await this.securityEvent(client, preview, null, input.actor.userId, 'preview_challenged',
            input.requestId, {}, input.now)
        }
        await client.query('COMMIT')
        committed = true
        return Object.freeze({ kind: 'reauth_required', preview: this.preview(preview) })
      }

      const expiresAt = new Date(input.now.getTime() + input.confirmTtlSeconds * 1_000)
      await client.query(
        `INSERT INTO workflow.admin_operation_confirm_grants (
           confirm_grant_id,preview_id,confirm_token_hash,confirm_request_id,actor_user_id,
           primary_session_id_hash,roles_version,reauth_grant_id,assurance_source,
           confirmation_summary_hash,status,created_at,expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)`,
        [
          input.confirmGrantId, preview.preview_id, input.confirmTokenHash, input.confirmRequestId,
          input.actor.userId, input.primarySessionIdHash, Number(active.roles_version),
          input.reauthGrantId, assuranceSource, input.confirmationSummaryHash, input.now, expiresAt,
        ],
      )
      await this.securityEvent(client, preview, input.confirmGrantId, input.actor.userId,
        'confirm_issued', input.requestId, { assurance_source: assuranceSource }, input.now)
      await this.audit(client, 'OP-ADMIN-CONFIRM', input.actor.userId, input.actor.roles,
        preview.preview_id, null, input.confirmationSummaryHash, 'admin_operation_confirmed',
        input.requestId, input.now)
      await client.query('COMMIT')
      committed = true
      return Object.freeze({
        kind: 'issued',
        confirmGrantId: input.confirmGrantId,
        preview: this.preview(preview),
        assuranceSource,
        expiresAt,
      })
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async assurance(
    client: PoolClient,
    preview: PreviewRow,
    input: Parameters<AdminOperationSecurityStore['confirmPreview']>[0],
    recentAuthAt: Date,
  ): Promise<
    | 'recent_session'
    | 'step_up_grant'
    | null
    | { readonly code: string; readonly httpStatus: number }
  > {
    if (preview.status === 'active') {
      if (input.reauthGrantId !== null) {
        return Object.freeze({ code: 'REAUTH_GRANT_UNEXPECTED', httpStatus: 422 })
      }
      const cutoff = new Date(input.now.getTime() - input.recentAuthWindowSeconds * 1_000)
      return recentAuthAt >= cutoff ? 'recent_session' : null
    }
    if (preview.status !== 'reauth_required' || input.reauthGrantId === null) return null
    const selected = await client.query<{
      readonly user_id: string
      readonly primary_session_id_hash: Buffer
      readonly preview_token_hash: Buffer
      readonly roles_version: string
      readonly status: 'active' | 'consumed' | 'expired' | 'revoked'
      readonly expires_at: Date
    } & QueryResultRow>(
      `SELECT user_id,primary_session_id_hash,preview_token_hash,roles_version,status,expires_at
       FROM iam.admin_reauth_grants WHERE reauth_grant_id=$1 FOR UPDATE`,
      [input.reauthGrantId],
    )
    const grant = selected.rows[0]
    if (!grant) return Object.freeze({ code: 'REAUTH_GRANT_INVALID', httpStatus: 403 })
    if (
      grant.user_id !== input.actor.userId ||
      !grant.primary_session_id_hash.equals(input.primarySessionIdHash) ||
      !grant.preview_token_hash.equals(input.previewTokenHash) ||
      Number(grant.roles_version) !== Number(preview.roles_version)
    ) return Object.freeze({ code: 'REAUTH_GRANT_BINDING_MISMATCH', httpStatus: 403 })
    if (grant.status !== 'active') {
      return Object.freeze({ code: `REAUTH_GRANT_${grant.status.toUpperCase()}`, httpStatus: 410 })
    }
    if (grant.expires_at <= input.now) {
      await client.query(
        `UPDATE iam.admin_reauth_grants SET status='expired'
         WHERE reauth_grant_id=$1 AND status='active'`,
        [input.reauthGrantId],
      )
      return Object.freeze({ code: 'REAUTH_GRANT_EXPIRED', httpStatus: 410 })
    }
    const consumed = await client.query(
      `UPDATE iam.admin_reauth_grants SET status='consumed',consumed_at=$2
       WHERE reauth_grant_id=$1 AND status='active'`,
      [input.reauthGrantId, input.now],
    )
    if (consumed.rowCount !== 1) {
      return Object.freeze({ code: 'REAUTH_GRANT_CONSUMED', httpStatus: 410 })
    }
    return 'step_up_grant'
  }

  private preview(row: PreviewRow): StoredAdminOperationPreview {
    return Object.freeze({
      previewId: row.preview_id,
      operationType: row.operation_type,
      targetCount: Array.isArray(row.targets_json) ? row.targets_json.length : 0,
      confirmationSummaryHash: row.confirmation_summary_hash,
      expectedConflictPrincipalVersion: row.expected_conflict_principal_version,
      expiresAt: row.expires_at,
    })
  }

  private async securityEvent(
    client: PoolClient,
    preview: PreviewRow,
    confirmGrantId: string | null,
    actorUserId: string,
    eventType: string,
    requestId: string,
    metadata: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow.admin_operation_security_events (
         security_event_id,preview_id,confirm_grant_id,actor_user_id,event_type,
         request_id,metadata_json,occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [randomUUID(), preview.preview_id, confirmGrantId, actorUserId, eventType,
        requestId, JSON.stringify(metadata), now],
    )
  }

  private async audit(
    client: PoolClient,
    operationId: string,
    actorUserId: string,
    roles: readonly string[],
    targetId: string,
    beforeHash: string | null,
    afterHash: string,
    reasonCode: string,
    requestId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,reason_code,request_id,result,created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,'admin_operation_preview',$6,$7,$8,$9,$10,'succeeded',$11)`,
      [
        randomUUID(), operationId, roles.includes('admin') ? 'admin' : 'platform_editor',
        createHash('sha256').update(actorUserId).digest(), JSON.stringify(roles), targetId,
        beforeHash, afterHash, reasonCode, requestId, now,
      ],
    )
  }

  private async commitError(
    client: PoolClient,
    code: string,
    httpStatus: number,
  ): Promise<{ readonly kind: 'error'; readonly code: string; readonly httpStatus: number }> {
    await client.query('COMMIT')
    return Object.freeze({ kind: 'error', code, httpStatus })
  }

}
