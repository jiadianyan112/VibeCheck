import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { workflowError } from './errors.js'
import type {
  CreatorResolutionMode,
  NewCreatorProfileInput,
  ProvisionalLinkPolicy,
  RequestedLinkRole,
  VerificationRequestProjection,
} from './verification-request-types.js'

interface VerificationRequestRow extends QueryResultRow {
  readonly verification_id: string
  readonly project_id: string
  readonly applicant_user_id: string
  readonly creator_resolution_mode: CreatorResolutionMode
  readonly creator_account_link_id: string | null
  readonly target_creator_id: string | null
  readonly new_creator_profile_input_json: unknown
  readonly requested_link_role: RequestedLinkRole | null
  readonly method: string | null
  readonly public_summary: string | null
  readonly status: VerificationRequestProjection['status'] | 'pending' | 'verified' | 'failed' | 'withdrawn'
  readonly status_history_json: unknown
  readonly supersedes_verification_id: string | null
  readonly version: string
  readonly created_at: Date
  readonly updated_at: Date
  readonly request_hash: string
}

export interface ResolutionSelection {
  readonly mode: CreatorResolutionMode
  readonly creatorAccountLinkId: string | null
  readonly targetCreatorId: string | null
  readonly newCreatorProfileInput: NewCreatorProfileInput | null
  readonly requestedLinkRole: RequestedLinkRole | null
  readonly provisionalPolicy: ProvisionalLinkPolicy
}

export class PostgresVerificationRequestStore {
  constructor(private readonly pool: Pool) {}

  async findCreateReplay(userId: string, idempotencyKey: string) {
    const result = await this.pool.query<VerificationRequestRow>(
      `SELECT * FROM workflow.verification_requests
       WHERE applicant_user_id=$1 AND idempotency_key=$2`,
      [userId, idempotencyKey],
    )
    return result.rows[0] ?? null
  }

  async getOwned(userId: string, verificationId: string) {
    const result = await this.pool.query<VerificationRequestRow>(
      `SELECT * FROM workflow.verification_requests
       WHERE verification_id=$1 AND applicant_user_id=$2`,
      [verificationId, userId],
    )
    return result.rows[0] ?? null
  }

