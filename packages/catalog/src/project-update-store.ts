import type { Pool, QueryResultRow } from 'pg'

import { catalogError } from './errors.js'
import type {
  ProjectUpdateSubmissionProjection,
  ProjectUpdateWithdrawalProjection,
  ProjectUpdateAuthorizationSnapshot,
  ProjectUpdateBeforeAfter,
  ProjectUpdateDiffInput,
  ProjectUpdateProjection,
  ProjectUpdateType,
} from './project-update-types.js'

interface ProjectBaseRow extends QueryResultRow {
  readonly project_id: string
  readonly current_version_id: string
  readonly review_status: string
  readonly snapshot_json: unknown
}

interface ProjectUpdateRow extends QueryResultRow {
  readonly update_id: string
  readonly project_id: string
  readonly owner_user_id: string
  readonly origin_review_status: string
  readonly base_version_id: string
  readonly current_version_id: string
  readonly update_type: ProjectUpdateType
  readonly category_change_type: string | null
  readonly payload_diff_json: unknown
  readonly before_after_json: unknown
  readonly evidence_draft_ids_json: unknown
  readonly media_reference_ids_json: unknown
  readonly authorization_snapshot_json: unknown
  readonly status: ProjectUpdateProjection['status']
  readonly review_work_item_id: string | null
  readonly apply_attempt_count: number
  readonly version: string
  readonly created_at: Date
  readonly updated_at: Date
  readonly request_hash: string
}

const updateSelect = `SELECT update_row.*,
  project.current_version_id
 FROM catalog.project_updates update_row
 JOIN catalog.projects project ON project.project_id=update_row.project_id`

export class PostgresProjectUpdateStore {
  constructor(private readonly pool: Pool) {}

  async getProjectBase(projectId: string): Promise<Readonly<{
    projectId: string
    currentVersionId: string
    reviewStatus: string
    snapshot: unknown
  }> | null> {
    const result = await this.pool.query<ProjectBaseRow>(
      `SELECT project.project_id,project.current_version_id,project.review_status,
         version.snapshot_json
       FROM catalog.projects project
       JOIN catalog.project_versions version ON version.version_id=project.current_version_id
       WHERE project.project_id=$1`,
      [projectId],
    )
    const row = result.rows[0]
    return row ? {
      projectId: row.project_id,
      currentVersionId: row.current_version_id,
      reviewStatus: row.review_status,
      snapshot: row.snapshot_json,
    } : null
  }

  async getVersionSnapshot(projectId: string, versionId: string): Promise<unknown | null> {
    const result = await this.pool.query<{ readonly snapshot_json: unknown }>(
      `SELECT snapshot_json FROM catalog.project_versions
       WHERE project_id=$1 AND version_id=$2`,
      [projectId, versionId],
    )
    return result.rows[0]?.snapshot_json ?? null
  }

  async validateDraftBindings(input: Readonly<{
    userId: string
    updateId: string
    evidenceDraftIds: readonly string[]
    mediaReferenceIds: readonly string[]
  }>): Promise<boolean> {
    const result = await this.pool.query<{ readonly evidence_count: number; readonly media_count: number }>(
      `SELECT
         (SELECT count(*)::int FROM workflow.evidence_drafts draft
           WHERE draft.evidence_draft_id=ANY($3::uuid[])
             AND draft.owner_user_id=$1 AND draft.parent_type='project_update'
             AND draft.parent_id=$2 AND draft.status IN ('editing','ready')) AS evidence_count,
         (SELECT count(*)::int FROM media.media_references reference
           JOIN media.media_resources resource ON resource.media_resource_id=reference.media_resource_id
          WHERE reference.media_reference_id=ANY($4::uuid[])
            AND reference.target_type='project_update' AND reference.target_id=$2
            AND reference.lifecycle_status='active' AND resource.owner_user_id=$1
            AND resource.status='ready' AND resource.scan_result='clean'
            AND resource.deletion_guard_job_id IS NULL) AS media_count`,
      [input.userId, input.updateId, input.evidenceDraftIds, input.mediaReferenceIds],
    )
    return result.rows[0]?.evidence_count === input.evidenceDraftIds.length &&
      result.rows[0]?.media_count === input.mediaReferenceIds.length
  }

  async findCreateReplay(input: Readonly<{
    userId: string
    clientRequestId: string
  }>): Promise<{ readonly row: ProjectUpdateRow; readonly requestHash: string } | null> {
    const result = await this.pool.query<ProjectUpdateRow>(
      `${updateSelect} WHERE update_row.owner_user_id=$1 AND update_row.client_request_id=$2`,
      [input.userId, input.clientRequestId],
    )
    const row = result.rows[0]
    return row ? { row, requestHash: row.request_hash } : null
  }

