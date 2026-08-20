import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import { evidenceError } from './errors.js'
import type { EvidenceStore } from './store-port.js'
import type {
  EvidenceActor,
  EvidenceAttachmentDraftProjection,
  EvidenceAttachmentDraftStatus,
  EvidenceAttachmentRole,
  EvidenceBindingProjection,
  EvidenceCollectorActorType,
  EvidenceDraftPatch,
  EvidenceDraftProjection,
  EvidenceDraftStatus,
  EvidenceFinalFieldPreview,
  EvidenceFinalTargetKind,
  EvidenceParentType,
  EvidenceSourceChannel,
  EvidenceType,
  EvidenceVisibility,
} from './types.js'

interface DraftRow extends QueryResultRow {
  readonly evidence_draft_id: string
  readonly owner_user_id: string
  readonly collector_actor_type: EvidenceCollectorActorType
  readonly parent_type: EvidenceParentType
  readonly parent_id: string
  readonly final_target_kind: EvidenceFinalTargetKind
  readonly target_asset_draft_key: string | null
  readonly evidence_type: EvidenceType
  readonly source_channel: EvidenceSourceChannel
  readonly field_path: string | null
  readonly requested_visibility: EvidenceVisibility
  readonly source_url: string | null
  readonly internal_record_ref_ciphertext: Buffer | null
  readonly text_excerpt: string | null
  readonly status: EvidenceDraftStatus
  readonly source_hash: string | null
  readonly final_field_preview_json: unknown
  readonly bound_at: Date | null
  readonly completed_at: Date | null
  readonly promoted_evidence_id: string | null
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface AttachmentRow extends QueryResultRow {
  readonly attachment_draft_id: string
  readonly evidence_draft_id: string
  readonly media_resource_id: string
  readonly role: EvidenceAttachmentRole
  readonly requested_visibility: EvidenceVisibility
  readonly status: EvidenceAttachmentDraftStatus
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface ResourceRow extends QueryResultRow {
  readonly media_resource_id: string
  readonly owner_user_id: string
  readonly status: string
  readonly scan_result: string
  readonly deletion_guard_job_id: string | null
}

interface ParentRow extends QueryResultRow {
  readonly owner_user_id: string
  readonly status: string
  readonly version: number | string
  readonly evidence_draft_ids_json: unknown
  readonly expires_at: Date | null
}

interface ReceiptRow extends QueryResultRow {
  readonly request_hash: string
  readonly response_json: unknown
}

const visibilityRank: Readonly<Record<EvidenceVisibility, number>> = Object.freeze({
  public: 0,
  reviewer_only: 1,
  private: 2,
})

export class PostgresEvidenceStore implements EvidenceStore {
  constructor(private readonly pool: Pool) {}

  async createDraft(input: Parameters<EvidenceStore['createDraft']>[0]): Promise<EvidenceDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await client.query<DraftRow>(
        `SELECT * FROM workflow.evidence_drafts
         WHERE owner_user_id=$1 AND client_request_id=$2`,
        [input.actor.userId, input.clientRequestId],
      )
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw evidenceError('CLIENT_REQUEST_ID_REUSED', 409)
        }
        const projection = await this.draftProjection(client, replay.rows[0])
        await client.query('COMMIT')
        return projection
      }
      await this.authorizeParent(
        client, input.parentType, input.parentId, input.actor.userId, input.now, false,
      )
      const evidenceDraftId = randomUUID()
      const initialHash = this.sourceHash({
        evidenceType: input.evidenceType,
        sourceChannel: input.sourceChannel,
        fieldPath: input.fieldPath,
        visibility: input.requestedVisibility,
        sourceUrl: null,
        textExcerpt: null,
        attachments: [],
      })
      const result = await client.query<DraftRow>(
        `INSERT INTO workflow.evidence_drafts (
           evidence_draft_id,owner_user_id,collector_actor_type,parent_type,parent_id,
           final_target_kind,target_asset_draft_key,evidence_type,source_channel,field_path,
           requested_visibility,status,source_hash,client_request_id,request_hash,version,
           created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'editing',$12,$13,$14,1,$15,$15)
         RETURNING *`,
        [
          evidenceDraftId, input.actor.userId, input.collectorActorType, input.parentType,
          input.parentId, input.finalTargetKind, input.targetAssetDraftKey, input.evidenceType,
          input.sourceChannel, input.fieldPath, input.requestedVisibility, initialHash,
          input.clientRequestId, input.requestHash, input.now,
        ],
      )
      const row = result.rows[0]
      if (!row) throw evidenceError('EVIDENCE_DRAFT_CREATE_FAILED', 500, true)
      await this.snapshot(client, row, [], input.actor.userId, input.now)
      await this.audit(client, {
        operationId: 'OP-EVID-DRAFT-CREATE', actor: input.actor, targetType: 'evidence_draft',
        targetId: row.evidence_draft_id, requestId: input.requestId,
        reasonCode: 'evidence_draft_created', beforeHash: null, afterHash: initialHash, now: input.now,
      })
      const projection = await this.draftProjection(client, row)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getDraft(input: Parameters<EvidenceStore['getDraft']>[0]): Promise<EvidenceDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = await this.findDraft(client, input.evidenceDraftId)
      this.authorizeOwner(row, input.actor)
      const projection = await this.draftProjection(client, row)
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async patchDraft(input: Parameters<EvidenceStore['patchDraft']>[0]): Promise<EvidenceDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.actor.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.draftReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const before = await this.lockDraft(client, input.evidenceDraftId)
      this.authorizeOwner(before, input.actor)
      this.assertEditingVersion(before, input.expectedVersion)
      const attachments = await this.activeAttachments(client, before.evidence_draft_id, false)
      const merged = this.mergedDraft(before, input.patch)
      const sourceHash = this.sourceHash({
        evidenceType: before.evidence_type,
        sourceChannel: before.source_channel,
        fieldPath: merged.fieldPath,
        visibility: merged.visibility,
        sourceUrl: merged.sourceUrl,
        textExcerpt: merged.textExcerpt,
        attachments,
      })
      const result = await client.query<DraftRow>(
        `UPDATE workflow.evidence_drafts SET
           source_url=CASE WHEN $2 THEN $3 ELSE source_url END,
           text_excerpt=CASE WHEN $4 THEN $5 ELSE text_excerpt END,
           field_path=CASE WHEN $6 THEN $7 ELSE field_path END,
           requested_visibility=CASE WHEN $8 THEN $9 ELSE requested_visibility END,
           source_hash=$10,version=version+1,updated_at=$11
         WHERE evidence_draft_id=$1 AND status='editing' AND version=$12 RETURNING *`,
        [
          before.evidence_draft_id,
          Object.hasOwn(input.patch, 'sourceUrl'), input.patch.sourceUrl ?? null,
          Object.hasOwn(input.patch, 'textExcerpt'), input.patch.textExcerpt ?? null,
          Object.hasOwn(input.patch, 'fieldPath'), input.patch.fieldPath ?? null,
          Object.hasOwn(input.patch, 'requestedVisibility'), input.patch.requestedVisibility ?? null,
          sourceHash, input.now, input.expectedVersion,
        ],
      )
      const row = result.rows[0]
      if (!row) throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409)
      await this.snapshot(client, row, attachments, input.actor.userId, input.now)
      const projection = await this.draftProjection(client, row, attachments)
      await this.saveReceipt(
        client, input.actor.userId, input.operationId, 'patch', input.requestHash,
        row.evidence_draft_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-EVID-DRAFT-PATCH', actor: input.actor, targetType: 'evidence_draft',
        targetId: row.evidence_draft_id, requestId: input.requestId,
        reasonCode: 'evidence_draft_updated', beforeHash: before.source_hash,
        afterHash: sourceHash, now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async bindDraft(input: Parameters<EvidenceStore['bindDraft']>[0]): Promise<EvidenceBindingProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.actor.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.bindingReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const before = await this.lockDraft(client, input.evidenceDraftId)
      this.authorizeOwner(before, input.actor)
      if (before.status !== 'editing') throw evidenceError('EVIDENCE_DRAFT_READ_ONLY', 409)
      if (before.parent_type !== input.parentType || before.parent_id !== input.parentId) {
        throw evidenceError('EVIDENCE_PARENT_MISMATCH', 422)
      }
      if (before.bound_at !== null) throw evidenceError('EVIDENCE_DRAFT_ALREADY_BOUND', 409)
      const parent = await this.authorizeParent(
        client, input.parentType, input.parentId, input.actor.userId, input.now, true,
      )
      const parentVersion = this.safeVersion(parent.version)
      if (parentVersion !== input.expectedParentVersion) {
        throw evidenceError('EVIDENCE_PARENT_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedParentVersion,
          current_version: parentVersion,
        })
      }
      const updatedParent = input.parentType === 'submission_draft'
        ? await client.query<{ readonly evidence_draft_ids_json: unknown; readonly version: number | string } & QueryResultRow>(
            `UPDATE workflow.submission_drafts SET evidence_draft_ids_json=CASE
               WHEN evidence_draft_ids_json @> jsonb_build_array($2::text) THEN evidence_draft_ids_json
               ELSE evidence_draft_ids_json || jsonb_build_array($2::text)
             END,version=version+1,updated_at=$3,saved_at=$3
             WHERE draft_id=$1 AND status='editing' AND version=$4
             RETURNING evidence_draft_ids_json,version`,
            [input.parentId, before.evidence_draft_id, input.now, input.expectedParentVersion],
          )
        : await client.query<{ readonly evidence_draft_ids_json: unknown; readonly version: number | string } & QueryResultRow>(
            `UPDATE catalog.project_updates SET evidence_draft_ids_json=CASE
               WHEN evidence_draft_ids_json @> jsonb_build_array($2::text) THEN evidence_draft_ids_json
               ELSE evidence_draft_ids_json || jsonb_build_array($2::text)
             END,version=version+1,updated_at=GREATEST($3,updated_at+interval '1 microsecond')
             WHERE update_id=$1 AND status='editing' AND version=$4
             RETURNING evidence_draft_ids_json,version`,
            [input.parentId, before.evidence_draft_id, input.now, input.expectedParentVersion],
          )
      const parentAfter = updatedParent.rows[0]
      if (!parentAfter) throw evidenceError('EVIDENCE_PARENT_VERSION_CONFLICT', 409)
      const updatedDraft = await client.query<DraftRow>(
        `UPDATE workflow.evidence_drafts SET bound_at=$2,version=version+1,updated_at=$2
         WHERE evidence_draft_id=$1 AND status='editing' AND bound_at IS NULL RETURNING *`,
        [before.evidence_draft_id, input.now],
      )
      const row = updatedDraft.rows[0]
      if (!row) throw evidenceError('EVIDENCE_DRAFT_BIND_CONFLICT', 409)
      const attachments = await this.activeAttachments(client, row.evidence_draft_id, false)
      await this.snapshot(client, row, attachments, input.actor.userId, input.now)
      const ids = this.stringArray(parentAfter.evidence_draft_ids_json, 'EVIDENCE_PARENT_STATE_INVALID')
      const projection: EvidenceBindingProjection = Object.freeze({
        parent_type: input.parentType,
        parent_id: input.parentId,
        evidence_draft_ids: Object.freeze(ids),
        parent_version: this.safeVersion(parentAfter.version),
        evidence_draft_version: row.version,
      })
      await this.saveReceipt(
        client, input.actor.userId, input.operationId, 'bind', input.requestHash,
        row.evidence_draft_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-EVID-DRAFT-BIND', actor: input.actor, targetType: 'evidence_draft',
        targetId: row.evidence_draft_id, requestId: input.requestId,
        reasonCode: 'evidence_draft_bound', beforeHash: before.source_hash,
        afterHash: row.source_hash, now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async completeDraft(input: Parameters<EvidenceStore['completeDraft']>[0]): Promise<EvidenceDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.actor.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.draftReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const before = await this.lockDraft(client, input.evidenceDraftId)
      this.authorizeOwner(before, input.actor)
      this.assertEditingVersion(before, input.expectedVersion)
      if (before.bound_at === null) throw evidenceError('EVIDENCE_DRAFT_NOT_BOUND', 422)
      const attachments = await this.activeAttachments(client, before.evidence_draft_id, true)
      if (!before.source_url && !before.text_excerpt && attachments.length === 0) {
        throw evidenceError('EVIDENCE_SOURCE_REQUIRED', 422)
      }
      if (before.evidence_type === 'system_inference' && (
        !before.text_excerpt || before.internal_record_ref_ciphertext === null
      )) throw evidenceError('EVIDENCE_SYSTEM_SOURCE_INCOMPLETE', 422)
      const preview = this.finalPreview(before, attachments, input.now)
      const sourceHash = this.sourceHash({
        evidenceType: before.evidence_type,
        sourceChannel: before.source_channel,
        fieldPath: before.field_path,
        visibility: before.requested_visibility,
        sourceUrl: before.source_url,
        textExcerpt: before.text_excerpt,
        attachments,
      })
      const result = await client.query<DraftRow>(
        `UPDATE workflow.evidence_drafts SET status='ready',source_hash=$2,
           final_field_preview_json=$3::jsonb,completed_at=$4,version=version+1,updated_at=$4
         WHERE evidence_draft_id=$1 AND status='editing' AND version=$5 RETURNING *`,
        [before.evidence_draft_id, sourceHash, JSON.stringify(preview), input.now, input.expectedVersion],
      )
      const row = result.rows[0]
      if (!row) throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409)
      await this.snapshot(client, row, attachments, input.actor.userId, input.now)
      const projection = await this.draftProjection(client, row, attachments)
      await this.saveReceipt(
        client, input.actor.userId, input.operationId, 'complete', input.requestHash,
        row.evidence_draft_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-EVID-DRAFT-COMPLETE', actor: input.actor, targetType: 'evidence_draft',
        targetId: row.evidence_draft_id, requestId: input.requestId,
        reasonCode: 'evidence_draft_completed', beforeHash: before.source_hash,
        afterHash: sourceHash, now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async createAttachment(
    input: Parameters<EvidenceStore['createAttachment']>[0],
  ): Promise<EvidenceAttachmentDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.actor.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.attachmentReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const draft = await this.lockDraft(client, input.evidenceDraftId)
      this.authorizeOwner(draft, input.actor)
      this.assertEditingVersion(draft, input.expectedDraftVersion)
      if (visibilityRank[input.requestedVisibility] < visibilityRank[draft.requested_visibility]) {
        throw evidenceError('EVIDENCE_ATTACHMENT_VISIBILITY_TOO_WIDE', 422)
      }
      await this.lockReadyResource(client, input.mediaResourceId, input.actor.userId)
      const count = await client.query<{ readonly count: number } & QueryResultRow>(
        `SELECT count(*)::int AS count FROM workflow.evidence_attachment_drafts
         WHERE evidence_draft_id=$1 AND status='active'`,
        [draft.evidence_draft_id],
      )
      if ((count.rows[0]?.count ?? 0) >= 10) throw evidenceError('EVIDENCE_ATTACHMENT_LIMIT_EXCEEDED', 422)
      const attachmentId = randomUUID()
      const result = await client.query<AttachmentRow>(
        `INSERT INTO workflow.evidence_attachment_drafts (
           attachment_draft_id,evidence_draft_id,media_resource_id,role,requested_visibility,
           status,version,client_request_id,request_hash,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,'active',1,$6,$7,$8,$8) RETURNING *`,
        [
          attachmentId, draft.evidence_draft_id, input.mediaResourceId, input.role,
          input.requestedVisibility, input.operationId, input.requestHash, input.now,
        ],
      )
      const attachment = result.rows[0]
      if (!attachment) throw evidenceError('EVIDENCE_ATTACHMENT_CREATE_FAILED', 500, true)
      const attachments = await this.activeAttachments(client, draft.evidence_draft_id, false)
      const sourceHash = this.sourceHash({
        evidenceType: draft.evidence_type,
        sourceChannel: draft.source_channel,
        fieldPath: draft.field_path,
        visibility: draft.requested_visibility,
        sourceUrl: draft.source_url,
        textExcerpt: draft.text_excerpt,
        attachments,
      })
      const updatedDraft = await client.query<DraftRow>(
        `UPDATE workflow.evidence_drafts SET source_hash=$2,version=version+1,updated_at=$3
         WHERE evidence_draft_id=$1 AND status='editing' AND version=$4 RETURNING *`,
        [draft.evidence_draft_id, sourceHash, input.now, input.expectedDraftVersion],
      )
      const draftAfter = updatedDraft.rows[0]
      if (!draftAfter) throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409)
      await this.snapshot(client, draftAfter, attachments, input.actor.userId, input.now)
      const projection = this.attachmentProjection(attachment, draftAfter.version)
      await this.saveReceipt(
        client, input.actor.userId, input.operationId, 'attach', input.requestHash,
        draft.evidence_draft_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-EVID-ATTACH-CREATE', actor: input.actor,
        targetType: 'evidence_attachment_draft', targetId: attachment.attachment_draft_id,
        requestId: input.requestId, reasonCode: 'evidence_attachment_created',
        beforeHash: null, afterHash: this.objectHash(projection), now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async deleteAttachment(
    input: Parameters<EvidenceStore['deleteAttachment']>[0],
  ): Promise<EvidenceAttachmentDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.actor.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.attachmentReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const attachmentResult = await client.query<AttachmentRow>(
        `SELECT * FROM workflow.evidence_attachment_drafts
         WHERE attachment_draft_id=$1 FOR UPDATE`,
        [input.attachmentDraftId],
      )
      const before = attachmentResult.rows[0]
      if (!before) throw evidenceError('EVIDENCE_ATTACHMENT_NOT_FOUND', 404)
      const draft = await this.lockDraft(client, before.evidence_draft_id)
      this.authorizeOwner(draft, input.actor)
      if (draft.status !== 'editing') throw evidenceError('EVIDENCE_DRAFT_READ_ONLY', 409)
      if (before.status !== 'active') throw evidenceError('EVIDENCE_ATTACHMENT_GONE', 410)
      if (before.version !== input.expectedVersion) {
        throw evidenceError('EVIDENCE_ATTACHMENT_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: before.version,
        })
      }
      const result = await client.query<AttachmentRow>(
        `UPDATE workflow.evidence_attachment_drafts SET status='withdrawn',withdrawn_at=$2,
           version=version+1,updated_at=$2
         WHERE attachment_draft_id=$1 AND status='active' AND version=$3 RETURNING *`,
        [before.attachment_draft_id, input.now, input.expectedVersion],
      )
      const attachment = result.rows[0]
      if (!attachment) throw evidenceError('EVIDENCE_ATTACHMENT_VERSION_CONFLICT', 409)
      const attachments = await this.activeAttachments(client, draft.evidence_draft_id, false)
      const sourceHash = this.sourceHash({
        evidenceType: draft.evidence_type,
        sourceChannel: draft.source_channel,
        fieldPath: draft.field_path,
        visibility: draft.requested_visibility,
        sourceUrl: draft.source_url,
        textExcerpt: draft.text_excerpt,
        attachments,
      })
      const updatedDraft = await client.query<DraftRow>(
        `UPDATE workflow.evidence_drafts SET source_hash=$2,version=version+1,updated_at=$3
         WHERE evidence_draft_id=$1 AND status='editing' AND version=$4 RETURNING *`,
        [draft.evidence_draft_id, sourceHash, input.now, draft.version],
      )
      const draftAfter = updatedDraft.rows[0]
      if (!draftAfter) throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409)
      await this.snapshot(client, draftAfter, attachments, input.actor.userId, input.now)
      const projection = this.attachmentProjection(attachment, draftAfter.version)
      await this.saveReceipt(
        client, input.actor.userId, input.operationId, 'detach', input.requestHash,
        draft.evidence_draft_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-EVID-ATTACH-DELETE', actor: input.actor,
        targetType: 'evidence_attachment_draft', targetId: attachment.attachment_draft_id,
        requestId: input.requestId, reasonCode: 'evidence_attachment_withdrawn',
        beforeHash: this.objectHash(this.attachmentProjection(before, draft.version)),
        afterHash: this.objectHash(projection), now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async withdrawDraft(input: Parameters<EvidenceStore['withdrawDraft']>[0]): Promise<EvidenceDraftProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, input.actor.userId, input.operationId)
      if (replay) {
        this.assertReceipt(replay, input.requestHash)
        const projection = this.draftReceipt(replay.response_json)
        await client.query('COMMIT')
        return projection
      }
      const parentIdentity = await client.query<Pick<DraftRow, 'parent_type' | 'parent_id'>>(
        `SELECT parent_type,parent_id FROM workflow.evidence_drafts WHERE evidence_draft_id=$1`,
        [input.evidenceDraftId],
      )
      if (!parentIdentity.rows[0]) throw evidenceError('EVIDENCE_DRAFT_NOT_FOUND', 404)
      await this.authorizeParent(
        client,
        parentIdentity.rows[0].parent_type,
        parentIdentity.rows[0].parent_id,
        input.actor.userId,
        input.now,
        true,
      )
      const before = await this.lockDraft(client, input.evidenceDraftId)
      this.authorizeOwner(before, input.actor)
      if (before.status === 'promoted') throw evidenceError('EVIDENCE_DRAFT_PROMOTED', 409)
      if (['withdrawn', 'expired'].includes(before.status)) throw evidenceError('EVIDENCE_DRAFT_GONE', 410)
      if (before.version !== input.expectedVersion) {
        throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409, false, {
          expected_version: input.expectedVersion,
          current_version: before.version,
        })
      }
      await client.query(
        `UPDATE workflow.evidence_attachment_drafts SET status='withdrawn',withdrawn_at=$2,
           version=version+1,updated_at=$2
         WHERE evidence_draft_id=$1 AND status='active'`,
        [before.evidence_draft_id, input.now],
      )
      const result = await client.query<DraftRow>(
        `UPDATE workflow.evidence_drafts SET status='withdrawn',withdrawn_at=$2,
           version=version+1,updated_at=$2
         WHERE evidence_draft_id=$1 AND status IN ('editing','ready') AND version=$3 RETURNING *`,
        [before.evidence_draft_id, input.now, input.expectedVersion],
      )
      const row = result.rows[0]
      if (!row) throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409)
      if (before.parent_type === 'submission_draft') {
        await client.query(
          `UPDATE workflow.submission_drafts SET evidence_draft_ids_json=COALESCE((
             SELECT jsonb_agg(value ORDER BY ordinality)
             FROM jsonb_array_elements(evidence_draft_ids_json) WITH ORDINALITY entry(value,ordinality)
             WHERE value <> to_jsonb($2::text)
           ),'[]'::jsonb),version=version+1,updated_at=$3,saved_at=$3
           WHERE draft_id=$1 AND evidence_draft_ids_json @> jsonb_build_array($2::text)`,
          [before.parent_id, before.evidence_draft_id, input.now],
        )
      } else if (before.parent_type === 'project_update') {
        await client.query(
          `UPDATE catalog.project_updates SET evidence_draft_ids_json=COALESCE((
             SELECT jsonb_agg(value ORDER BY ordinality)
             FROM jsonb_array_elements(evidence_draft_ids_json) WITH ORDINALITY entry(value,ordinality)
             WHERE value <> to_jsonb($2::text)
           ),'[]'::jsonb),version=version+1,
             updated_at=GREATEST($3,updated_at+interval '1 microsecond')
           WHERE update_id=$1 AND evidence_draft_ids_json @> jsonb_build_array($2::text)`,
          [before.parent_id, before.evidence_draft_id, input.now],
        )
      }
      const attachments = await this.allAttachments(client, row.evidence_draft_id)
      await this.snapshot(client, row, attachments, input.actor.userId, input.now)
      const projection = await this.draftProjection(client, row, attachments)
      await this.saveReceipt(
        client, input.actor.userId, input.operationId, 'withdraw', input.requestHash,
        row.evidence_draft_id, projection, input.now,
      )
      await this.audit(client, {
        operationId: 'OP-EVID-DRAFT-WITHDRAW', actor: input.actor, targetType: 'evidence_draft',
        targetId: row.evidence_draft_id, requestId: input.requestId,
        reasonCode: input.reasonCode, beforeHash: before.source_hash,
        afterHash: row.source_hash, now: input.now,
      })
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async authorizeParent(
    client: PoolClient,
    parentType: EvidenceParentType,
    parentId: string,
    userId: string,
    now: Date,
    lock: boolean,
  ): Promise<ParentRow> {
    if (!['submission_draft', 'project_update'].includes(parentType)) {
      throw evidenceError('EVIDENCE_PARENT_TYPE_UNAVAILABLE', 503, true)
    }
    const result = parentType === 'submission_draft'
      ? await client.query<ParentRow>(
          `SELECT owner_user_id,status,version,evidence_draft_ids_json,expires_at
           FROM workflow.submission_drafts WHERE draft_id=$1 ${lock ? 'FOR UPDATE' : ''}`,
          [parentId],
        )
      : await client.query<ParentRow>(
          `SELECT owner_user_id,status,version,evidence_draft_ids_json,
             NULL::timestamptz AS expires_at
           FROM catalog.project_updates WHERE update_id=$1 ${lock ? 'FOR UPDATE' : ''}`,
          [parentId],
        )
    const row = result.rows[0]
    if (!row) throw evidenceError('EVIDENCE_PARENT_NOT_FOUND', 404)
    if (row.owner_user_id !== userId) throw evidenceError('EVIDENCE_PARENT_FORBIDDEN', 403)
    if (row.expires_at !== null && row.expires_at <= now) throw evidenceError('EVIDENCE_PARENT_GONE', 410)
    if (row.status !== 'editing') throw evidenceError('EVIDENCE_PARENT_READ_ONLY', 409)
    return row
  }

  private async lockReadyResource(client: PoolClient, resourceId: string, userId: string): Promise<void> {
    const result = await client.query<ResourceRow>(
      `SELECT media_resource_id,owner_user_id,status,scan_result,deletion_guard_job_id
       FROM media.media_resources WHERE media_resource_id=$1 FOR UPDATE`,
      [resourceId],
    )
    const row = result.rows[0]
    if (!row) throw evidenceError('MEDIA_RESOURCE_NOT_FOUND', 404)
    if (row.owner_user_id !== userId) throw evidenceError('MEDIA_RESOURCE_FORBIDDEN', 403)
    if (row.deletion_guard_job_id !== null) throw evidenceError('MEDIA_DELETE_IN_PROGRESS', 409)
    if (row.status === 'deleted') throw evidenceError('MEDIA_RESOURCE_GONE', 410)
    if (row.status !== 'ready' || row.scan_result !== 'clean') {
      throw evidenceError('MEDIA_RESOURCE_NOT_READY', 422)
    }
  }

  private async activeAttachments(
    client: PoolClient,
    evidenceDraftId: string,
    lockResources: boolean,
  ): Promise<AttachmentRow[]> {
    const result = await client.query<AttachmentRow & ResourceRow>(
      `SELECT attachment.*,resource.owner_user_id,resource.status AS resource_status,
         resource.scan_result,resource.deletion_guard_job_id
       FROM workflow.evidence_attachment_drafts attachment
       JOIN media.media_resources resource ON resource.media_resource_id=attachment.media_resource_id
       WHERE attachment.evidence_draft_id=$1 AND attachment.status='active'
       ORDER BY attachment.attachment_draft_id ${lockResources ? 'FOR UPDATE OF attachment,resource' : ''}`,
      [evidenceDraftId],
    )
    for (const row of result.rows) {
      const resourceStatus = (row as unknown as { readonly resource_status: string }).resource_status
      if (resourceStatus !== 'ready' || row.scan_result !== 'clean') {
        throw evidenceError('EVIDENCE_ATTACHMENT_RESOURCE_NOT_READY', 422)
      }
      if (row.deletion_guard_job_id !== null) throw evidenceError('MEDIA_DELETE_IN_PROGRESS', 409)
    }
    return result.rows
  }

  private async allAttachments(client: PoolClient, evidenceDraftId: string): Promise<AttachmentRow[]> {
    const result = await client.query<AttachmentRow>(
      `SELECT * FROM workflow.evidence_attachment_drafts
       WHERE evidence_draft_id=$1 ORDER BY attachment_draft_id`,
      [evidenceDraftId],
    )
    return result.rows
  }

  private async findDraft(client: PoolClient, evidenceDraftId: string): Promise<DraftRow> {
    const result = await client.query<DraftRow>(
      'SELECT * FROM workflow.evidence_drafts WHERE evidence_draft_id=$1',
      [evidenceDraftId],
    )
    const row = result.rows[0]
    if (!row) throw evidenceError('EVIDENCE_DRAFT_NOT_FOUND', 404)
    return row
  }

  private async lockDraft(client: PoolClient, evidenceDraftId: string): Promise<DraftRow> {
    const result = await client.query<DraftRow>(
      'SELECT * FROM workflow.evidence_drafts WHERE evidence_draft_id=$1 FOR UPDATE',
      [evidenceDraftId],
    )
    const row = result.rows[0]
    if (!row) throw evidenceError('EVIDENCE_DRAFT_NOT_FOUND', 404)
    return row
  }

  private authorizeOwner(row: DraftRow, actor: EvidenceActor): void {
    if (row.owner_user_id !== actor.userId) throw evidenceError('EVIDENCE_DRAFT_FORBIDDEN', 403)
  }

  private assertEditingVersion(row: DraftRow, expectedVersion: number): void {
    if (row.status !== 'editing') throw evidenceError('EVIDENCE_DRAFT_READ_ONLY', 409)
    if (row.version !== expectedVersion) {
      throw evidenceError('EVIDENCE_DRAFT_VERSION_CONFLICT', 409, false, {
        expected_version: expectedVersion,
        current_version: row.version,
      })
    }
  }

  private mergedDraft(row: DraftRow, patch: EvidenceDraftPatch): {
    readonly sourceUrl: string | null
    readonly textExcerpt: string | null
    readonly fieldPath: string | null
    readonly visibility: EvidenceVisibility
  } {
    return Object.freeze({
      sourceUrl: Object.hasOwn(patch, 'sourceUrl') ? patch.sourceUrl ?? null : row.source_url,
      textExcerpt: Object.hasOwn(patch, 'textExcerpt') ? patch.textExcerpt ?? null : row.text_excerpt,
      fieldPath: Object.hasOwn(patch, 'fieldPath') ? patch.fieldPath ?? null : row.field_path,
      visibility: Object.hasOwn(patch, 'requestedVisibility')
        ? patch.requestedVisibility as EvidenceVisibility
        : row.requested_visibility,
    })
  }

  private finalPreview(
    row: DraftRow,
    attachments: readonly AttachmentRow[],
    completedAt: Date,
  ): EvidenceFinalFieldPreview {
    let sourceSummary: string
    if (row.text_excerpt) {
      sourceSummary = row.text_excerpt
    } else if (row.source_url) {
      const host = new URL(row.source_url).hostname.toLowerCase().replace(/\.$/, '')
      sourceSummary = `外部来源域名：${host}`
    } else {
      const documents = attachments.filter((item) => item.role === 'supporting_document').length
      const images = attachments.filter((item) => item.role === 'supporting_image').length
      sourceSummary = `附件证据：supporting_document=${documents};supporting_image=${images}`
    }
    if (sourceSummary.length > 2_000) throw evidenceError('EVIDENCE_SOURCE_SUMMARY_TOO_LONG', 422)
    let confidence: 'high' | 'medium' | 'low'
    switch (row.evidence_type) {
      case 'platform_verified_fact': confidence = 'high'; break
      case 'verified_author_statement': confidence = 'medium'; break
      case 'trusted_external_source': confidence = row.source_url ? 'medium' : 'low'; break
      case 'system_inference': confidence = 'low'; break
    }
    return Object.freeze({
      source_summary: sourceSummary,
      captured_at: completedAt.toISOString(),
      collected_by: row.collector_actor_type,
      confidence,
      source_channel: row.source_channel,
    })
  }

  private sourceHash(input: {
    readonly evidenceType: EvidenceType
    readonly sourceChannel: EvidenceSourceChannel
    readonly fieldPath: string | null
    readonly visibility: EvidenceVisibility
    readonly sourceUrl: string | null
    readonly textExcerpt: string | null
    readonly attachments: readonly AttachmentRow[]
  }): string {
    return this.objectHash({
      evidence_type: input.evidenceType,
      source_channel: input.sourceChannel,
      field_path: input.fieldPath,
      requested_visibility: input.visibility,
      source_url: input.sourceUrl,
      text_excerpt: input.textExcerpt,
      attachments: input.attachments.map((item) => ({
        attachment_draft_id: item.attachment_draft_id,
        media_resource_id: item.media_resource_id,
        role: item.role,
        requested_visibility: item.requested_visibility,
        status: item.status,
      })),
    })
  }

  private async snapshot(
    client: PoolClient,
    row: DraftRow,
    attachments: readonly AttachmentRow[],
    userId: string,
    now: Date,
  ): Promise<void> {
    const snapshot = {
      parent_type: row.parent_type,
      parent_id: row.parent_id,
      final_target_kind: row.final_target_kind,
      target_asset_draft_key: row.target_asset_draft_key,
      evidence_type: row.evidence_type,
      source_channel: row.source_channel,
      field_path: row.field_path,
      requested_visibility: row.requested_visibility,
      source_url: row.source_url,
      text_excerpt: row.text_excerpt,
      status: row.status,
      bound: row.bound_at !== null,
      completed_at: row.completed_at?.toISOString() ?? null,
      attachments: attachments.map((item) => ({
        attachment_draft_id: item.attachment_draft_id,
        media_resource_id: item.media_resource_id,
        role: item.role,
        requested_visibility: item.requested_visibility,
        status: item.status,
      })),
    }
    await client.query(
      `INSERT INTO workflow.evidence_draft_snapshots (
         snapshot_id,evidence_draft_id,evidence_draft_version,snapshot_json,
         source_hash,created_by_user_id,created_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [
        randomUUID(), row.evidence_draft_id, row.version, JSON.stringify(snapshot),
        row.source_hash ?? this.objectHash(snapshot), userId, now,
      ],
    )
  }

  private async draftProjection(
    client: PoolClient,
    row: DraftRow,
    suppliedAttachments?: readonly AttachmentRow[],
  ): Promise<EvidenceDraftProjection> {
    const attachments = suppliedAttachments ?? await this.allAttachments(client, row.evidence_draft_id)
    const preview = row.final_field_preview_json === null
      ? null
      : Object.freeze(row.final_field_preview_json as EvidenceFinalFieldPreview)
    return Object.freeze({
      evidence_draft_id: row.evidence_draft_id,
      collector_actor_type: row.collector_actor_type,
      parent_type: row.parent_type,
      parent_id: row.parent_id,
      final_target_kind: row.final_target_kind,
      target_asset_draft_key: row.target_asset_draft_key,
      evidence_type: row.evidence_type,
      source_channel: row.source_channel,
      field_path: row.field_path,
      requested_visibility: row.requested_visibility,
      source_url: row.source_url,
      text_excerpt: row.text_excerpt,
      attachment_drafts: Object.freeze(
        attachments.map((attachment) => this.attachmentProjection(attachment, row.version)),
      ),
      status: row.status,
      bound: row.bound_at !== null,
      source_hash: row.source_hash ?? this.objectHash({ evidence_draft_id: row.evidence_draft_id }),
      final_field_preview: preview,
      completed_at: row.completed_at?.toISOString() ?? null,
      promoted_evidence_id: row.promoted_evidence_id,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private attachmentProjection(
    row: AttachmentRow,
    evidenceDraftVersion: number,
  ): EvidenceAttachmentDraftProjection {
    return Object.freeze({
      attachment_draft_id: row.attachment_draft_id,
      evidence_draft_id: row.evidence_draft_id,
      media_resource_id: row.media_resource_id,
      role: row.role,
      requested_visibility: row.requested_visibility,
      status: row.status,
      version: row.version,
      evidence_draft_version: evidenceDraftVersion,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })
  }

  private async receipt(
    client: PoolClient,
    userId: string,
    operationId: string,
  ): Promise<ReceiptRow | null> {
    const result = await client.query<ReceiptRow>(
      `SELECT request_hash,response_json FROM workflow.evidence_draft_operation_receipts
       WHERE owner_user_id=$1 AND operation_id=$2`,
      [userId, operationId],
    )
    return result.rows[0] ?? null
  }

  private assertReceipt(row: ReceiptRow, requestHash: string): void {
    if (row.request_hash !== requestHash) throw evidenceError('OPERATION_ID_REUSED', 409)
  }

  private async saveReceipt(
    client: PoolClient,
    userId: string,
    operationId: string,
    operationType: 'patch' | 'bind' | 'complete' | 'withdraw' | 'attach' | 'detach',
    requestHash: string,
    evidenceDraftId: string,
    response: unknown,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow.evidence_draft_operation_receipts (
         owner_user_id,operation_id,operation_type,request_hash,
         evidence_draft_id,response_json,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [userId, operationId, operationType, requestHash, evidenceDraftId, JSON.stringify(response), now],
    )
  }

  private async audit(
    client: PoolClient,
    input: {
      readonly operationId: string
      readonly actor: EvidenceActor
      readonly targetType: string
      readonly targetId: string
      readonly requestId: string
      readonly reasonCode: string
      readonly beforeHash: string | null
      readonly afterHash: string | null
      readonly now: Date
    },
  ): Promise<void> {
    const actorType = input.actor.roles.includes('admin')
      ? 'admin'
      : input.actor.roles.includes('editor') ? 'platform_editor' : 'user'
    await client.query(
      `INSERT INTO audit.audit_logs (
         audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         before_hash,after_hash,diff_json,reason_code,request_id,result,created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11,$12,'succeeded',$13)`,
      [
        randomUUID(), input.operationId.slice(0, 64), actorType,
        createHash('sha256').update(input.actor.userId).digest(), JSON.stringify(input.actor.roles),
        input.targetType, input.targetId, input.beforeHash, input.afterHash,
        JSON.stringify({ operation: input.reasonCode }), input.reasonCode,
        input.requestId.slice(0, 64), input.now,
      ],
    )
  }

  private stringArray(value: unknown, code: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw evidenceError(code, 500, true)
    }
    return value as string[]
  }

  private safeVersion(value: number | string): number {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw evidenceError('EVIDENCE_PARENT_STATE_INVALID', 500, true)
    }
    return parsed
  }

  private draftReceipt(value: unknown): EvidenceDraftProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw evidenceError('EVIDENCE_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as EvidenceDraftProjection
  }

  private bindingReceipt(value: unknown): EvidenceBindingProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw evidenceError('EVIDENCE_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as EvidenceBindingProjection
  }

  private attachmentReceipt(value: unknown): EvidenceAttachmentDraftProjection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw evidenceError('EVIDENCE_RECEIPT_INVALID', 500, true)
    }
    return Object.freeze(value) as EvidenceAttachmentDraftProjection
  }

  private objectHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
  }
}