  async create(input: Readonly<{
    userId: string
    projectId: string
    supersedesVerificationId: string | null
    selection: ResolutionSelection
    idempotencyKey: string
    requestHash: string
    now: Date
    requestId: string
  }>): Promise<VerificationRequestRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${input.userId}:${input.projectId}`,
      ])
      const replay = await client.query<VerificationRequestRow>(
        `SELECT * FROM workflow.verification_requests
         WHERE applicant_user_id=$1 AND idempotency_key=$2`,
        [input.userId, input.idempotencyKey],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw workflowError('VERIFICATION_IDEMPOTENCY_KEY_REUSED', 409)
        }
        await client.query('COMMIT')
        return replay.rows[0]
      }
      const project = await client.query<{ review_status: string }>(
        `SELECT review_status FROM catalog.projects WHERE project_id=$1`, [input.projectId],
      )
      if (!project.rows[0] || project.rows[0].review_status === 'deleted') {
        throw workflowError('PROJECT_NOT_FOUND', 404)
      }
      const latest = await client.query<VerificationRequestRow>(
        `SELECT * FROM workflow.verification_requests
         WHERE applicant_user_id=$1 AND project_id=$2
         ORDER BY created_at DESC,verification_id DESC LIMIT 1 FOR UPDATE`,
        [input.userId, input.projectId],
      )
      if (input.supersedesVerificationId !== null) {
        const supplied = await client.query<{ applicant_user_id: string; project_id: string }>(
          `SELECT applicant_user_id,project_id FROM workflow.verification_requests
           WHERE verification_id=$1`,
          [input.supersedesVerificationId],
        )
        if (!supplied.rows[0]) throw workflowError('VERIFICATION_SUPERSEDES_INVALID', 409)
        if (supplied.rows[0].applicant_user_id !== input.userId) {
          throw workflowError('VERIFICATION_SUPERSEDES_FORBIDDEN', 403)
        }
        if (supplied.rows[0].project_id !== input.projectId) {
          throw workflowError('VERIFICATION_SUPERSEDES_PROJECT_MISMATCH', 409)
        }
      }
      validateSupersedes(latest.rows[0] ?? null, input.supersedesVerificationId)
      const row = await insertRequest(client, input)
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           after_hash,reason_code,request_id,result,created_at
         ) VALUES (
           'verification_draft_create','registered_user',digest($1::text,'sha256'),'[]'::jsonb,
           'verification_request',$2,$3,'applicant_created',left($4,64),'success',$5
         )`,
        [input.userId, row.verification_id, input.requestHash, input.requestId, input.now],
      )
      await client.query('COMMIT')
      return row
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async patch(input: Readonly<{
    userId: string
    verificationId: string
    expectedVersion: number
    selection: ResolutionSelection
    method: string | null
    publicSummary: string | null
    operationId: string
    requestHash: string
    now: Date
    requestId: string
  }>): Promise<VerificationRequestRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash,response_json FROM workflow.verification_request_operations
         WHERE verification_id=$1 AND applicant_user_id=$2 AND operation_id=$3`,
        [input.verificationId, input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw workflowError('VERIFICATION_OPERATION_REUSED', 409)
        }
        await client.query('COMMIT')
        return hydrate(receipt.rows[0].response_json as VerificationRequestRow)
      }
      const updated = await client.query<VerificationRequestRow>(
        `UPDATE workflow.verification_requests SET
           creator_resolution_mode=$4,creator_account_link_id=$5,target_creator_id=$6,
           new_creator_profile_input_json=$7::jsonb,requested_link_role=$8,
           method=$9,public_summary=$10,version=version+1,
           updated_at=GREATEST($11,updated_at+interval '1 microsecond')
         WHERE verification_id=$1 AND applicant_user_id=$2 AND version=$3
           AND status IN ('draft','changes_requested')
         RETURNING *`,
        [input.verificationId, input.userId, input.expectedVersion, input.selection.mode,
          input.selection.creatorAccountLinkId, input.selection.targetCreatorId,
          input.selection.newCreatorProfileInput === null
            ? null
            : JSON.stringify(input.selection.newCreatorProfileInput),
          input.selection.requestedLinkRole, input.method, input.publicSummary, input.now],
      )
      let row = updated.rows[0]
      if (!row) {
        const concurrentReceipt = await client.query<{ request_hash: string; response_json: unknown }>(
          `SELECT request_hash,response_json FROM workflow.verification_request_operations
           WHERE verification_id=$1 AND applicant_user_id=$2 AND operation_id=$3`,
          [input.verificationId, input.userId, input.operationId],
        )
        if (concurrentReceipt.rows[0]) {
          if (concurrentReceipt.rows[0].request_hash !== input.requestHash) {
            throw workflowError('VERIFICATION_OPERATION_REUSED', 409)
          }
          row = hydrate(concurrentReceipt.rows[0].response_json as VerificationRequestRow)
          await client.query('COMMIT')
          return row
        }
        await this.explainPatchFailure(client, input)
      }
      await client.query(
        `INSERT INTO workflow.verification_request_operations (
           verification_id,applicant_user_id,operation_id,operation_type,request_hash,
           resulting_version,response_json,created_at
         ) VALUES ($1,$2,$3,'patch',$4,$5,$6::jsonb,$7)`,
        [input.verificationId, input.userId, input.operationId, input.requestHash,
          row!.version, JSON.stringify(row), input.now],
      )
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           before_hash,after_hash,diff_json,reason_code,request_id,result,created_at
         ) VALUES (
           'verification_draft_patch','registered_user',digest($1::text,'sha256'),'[]'::jsonb,
           'verification_request',$2,encode(digest($3::text,'sha256'),'hex'),$4,$5::jsonb,
           'applicant_saved',left($6,64),'success',$7
         )`,
        [input.userId, input.verificationId, String(input.expectedVersion), input.requestHash,
          JSON.stringify({ changed_fields: ['creator_resolution','method','public_summary'] }),
          input.requestId, input.now],
      )
      await client.query('COMMIT')
      return row!
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async resolveSelection(input: Readonly<{
    userId: string
    mode: CreatorResolutionMode
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (input.mode === 'use_existing_link') return this.resolveExistingLink(input)
    if (input.mode === 'create_new_creator') return this.resolveNewCreator(input)
    return this.resolveExistingCreator(input)
  }

  projection(row: VerificationRequestRow, policy: ProvisionalLinkPolicy): VerificationRequestProjection {
    if (row.status !== 'draft' && row.status !== 'changes_requested') {
      throw workflowError('VERIFICATION_PROJECTION_UNSUPPORTED', 503)
    }
    return Object.freeze({
      verification_id: row.verification_id,
      project_id: row.project_id,
      creator_resolution_mode: row.creator_resolution_mode,
      creator_account_link_id: row.creator_account_link_id,
      target_creator_id: row.target_creator_id,
      new_creator_profile_input: nullableProfile(row.new_creator_profile_input_json),
      requested_link_role: row.requested_link_role,
      provisional_link_policy: policy,
      link_policy_snapshot: null,
      method: row.method,
      public_summary: row.public_summary,
      material_summaries: Object.freeze([]),
      status: row.status,
      status_history: statusHistory(row.status_history_json),
      latest_public_review_message: null,
      supersedes_verification_id: row.supersedes_verification_id,
      resulting_creator_id: null,
      resulting_link_id: null,
      resulting_author_relation_id: null,
      resulting_profile_version_id: null,
      version: positiveInteger(row.version),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private async resolveExistingLink(input: Readonly<{
    userId: string
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (!input.creatorAccountLinkId || input.targetCreatorId || input.newCreatorProfileInput || input.requestedLinkRole) {
      throw workflowError('VERIFICATION_RESOLUTION_INVALID', 422)
    }
    const result = await this.pool.query<{
      creator_id: string
      link_role: RequestedLinkRole
      profile_id: 'OWNER_V1' | 'MANAGER_V1'
      profile_version: number
      config_hash: string
      aggregate_version: string
      owner_link_set_version: string
    }>(
      `SELECT link.creator_id,link.link_role,profile.profile_id,profile.profile_version,
         profile.config_hash,creator.aggregate_version,creator.owner_link_set_version
       FROM catalog.creator_account_links link
       JOIN catalog.creators creator ON creator.creator_id=link.creator_id
       JOIN catalog.link_permission_profiles profile
         ON profile.profile_id=link.permission_profile_id
        AND profile.profile_version=link.permission_profile_version
        AND profile.config_hash=link.permission_profile_config_hash
       WHERE link.creator_account_link_id=$1 AND link.user_id=$2 AND link.status='active'
         AND creator.canonical_creator_id IS NULL`,
      [input.creatorAccountLinkId, input.userId],
    )
    const row = result.rows[0]
    if (!row) throw workflowError('CREATOR_ACCOUNT_LINK_NOT_FOUND', 404)
    return Object.freeze({
      mode: 'use_existing_link', creatorAccountLinkId: input.creatorAccountLinkId,
      targetCreatorId: null, newCreatorProfileInput: null, requestedLinkRole: null,
      provisionalPolicy: policy(row.aggregate_version, row.owner_link_set_version, [row.link_role],
        row.link_role, [{ profile_id: row.profile_id, profile_version: 1, config_hash: row.config_hash }]),
    })
  }

  private async resolveNewCreator(input: Readonly<{
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (input.creatorAccountLinkId || input.targetCreatorId || !input.newCreatorProfileInput ||
        (input.requestedLinkRole !== null && input.requestedLinkRole !== 'owner')) {
      throw workflowError('VERIFICATION_RESOLUTION_INVALID', 422)
    }
    const owner = await this.profile('OWNER_V1')
    return Object.freeze({
      mode: 'create_new_creator', creatorAccountLinkId: null, targetCreatorId: null,
      newCreatorProfileInput: input.newCreatorProfileInput, requestedLinkRole: 'owner',
      provisionalPolicy: policy(null, null, ['owner'], 'owner', [owner]),
    })
  }

  private async resolveExistingCreator(input: Readonly<{
    userId: string
    creatorAccountLinkId: string | null
    targetCreatorId: string | null
    newCreatorProfileInput: NewCreatorProfileInput | null
    requestedLinkRole: RequestedLinkRole | null
  }>): Promise<ResolutionSelection> {
    if (input.creatorAccountLinkId || !input.targetCreatorId || input.newCreatorProfileInput) {
      throw workflowError('VERIFICATION_RESOLUTION_INVALID', 422)
    }
    const creator = await this.pool.query<{
      aggregate_version: string
      owner_link_set_version: string
      owner_count: number
      applicant_link_count: number
    }>(
      `SELECT creator.aggregate_version,creator.owner_link_set_version,
         count(*) FILTER (WHERE owner_link.link_role='owner' AND owner_link.status IN ('active','suspended'))::int AS owner_count,
         count(*) FILTER (WHERE applicant_link.user_id=$2 AND applicant_link.status='active')::int AS applicant_link_count
       FROM catalog.creators creator
       LEFT JOIN catalog.creator_account_links owner_link ON owner_link.creator_id=creator.creator_id
       LEFT JOIN catalog.creator_account_links applicant_link ON applicant_link.creator_id=creator.creator_id
       WHERE creator.creator_id=$1 AND creator.canonical_creator_id IS NULL
         AND creator.merge_status='canonical' AND creator.current_profile_version_id IS NOT NULL
       GROUP BY creator.creator_id`,
      [input.targetCreatorId, input.userId],
    )
    const row = creator.rows[0]
    if (!row) throw workflowError('CREATOR_NOT_FOUND', 404)
    if (row.applicant_link_count > 0) throw workflowError('CREATOR_ALREADY_LINKED', 409)
    const roles: RequestedLinkRole[] = row.owner_count === 0 ? ['owner', 'manager'] : ['manager']
    const requested = input.requestedLinkRole ?? roles[0]!
    if (!roles.includes(requested)) throw workflowError('VERIFICATION_LINK_ROLE_NOT_ALLOWED', 422)
    const refs = await Promise.all(roles.map((role) => this.profile(role === 'owner' ? 'OWNER_V1' : 'MANAGER_V1')))
    return Object.freeze({
      mode: 'claim_existing_creator', creatorAccountLinkId: null,
      targetCreatorId: input.targetCreatorId, newCreatorProfileInput: null,
      requestedLinkRole: requested,
      provisionalPolicy: policy(row.aggregate_version, row.owner_link_set_version, roles, roles[0]!, refs),
    })
  }

  private async profile(profileId: 'OWNER_V1' | 'MANAGER_V1') {
    const result = await this.pool.query<{ profile_id: 'OWNER_V1' | 'MANAGER_V1'; profile_version: number; config_hash: string }>(
      `SELECT profile_id,profile_version,config_hash FROM catalog.link_permission_profiles
       WHERE profile_id=$1 AND profile_version=1`, [profileId],
    )
    const row = result.rows[0]
    if (!row || row.profile_version !== 1) throw workflowError('LINK_POLICY_BASELINE_UNAVAILABLE', 503)
    return Object.freeze({ profile_id: row.profile_id, profile_version: 1 as const, config_hash: row.config_hash })
  }

  private async explainPatchFailure(client: PoolClient, input: Readonly<{
    verificationId: string
    userId: string
    expectedVersion: number
  }>): Promise<never> {
    const current = await client.query<{ applicant_user_id: string; status: string; version: string }>(
      `SELECT applicant_user_id,status,version FROM workflow.verification_requests WHERE verification_id=$1`,
      [input.verificationId],
    )
    if (!current.rows[0] || current.rows[0].applicant_user_id !== input.userId) {
      throw workflowError('VERIFICATION_REQUEST_NOT_FOUND', 404)
    }
    if (!['draft','changes_requested'].includes(current.rows[0].status)) {
      throw workflowError('VERIFICATION_REQUEST_NOT_EDITABLE', 409)
    }
    throw workflowError('VERIFICATION_VERSION_CONFLICT', 409, false, {
      expected_version: input.expectedVersion,
      current_version: positiveInteger(current.rows[0].version),
    })
  }
}

async function insertRequest(client: PoolClient, input: Readonly<{
  userId: string
  projectId: string
  supersedesVerificationId: string | null
  selection: ResolutionSelection
  idempotencyKey: string
  requestHash: string
  now: Date
}>): Promise<VerificationRequestRow> {
  const result = await client.query<VerificationRequestRow>(
    `INSERT INTO workflow.verification_requests (
       project_id,applicant_user_id,creator_resolution_mode,creator_account_link_id,
       target_creator_id,new_creator_profile_input_json,requested_link_role,status_history_json,
       supersedes_verification_id,idempotency_key,request_hash,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$12) RETURNING *`,
    [input.projectId, input.userId, input.selection.mode, input.selection.creatorAccountLinkId,
      input.selection.targetCreatorId, input.selection.newCreatorProfileInput === null
        ? null
        : JSON.stringify(input.selection.newCreatorProfileInput),
      input.selection.requestedLinkRole,
      JSON.stringify([{ status: 'draft', at: input.now.toISOString() }]),
      input.supersedesVerificationId, input.idempotencyKey, input.requestHash, input.now],
  )
  return result.rows[0]!
}

function validateSupersedes(latest: VerificationRequestRow | null, supplied: string | null): void {
  if (!latest) {
    if (supplied !== null) throw workflowError('VERIFICATION_SUPERSEDES_INVALID', 409)
    return
  }
  if (['draft','pending','changes_requested'].includes(latest.status)) {
    throw workflowError('VERIFICATION_ACTIVE_REQUEST_EXISTS', 409)
  }
  if (latest.status === 'verified') throw workflowError('VERIFICATION_ALREADY_VERIFIED', 422)
  if (!['failed','withdrawn'].includes(latest.status) || supplied !== latest.verification_id) {
    throw workflowError('VERIFICATION_SUPERSEDES_STALE', 409)
  }
}

function policy(
  aggregateVersion: string | null,
  ownerSetVersion: string | null,
  roles: readonly RequestedLinkRole[],
  defaultRole: RequestedLinkRole,
  refs: ProvisionalLinkPolicy['allowed_permission_profile_refs'],
): ProvisionalLinkPolicy {
  return Object.freeze({
    policy_version: 'creator_link.v1',
    target_creator_aggregate_version: aggregateVersion === null ? null : positiveInteger(aggregateVersion),
    owner_link_set_version: ownerSetVersion === null ? null : positiveInteger(ownerSetVersion),
    allowed_link_roles: Object.freeze([...roles]),
    default_link_role: defaultRole,
    allowed_permission_profile_refs: Object.freeze([...refs]),
  })
}

function nullableProfile(value: unknown): NewCreatorProfileInput | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as NewCreatorProfileInput
}

function statusHistory(value: unknown): VerificationRequestProjection['status_history'] {
  if (!Array.isArray(value)) invalid()
  return Object.freeze(value as VerificationRequestProjection['status_history'])
}

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid()
  return parsed
}

function hydrate(row: VerificationRequestRow): VerificationRequestRow {
  return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) }
}

function invalid(): never {
  throw workflowError('VERIFICATION_REQUEST_DATA_INVALID', 503)
}