  async create(input: Readonly<{
    userId: string
    projectId: string
    baseVersionId: string
    originReviewStatus: string
    updateType: ProjectUpdateType
    authorizationSnapshot: ProjectUpdateAuthorizationSnapshot
    clientRequestId: string
    requestHash: string
    now: Date
  }>): Promise<ProjectUpdateRow> {
    const result = await this.pool.query<ProjectUpdateRow>(
      `WITH inserted AS (
         INSERT INTO catalog.project_updates (
           owner_user_id,project_id,origin_review_status,base_version_id,update_type,
           authorization_snapshot_json,client_request_id,request_hash,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$9)
         ON CONFLICT (owner_user_id,client_request_id) DO NOTHING
         RETURNING *
       ), selected AS (
         SELECT * FROM inserted
         UNION ALL
         SELECT existing.* FROM catalog.project_updates existing
          WHERE existing.owner_user_id=$1 AND existing.client_request_id=$7
            AND NOT EXISTS (SELECT 1 FROM inserted)
       ) SELECT selected.*,project.current_version_id
           FROM selected JOIN catalog.projects project ON project.project_id=selected.project_id`,
      [input.userId, input.projectId, input.originReviewStatus, input.baseVersionId,
        input.updateType, JSON.stringify(input.authorizationSnapshot), input.clientRequestId,
        input.requestHash, input.now],
    )
    return result.rows[0]!
  }

  async getOwned(userId: string, updateId: string): Promise<ProjectUpdateRow | null> {
    const result = await this.pool.query<ProjectUpdateRow>(
      `${updateSelect} WHERE update_row.update_id=$1 AND update_row.owner_user_id=$2`,
      [updateId, userId],
    )
    return result.rows[0] ?? null
  }

  async patch(input: Readonly<{
    userId: string
    updateId: string
    expectedVersion: number
    diff: readonly ProjectUpdateDiffInput[]
    beforeAfter: readonly ProjectUpdateBeforeAfter[]
    evidenceDraftIds: readonly string[]
    mediaReferenceIds: readonly string[]
    authorizationSnapshot: ProjectUpdateAuthorizationSnapshot
    operationId: string
    requestHash: string
    now: Date
  }>): Promise<ProjectUpdateRow> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash,response_json FROM catalog.project_update_operations
         WHERE update_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
        [input.updateId, input.userId, input.operationId],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw catalogError('PROJECT_UPDATE_OPERATION_REUSED', 409)
        }
        const replayRow = replay.rows[0].response_json as ProjectUpdateRow
        await client.query('COMMIT')
        return hydrateDates(replayRow)
      }
      const updated = await client.query<ProjectUpdateRow>(
        `WITH changed AS (
           UPDATE catalog.project_updates
              SET payload_diff_json=$4::jsonb,before_after_json=$5::jsonb,
                  evidence_draft_ids_json=$6::jsonb,media_reference_ids_json=$7::jsonb,
                  authorization_snapshot_json=$8::jsonb,version=version+1,
                  updated_at=GREATEST($9,updated_at+interval '1 microsecond')
            WHERE update_id=$1 AND owner_user_id=$2 AND version=$3 AND status='editing'
            RETURNING *
         ) SELECT changed.*,project.current_version_id
             FROM changed JOIN catalog.projects project ON project.project_id=changed.project_id`,
        [input.updateId, input.userId, input.expectedVersion, JSON.stringify(input.diff),
          JSON.stringify(input.beforeAfter), JSON.stringify(input.evidenceDraftIds),
          JSON.stringify(input.mediaReferenceIds), JSON.stringify(input.authorizationSnapshot), input.now],
      )
      const row = updated.rows[0]
      if (!row) {
        const concurrentReplay = await client.query<{ request_hash: string; response_json: unknown }>(
          `SELECT request_hash,response_json FROM catalog.project_update_operations
           WHERE update_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
          [input.updateId, input.userId, input.operationId],
        )
        if (concurrentReplay.rows[0]) {
          if (concurrentReplay.rows[0].request_hash !== input.requestHash) {
            throw catalogError('PROJECT_UPDATE_OPERATION_REUSED', 409)
          }
          const replayRow = hydrateDates(concurrentReplay.rows[0].response_json as ProjectUpdateRow)
          await client.query('COMMIT')
          return replayRow
        }
        const current = await client.query<{ owner_user_id: string; version: string; status: string }>(
          `SELECT owner_user_id,version,status FROM catalog.project_updates WHERE update_id=$1`,
          [input.updateId],
        )
        if (!current.rows[0] || current.rows[0].owner_user_id !== input.userId) {
          throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
        }
        if (current.rows[0].status !== 'editing') throw catalogError('PROJECT_UPDATE_NOT_EDITABLE', 409)
        throw catalogError('PROJECT_UPDATE_VERSION_CONFLICT', 409)
      }
      await client.query(
        `INSERT INTO catalog.project_update_operations (
           update_id,owner_user_id,operation_id,operation_type,request_hash,resulting_version,response_json
         ) VALUES ($1,$2,$3,'patch',$4,$5,$6::jsonb)`,
        [input.updateId, input.userId, input.operationId, input.requestHash, row.version,
          JSON.stringify(row)],
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

  async submit(input: Readonly<{
    userId: string
    updateId: string
    expectedVersion: number
    submissionKey: string
    requestHash: string
    authorizationSnapshot: ProjectUpdateAuthorizationSnapshot
    now: Date
  }>): Promise<ProjectUpdateSubmissionProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash,response_json FROM catalog.project_update_operations
         WHERE update_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
        [input.updateId, input.userId, input.submissionKey],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw catalogError('PROJECT_UPDATE_OPERATION_REUSED', 409)
        }
        await client.query('COMMIT')
        return receipt.rows[0].response_json as ProjectUpdateSubmissionProjection
      }
      const locked = await client.query<ProjectUpdateRow>(
        `${updateSelect} WHERE update_row.update_id=$1 AND update_row.owner_user_id=$2 FOR UPDATE OF update_row`,
        [input.updateId, input.userId],
      )
      const row = locked.rows[0]
      if (!row) throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
      if (positiveInteger(row.version) !== input.expectedVersion) throw catalogError('PROJECT_UPDATE_VERSION_CONFLICT', 409)
      if (row.status !== 'editing') throw catalogError('PROJECT_UPDATE_NOT_SUBMITTABLE', 409)
      if (row.current_version_id !== row.base_version_id) throw catalogError('PROJECT_UPDATE_BASE_CONFLICT', 409)
      const workItem = await client.query<{ work_item_id: string }>(
        `INSERT INTO workflow.review_work_items (
           work_type,target_type,target_id,status,version,created_at,updated_at
         ) VALUES ('project_update','project_update',$1,'queued',1,$2,$2)
         RETURNING work_item_id`,
        [input.updateId, input.now],
      )
      const workItemId = workItem.rows[0]!.work_item_id
      await client.query(
        `INSERT INTO workflow.review_work_item_conflict_principals (
           work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
         ) VALUES ($1,$2,'project_update_owner',$3,1,$4)`,
        [workItemId, input.userId, input.updateId, input.now],
      )
      const updated = await client.query<{ version: string; submitted_at: Date }>(
        `UPDATE catalog.project_updates
            SET status='update_pending',review_work_item_id=$2,
                authorization_snapshot_json=$3::jsonb,submitted_at=$4,
                version=version+1,updated_at=GREATEST($4,updated_at+interval '1 microsecond')
          WHERE update_id=$1 RETURNING version,submitted_at`,
        [input.updateId, workItemId, JSON.stringify(input.authorizationSnapshot), input.now],
      )
      const projection: ProjectUpdateSubmissionProjection = Object.freeze({
        update_id: input.updateId,
        status: 'update_pending',
        version: positiveInteger(updated.rows[0]!.version),
        review_work_item_id: workItemId,
        work_item_status: 'queued',
        submitted_at: updated.rows[0]!.submitted_at.toISOString(),
      })
      await client.query(
        `INSERT INTO catalog.project_update_operations (
           update_id,owner_user_id,operation_id,operation_type,request_hash,resulting_version,response_json,created_at
         ) VALUES ($1,$2,$3,'submit',$4,$5,$6::jsonb,$7)`,
        [input.updateId, input.userId, input.submissionKey, input.requestHash,
          projection.version, JSON.stringify(projection), input.now],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async withdraw(input: Readonly<{
    userId: string
    updateId: string
    expectedVersion: number
    operationId: string
    requestHash: string
    reasonCode: string
    now: Date
  }>): Promise<ProjectUpdateWithdrawalProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash,response_json FROM catalog.project_update_operations
         WHERE update_id=$1 AND owner_user_id=$2 AND operation_id=$3`,
        [input.updateId, input.userId, input.operationId],
      )
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== input.requestHash) {
          throw catalogError('PROJECT_UPDATE_OPERATION_REUSED', 409)
        }
        await client.query('COMMIT')
        return receipt.rows[0].response_json as ProjectUpdateWithdrawalProjection
      }
      const locked = await client.query<ProjectUpdateRow>(
        `${updateSelect} WHERE update_row.update_id=$1 AND update_row.owner_user_id=$2 FOR UPDATE OF update_row`,
        [input.updateId, input.userId],
      )
      const row = locked.rows[0]
      if (!row) throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
      if (positiveInteger(row.version) !== input.expectedVersion) throw catalogError('PROJECT_UPDATE_VERSION_CONFLICT', 409)
      if (!['editing','update_pending','changes_requested','apply_failed'].includes(row.status)) {
        throw catalogError('PROJECT_UPDATE_NOT_WITHDRAWABLE', 409)
      }
      let workItemStatus: 'cancelled' | null = null
      if (row.review_work_item_id) {
        const reviewBefore = await client.query<{ status: 'queued' | 'claimed' | 'decided' | 'cancelled' }>(
          `SELECT status FROM workflow.review_work_items WHERE work_item_id=$1 FOR UPDATE`,
          [row.review_work_item_id],
        )
        if (!reviewBefore.rows[0] || !['queued','claimed'].includes(reviewBefore.rows[0].status)) {
          throw catalogError('PROJECT_UPDATE_REVIEW_ALREADY_DECIDED', 409)
        }
        const cancelled = await client.query<{ version: number }>(
          `UPDATE workflow.review_work_items
              SET status='cancelled',assignee_user_id=NULL,claim_token_hash=NULL,
                  lease_expires_at=NULL,last_heartbeat_at=NULL,conflict_principal_version_at_claim=NULL,
                  cancel_reason=$2,version=version+1,updated_at=$3
            WHERE work_item_id=$1 AND status IN ('queued','claimed') RETURNING version`,
          [row.review_work_item_id, input.reasonCode, input.now],
        )
        if (!cancelled.rows[0]) throw catalogError('PROJECT_UPDATE_REVIEW_ALREADY_DECIDED', 409)
        workItemStatus = 'cancelled'
        await client.query(
          `INSERT INTO workflow.review_work_item_events (
             work_item_id,event_type,actor_user_id,from_status,to_status,work_item_version,
             reason_code,metadata_json,occurred_at
           ) VALUES ($1,'cancelled',$2,$3,'cancelled',$4,$5,'{}'::jsonb,$6)`,
          [row.review_work_item_id, input.userId,
            reviewBefore.rows[0].status, cancelled.rows[0].version,
            input.reasonCode, input.now],
        )
      }
      const updated = await client.query<{ version: string; updated_at: Date }>(
        `UPDATE catalog.project_updates SET status='withdrawn',version=version+1,
           updated_at=GREATEST($2,updated_at+interval '1 microsecond')
         WHERE update_id=$1 RETURNING version,updated_at`,
        [input.updateId, input.now],
      )
      const projection: ProjectUpdateWithdrawalProjection = Object.freeze({
        update_id: input.updateId,
        from_status: row.status as ProjectUpdateWithdrawalProjection['from_status'],
        status: 'withdrawn',
        version: positiveInteger(updated.rows[0]!.version),
        review_work_item_id: row.review_work_item_id,
        work_item_status: workItemStatus,
        withdrawn_at: updated.rows[0]!.updated_at.toISOString(),
      })
      await client.query(
        `INSERT INTO catalog.project_update_operations (
           update_id,owner_user_id,operation_id,operation_type,request_hash,resulting_version,response_json,created_at
         ) VALUES ($1,$2,$3,'withdraw',$4,$5,$6::jsonb,$7)`,
        [input.updateId, input.userId, input.operationId, input.requestHash,
          projection.version, JSON.stringify(projection), input.now],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

export function projectUpdateProjection(
  row: ProjectUpdateRow,
  currentAuthorization: ProjectUpdateAuthorizationSnapshot | null,
): ProjectUpdateProjection {
  return Object.freeze({
    update_id: row.update_id,
    project_id: row.project_id,
    owner_user_id: row.owner_user_id,
    origin_review_status: row.origin_review_status,
    base_version_id: row.base_version_id,
    current_version_id: row.current_version_id,
    update_type: row.update_type,
    category_change_type: row.category_change_type,
    payload_diff: objectArray<ProjectUpdateDiffInput>(row.payload_diff_json),
    before_after: objectArray<ProjectUpdateBeforeAfter>(row.before_after_json),
    evidence_draft_ids: stringArray(row.evidence_draft_ids_json),
    media_reference_ids: stringArray(row.media_reference_ids_json),
    authorization_snapshot: objectValue<ProjectUpdateAuthorizationSnapshot>(row.authorization_snapshot_json),
    effective_capabilities: currentAuthorization?.capabilities ?? Object.freeze([]),
    effective_field_paths: currentAuthorization?.field_paths ?? Object.freeze([]),
    authorization_state: currentAuthorization ? 'active' : 'revoked',
    status: row.status,
    review_work_item_id: row.review_work_item_id,
    apply_attempt_count: row.apply_attempt_count,
    version: positiveInteger(row.version),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  })
}

function objectArray<T>(value: unknown): readonly T[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) invalid()
  return Object.freeze(value as T[])
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid()
  return Object.freeze(value as string[])
}

function objectValue<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as T
}

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid()
  return parsed
}

function hydrateDates(row: ProjectUpdateRow): ProjectUpdateRow {
  return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) }
}

function invalid(): never {
  throw catalogError('PROJECT_UPDATE_DATA_INVALID', 503)
}
