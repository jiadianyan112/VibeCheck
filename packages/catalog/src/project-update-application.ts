import { createHash, randomUUID } from 'node:crypto'

import type { Pool, PoolClient, QueryResultRow } from 'pg'

import type { ProjectSnapshot } from './types.js'
import { parseProjectSnapshot } from './validation.js'

export interface ProjectUpdateApplicationProjection {
  readonly update_id: string
  readonly review_decision_id: string
  readonly project_id: string
  readonly base_version_id: string
  readonly version_id: string
  readonly event_id: string
  readonly transaction_id: string
  readonly applied_at: string
  readonly schema_version: 'project_update_application.v1'
}

interface UpdateRow extends QueryResultRow {
  readonly update_id: string
  readonly owner_user_id: string
  readonly project_id: string
  readonly base_version_id: string
  readonly update_type: string
  readonly category_change_type: string | null
  readonly payload_diff_json: unknown
  readonly before_after_json: unknown
  readonly evidence_draft_ids_json: unknown
  readonly media_reference_ids_json: unknown
  readonly authorization_snapshot_json: unknown
  readonly status: string
  readonly review_work_item_id: string
  readonly version: string
}

interface DecisionRow extends QueryResultRow {
  readonly review_decision_id: string
  readonly work_item_id: string
  readonly target_id: string
  readonly project_id: string
  readonly base_version_id: string
  readonly decision: string
  readonly resulting_status: string
}

interface ProjectRow extends QueryResultRow {
  readonly project_id: string
  readonly current_version_id: string
  readonly current_name: string
  readonly category_id: 'ai_learning_quiz' | 'personal_site_portfolio'
  readonly category_schema_version: 'learning.v1' | 'portfolio.v1'
  readonly canonical_public_url: string
  readonly review_status: string
  readonly aggregate_version: string
}

interface VersionRow extends QueryResultRow {
  readonly version_id: string
  readonly version_number: number
  readonly snapshot_json: unknown
}

interface ReceiptRow extends QueryResultRow {
  readonly update_id: string
  readonly review_decision_id: string
  readonly project_id: string
  readonly base_version_id: string
  readonly version_id: string
  readonly event_id: string
  readonly transaction_id: string
  readonly applied_at: Date
}

interface MediaRow extends QueryResultRow {
  readonly media_reference_id: string
  readonly media_resource_id: string
  readonly role: string
  readonly alt_text: string
  readonly sort_order: number
  readonly crop_focus_json: unknown
  readonly variant: string | null
}

interface EvidenceRow extends QueryResultRow {
  readonly evidence_draft_id: string
  readonly collector_actor_type: string
  readonly final_target_kind: 'project' | 'version' | 'event' | 'asset' | 'relation'
  readonly evidence_type: string
  readonly source_channel: string
  readonly field_path: string | null
  readonly requested_visibility: string
  readonly source_url: string | null
  readonly internal_record_ref_ciphertext: Buffer | null
  readonly final_field_preview_json: unknown
  readonly completed_at: Date
}

interface AttachmentRow extends QueryResultRow {
  readonly attachment_draft_id: string
  readonly evidence_draft_id: string
  readonly media_resource_id: string
  readonly role: string
  readonly requested_visibility: string
}

type JsonRecord = Record<string, unknown>

function applyError(code: string): Error {
  return new Error(code)
}

export class PostgresProjectUpdateApplier {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async applyApprovedUpdate(
    updateId: string,
    reviewDecisionId: string,
  ): Promise<ProjectUpdateApplicationProjection> {
    this.uuid(updateId)
    this.uuid(reviewDecisionId)
    const guard = await this.pool.connect()
    try {
      await guard.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        `project-update-application:${updateId}`,
      ])
      const existing = await this.receipt(guard, updateId)
      if (existing) return this.replay(existing, reviewDecisionId)
      await this.begin(updateId, reviewDecisionId)
      try {
        return await this.commit(updateId, reviewDecisionId)
      } catch (error) {
        await this.markFailed(updateId, this.errorCode(error)).catch(() => undefined)
        throw error
      }
    } finally {
      await guard.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
        `project-update-application:${updateId}`,
      ]).catch(() => undefined)
      guard.release()
    }
  }

  private async begin(updateId: string, decisionId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (await this.receipt(client, updateId)) {
        await client.query('COMMIT')
        return
      }
      const update = await this.update(client, updateId)
      const decision = await this.decision(client, decisionId)
      this.assertApproval(update, decision)
      if (update.status === 'applying') {
        await client.query('COMMIT')
        return
      }
      if (!['approved', 'apply_failed'].includes(update.status)) {
        throw applyError('PROJECT_UPDATE_APPLICATION_STATE_CONFLICT')
      }
      const changed = await client.query(
        `UPDATE catalog.project_updates SET status='applying',
           apply_attempt_count=apply_attempt_count+1,last_apply_error_code=NULL,
           applying_at=$2,version=version+1,
           updated_at=GREATEST($2,updated_at+interval '1 microsecond')
         WHERE update_id=$1 AND status=$3 AND version=$4`,
        [updateId, this.now(), update.status, update.version],
      )
      if (changed.rowCount !== 1) throw applyError('PROJECT_UPDATE_APPLICATION_STATE_CONFLICT')
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async commit(
    updateId: string,
    decisionId: string,
  ): Promise<ProjectUpdateApplicationProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await this.receipt(client, updateId)
      if (existing) {
        const projection = this.replay(existing, decisionId)
        await client.query('COMMIT')
        return projection
      }
      const update = await this.update(client, updateId)
      const decision = await this.decision(client, decisionId)
      this.assertApproval(update, decision)
      if (update.status !== 'applying') throw applyError('PROJECT_UPDATE_APPLICATION_STATE_CONFLICT')
      const project = await this.project(client, update.project_id)
      if (project.current_version_id !== update.base_version_id) {
        throw applyError('PROJECT_UPDATE_BASE_CONFLICT')
      }
      const base = await this.version(client, update.project_id, update.base_version_id)
      await this.assertCurrentAuthorization(client, update)

      const diff = this.objectArray(update.payload_diff_json, 'PROJECT_UPDATE_DIFF_INVALID')
      const beforeAfter = this.objectArray(update.before_after_json, 'PROJECT_UPDATE_DIFF_INVALID')
      if (diff.length < 1 || diff.length !== beforeAfter.length) {
        throw applyError('PROJECT_UPDATE_DIFF_INVALID')
      }
      const baseSnapshot = parseProjectSnapshot(
        base.snapshot_json, project.category_id, project.category_schema_version,
      )
      const draftSnapshot = this.applyDiff(baseSnapshot, diff, beforeAfter)
      if (draftSnapshot.project_core.public_url !== project.canonical_public_url) {
        throw applyError('PROJECT_UPDATE_PUBLIC_URL_SECURITY_RECEIPT_REQUIRED')
      }

      const mediaIds = this.idArray(update.media_reference_ids_json, 'PROJECT_UPDATE_MEDIA_INVALID')
      const evidenceIds = this.idArray(update.evidence_draft_ids_json, 'PROJECT_UPDATE_EVIDENCE_INVALID')
      const media = await this.media(client, update, mediaIds)
      const evidence = await this.evidence(client, update, evidenceIds)
      const attachments = await this.attachments(client, evidenceIds)

      const versionId = randomUUID()
      const eventId = randomUUID()
      const transactionId = randomUUID()
      const appliedAt = this.now()
      const promotedMedia = new Map<string, string>()
      for (const reference of media) promotedMedia.set(reference.media_reference_id, randomUUID())
      const snapshot = this.officialSnapshot(draftSnapshot, promotedMedia)
      parseProjectSnapshot(snapshot, project.category_id, project.category_schema_version)

      for (const reference of media) {
        await client.query(
          `INSERT INTO media.media_references (
             media_reference_id,media_resource_id,target_type,target_id,role,alt_text,sort_order,
             crop_focus_json,variant,source_media_reference_id,lifecycle_status,version,created_at,updated_at
           ) VALUES ($1,$2,'project_version',$3,$4,$5,$6,$7::jsonb,$8,$9,'active',1,$10,$10)`,
          [promotedMedia.get(reference.media_reference_id), reference.media_resource_id, versionId,
            reference.role, reference.alt_text, reference.sort_order,
            reference.crop_focus_json === null ? null : JSON.stringify(reference.crop_focus_json),
            reference.variant, reference.media_reference_id, appliedAt],
        )
      }

      await client.query(
        `INSERT INTO catalog.project_versions (
           version_id,project_id,version_number,previous_version_id,category_id,
           category_schema_version,snapshot_json,source_decision_type,source_decision_id,
           transaction_id,effective_at,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'review_decision',$8,$9,$10,$10)`,
        [versionId, project.project_id, base.version_number + 1, base.version_id,
          project.category_id, project.category_schema_version, JSON.stringify(snapshot),
          decisionId, transactionId, appliedAt],
      )

      const eventDate = appliedAt.toISOString().slice(0, 10)
      await client.query(
        `INSERT INTO catalog.events (
           event_id,project_id,version_id,event_type,category_change_type,event_time,time_precision,
           event_sort_at,event_summary,before_after,source_actor,source_object_type,source_object_id,created_at
         ) VALUES ($1,$2,$3,'version_updated',$4,$5,'day',$6,$7,$8::jsonb,
           'verified_author','project_update',$9,$10)`,
        [eventId, project.project_id, versionId, update.category_change_type, eventDate,
          new Date(`${eventDate}T00:00:00.000Z`), `${snapshot.project_core.current_name} 更新了作品资料`,
          JSON.stringify(beforeAfter), update.update_id, appliedAt],
      )

      const promotedEvidenceIds = await this.promoteEvidence(client, {
        update, evidence, attachments, projectId: project.project_id,
        versionId, eventId, reviewDecisionId: decisionId, appliedAt,
      })
      const projectChanged = await client.query(
        `UPDATE catalog.projects SET current_version_id=$2,current_name=$3,access_status=$4,
           last_verified_at=$5,aggregate_version=aggregate_version+1,updated_at=$5
         WHERE project_id=$1 AND current_version_id=$6 AND aggregate_version=$7`,
        [project.project_id, versionId, snapshot.project_core.current_name,
          snapshot.project_core.access_status, appliedAt, update.base_version_id,
          project.aggregate_version],
      )
      if (projectChanged.rowCount !== 1) throw applyError('PROJECT_UPDATE_BASE_CONFLICT')
      const updateChanged = await client.query(
        `UPDATE catalog.project_updates SET status='applied',last_apply_error_code=NULL,
           applied_at=$2,version=version+1,updated_at=GREATEST($2,updated_at+interval '1 microsecond')
         WHERE update_id=$1 AND status='applying'`,
        [update.update_id, appliedAt],
      )
      if (updateChanged.rowCount !== 1) throw applyError('PROJECT_UPDATE_APPLICATION_STATE_CONFLICT')

      const response: ProjectUpdateApplicationProjection = Object.freeze({
        update_id: update.update_id,
        review_decision_id: decisionId,
        project_id: project.project_id,
        base_version_id: update.base_version_id,
        version_id: versionId,
        event_id: eventId,
        transaction_id: transactionId,
        applied_at: appliedAt.toISOString(),
        schema_version: 'project_update_application.v1',
      })
      await client.query(
        `INSERT INTO workflow.project_update_application_receipts (
           update_id,review_decision_id,project_id,base_version_id,version_id,event_id,
           transaction_id,response_json,applied_at,schema_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'project_update_application.v1')`,
        [update.update_id, decisionId, project.project_id, update.base_version_id,
          versionId, eventId, transactionId, JSON.stringify(response), appliedAt],
      )
      await client.query(
        `INSERT INTO ops.outbox_events (
         outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
           transaction_id,status,next_attempt_at,created_at
         ) VALUES ($1,$2,'project',$3,'project_updated',2,$4::jsonb,$5,'pending',$6,$6)`,
        [randomUUID(), randomUUID(), project.project_id,
          JSON.stringify({
            project_id: project.project_id, version_id: versionId, event_id: eventId,
            update_id: update.update_id, review_decision_id: decisionId,
            source_type: 'project_update', initiator_type: 'verified_author',
            update_type: 'author_content_update', result: 'success',
            category_change_type: update.category_change_type,
            promoted_evidence_ids: promotedEvidenceIds,
          }), transactionId, appliedAt],
      )
      await client.query(
        `INSERT INTO audit.audit_logs (
           audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at
         ) VALUES ($1,'OP-PROJECT-UPDATE-APPLY','system',NULL,'[]'::jsonb,'project_update',$2,
           $3,$4,$5::jsonb,'approved_review_decision',$6,$7,'succeeded',$8)`,
        [randomUUID(), update.update_id,
          this.hash(JSON.stringify({ version_id: update.base_version_id })),
          this.hash(JSON.stringify({ version_id: versionId })),
          JSON.stringify({ status: 'applied', version_id: versionId, event_id: eventId }),
          `apply-${update.update_id}`.slice(0, 64), transactionId, appliedAt],
      )
      await client.query('COMMIT')
      return response
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async update(client: PoolClient, id: string): Promise<UpdateRow> {
    const result = await client.query<UpdateRow>(
      'SELECT * FROM catalog.project_updates WHERE update_id=$1 FOR UPDATE', [id],
    )
    if (!result.rows[0]) throw applyError('PROJECT_UPDATE_APPLICATION_TARGET_NOT_FOUND')
    return result.rows[0]
  }

  private async decision(client: PoolClient, id: string): Promise<DecisionRow> {
    const result = await client.query<DecisionRow>(
      `SELECT decision.review_decision_id,decision.work_item_id,decision.target_id,
         decision.project_id,decision.base_version_id,decision.decision,decision.resulting_status
       FROM workflow.review_decisions decision
       JOIN workflow.review_work_items item ON item.work_item_id=decision.work_item_id
       WHERE decision.review_decision_id=$1 AND decision.work_type='project_update'
         AND decision.target_type='project_update' AND item.status='decided'
         AND item.decision_ref_type='review_decision' AND item.decision_ref_id=decision.review_decision_id
       FOR SHARE OF decision,item`,
      [id],
    )
    if (!result.rows[0]) throw applyError('PROJECT_UPDATE_APPLICATION_DECISION_NOT_FOUND')
    return result.rows[0]
  }

  private assertApproval(update: UpdateRow, decision: DecisionRow): void {
    if (
      decision.target_id !== update.update_id || decision.work_item_id !== update.review_work_item_id ||
      decision.project_id !== update.project_id || decision.base_version_id !== update.base_version_id ||
      decision.decision !== 'approve' || decision.resulting_status !== 'approved'
    ) throw applyError('PROJECT_UPDATE_APPLICATION_DECISION_CONFLICT')
  }

  private async project(client: PoolClient, id: string): Promise<ProjectRow> {
    const result = await client.query<ProjectRow>(
      'SELECT * FROM catalog.projects WHERE project_id=$1 FOR UPDATE', [id],
    )
    if (!result.rows[0]) throw applyError('PROJECT_UPDATE_PROJECT_NOT_FOUND')
    if (!['published_author', 'published_platform'].includes(result.rows[0].review_status)) {
      throw applyError('PROJECT_UPDATE_PROJECT_STATE_CONFLICT')
    }
    return result.rows[0]
  }

  private async version(client: PoolClient, projectId: string, versionId: string): Promise<VersionRow> {
    const result = await client.query<VersionRow>(
      `SELECT version_id,version_number,snapshot_json FROM catalog.project_versions
       WHERE project_id=$1 AND version_id=$2 FOR SHARE`,
      [projectId, versionId],
    )
    if (!result.rows[0]) throw applyError('PROJECT_UPDATE_BASE_NOT_FOUND')
    return result.rows[0]
  }

  private async assertCurrentAuthorization(client: PoolClient, update: UpdateRow): Promise<void> {
    const snapshot = this.record(update.authorization_snapshot_json, 'PROJECT_UPDATE_AUTHORIZATION_INVALID')
    const result = await client.query<{
      readonly capabilities_json: unknown
      readonly field_path_ceiling_json: unknown
      readonly field_permissions_json: unknown
    } & QueryResultRow>(
      `SELECT profile.capabilities_json,profile.field_path_ceiling_json,relation.field_permissions_json
       FROM catalog.creator_account_links link
       JOIN catalog.link_permission_profiles profile
         ON profile.profile_id=link.permission_profile_id
        AND profile.profile_version=link.permission_profile_version
        AND profile.config_hash=link.permission_profile_config_hash
       JOIN catalog.creators creator ON creator.creator_id=link.creator_id
       JOIN catalog.author_relations relation ON relation.author_relation_id=$2
       WHERE link.creator_account_link_id=$1 AND link.user_id=$3 AND link.status='active'
         AND link.version=$4 AND relation.version=$5 AND relation.status='active'
         AND relation.project_id=$6 AND relation.creator_id=link.creator_id
         AND creator.merge_status='canonical' AND creator.canonical_creator_id IS NULL
         AND profile.profile_id=$7 AND profile.profile_version=$8 AND profile.config_hash=$9
         AND link.creator_id=$10
       FOR SHARE OF link,creator,relation,profile`,
      [snapshot.creator_account_link_id, snapshot.author_relation_id, update.owner_user_id,
        snapshot.link_version, snapshot.author_relation_version, update.project_id,
        snapshot.permission_profile_id, snapshot.permission_profile_version,
        snapshot.permission_profile_config_hash, snapshot.creator_id],
    )
    const row = result.rows[0]
    const diff = this.objectArray(update.payload_diff_json, 'PROJECT_UPDATE_DIFF_INVALID')
    const paths = diff.map((item) => item.field_path)
    if (!row || !this.stringArray(row.capabilities_json).includes('project_update.submit')) {
      throw applyError('PROJECT_UPDATE_AUTHORIZATION_REVOKED')
    }
    const ceiling = this.stringArray(row.field_path_ceiling_json)
    const relation = this.stringArray(row.field_permissions_json)
    if (paths.some((path) => typeof path !== 'string' || !ceiling.includes(path) || !relation.includes(path))) {
      throw applyError('PROJECT_UPDATE_AUTHORIZATION_REVOKED')
    }
  }

  private applyDiff(
    base: ProjectSnapshot,
    diff: readonly JsonRecord[],
    beforeAfter: readonly JsonRecord[],
  ): ProjectSnapshot {
    const snapshot = structuredClone(base) as unknown as JsonRecord
    const rawDiffPaths = diff.map((item) => item.field_path)
    const rawBeforePaths = beforeAfter.map((item) => item.field_path)
    if (
      rawDiffPaths.some((path) => typeof path !== 'string') ||
      rawBeforePaths.some((path) => typeof path !== 'string')
    ) throw applyError('PROJECT_UPDATE_DIFF_INVALID')
    const diffPaths = rawDiffPaths as string[]
    const beforePaths = rawBeforePaths as string[]
    const sortedDiffPaths = [...diffPaths].sort()
    const sortedBeforePaths = [...beforePaths].sort()
    if (
      new Set(diffPaths).size !== diffPaths.length ||
      new Set(beforePaths).size !== beforePaths.length ||
      sortedDiffPaths.some((path, index) => path !== sortedBeforePaths[index])
    ) throw applyError('PROJECT_UPDATE_DIFF_INVALID')
    const beforeByPath = new Map(beforeAfter.map((item) => [item.field_path, item]))
    for (const item of diff) {
      const path = item.field_path
      if (typeof path !== 'string' || !Object.hasOwn(item, 'after_value')) {
        throw applyError('PROJECT_UPDATE_DIFF_INVALID')
      }
      const before = beforeByPath.get(path)
      if (!before || !this.sameJson(before.before_value, this.pointerValue(base, path)) ||
          !this.sameJson(before.after_value, item.after_value)) {
        throw applyError('PROJECT_UPDATE_DIFF_BASE_MISMATCH')
      }
      this.setPointer(snapshot, path, item.after_value)
    }
    return snapshot as unknown as ProjectSnapshot
  }

  private setPointer(root: JsonRecord, pointer: string, value: unknown): void {
    if (!pointer.startsWith('/')) throw applyError('PROJECT_UPDATE_DIFF_INVALID')
    const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    if (parts.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw applyError('PROJECT_UPDATE_DIFF_INVALID')
    }
    let parent: JsonRecord = root
    for (const part of parts.slice(0, -1)) {
      const child = parent[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw applyError('PROJECT_UPDATE_DIFF_INVALID')
      }
      parent = child as JsonRecord
    }
    parent[parts.at(-1)!] = structuredClone(value)
  }

  private pointerValue(root: unknown, pointer: string): unknown {
    let value = root
    for (const part of pointer.slice(1).split('/').map((item) => item.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !(part in value)) return null
      value = (value as JsonRecord)[part]
    }
    return value ?? null
  }

  private async media(client: PoolClient, update: UpdateRow, ids: readonly string[]): Promise<readonly MediaRow[]> {
    if (ids.length === 0) return []
    const result = await client.query<MediaRow>(
      `SELECT reference.media_reference_id,reference.media_resource_id,reference.role,
         reference.alt_text,reference.sort_order,reference.crop_focus_json,reference.variant
       FROM media.media_references reference
       JOIN media.media_resources resource ON resource.media_resource_id=reference.media_resource_id
       WHERE reference.media_reference_id=ANY($1::uuid[]) AND reference.target_type='project_update'
         AND reference.target_id=$2 AND reference.lifecycle_status='active'
         AND resource.owner_user_id=$3 AND resource.status='ready' AND resource.scan_result='clean'
         AND resource.deletion_guard_job_id IS NULL
       ORDER BY reference.role,reference.sort_order,reference.media_reference_id
       FOR SHARE OF reference,resource`,
      [ids, update.update_id, update.owner_user_id],
    )
    if (result.rows.length !== ids.length) throw applyError('PROJECT_UPDATE_MEDIA_NOT_READY')
    return result.rows
  }

  private async evidence(client: PoolClient, update: UpdateRow, ids: readonly string[]): Promise<readonly EvidenceRow[]> {
    if (ids.length === 0) return []
    const result = await client.query<EvidenceRow>(
      `SELECT evidence_draft_id,collector_actor_type,final_target_kind,evidence_type,source_channel,
         field_path,requested_visibility,source_url,internal_record_ref_ciphertext,
         final_field_preview_json,completed_at
       FROM workflow.evidence_drafts
       WHERE evidence_draft_id=ANY($1::uuid[]) AND parent_type='project_update' AND parent_id=$2
         AND owner_user_id=$3 AND status='ready'
       ORDER BY evidence_draft_id FOR UPDATE`,
      [ids, update.update_id, update.owner_user_id],
    )
    if (result.rows.length !== ids.length) throw applyError('PROJECT_UPDATE_EVIDENCE_NOT_READY')
    if (result.rows.some((row) => ['asset', 'relation'].includes(row.final_target_kind))) {
      throw applyError('PROJECT_UPDATE_EVIDENCE_TARGET_UNSUPPORTED')
    }
    return result.rows
  }

  private async attachments(client: PoolClient, ids: readonly string[]): Promise<readonly AttachmentRow[]> {
    if (ids.length === 0) return []
    const result = await client.query<AttachmentRow>(
      `SELECT attachment.attachment_draft_id,attachment.evidence_draft_id,
         attachment.media_resource_id,attachment.role,attachment.requested_visibility
       FROM workflow.evidence_attachment_drafts attachment
       JOIN media.media_resources resource ON resource.media_resource_id=attachment.media_resource_id
       WHERE attachment.evidence_draft_id=ANY($1::uuid[]) AND attachment.status='active'
         AND resource.status='ready' AND resource.scan_result='clean'
         AND resource.deletion_guard_job_id IS NULL
       ORDER BY attachment.evidence_draft_id,attachment.attachment_draft_id FOR UPDATE OF attachment`,
      [ids],
    )
    const count = await client.query<{ readonly count: number } & QueryResultRow>(
      `SELECT count(*)::int AS count FROM workflow.evidence_attachment_drafts
       WHERE evidence_draft_id=ANY($1::uuid[]) AND status='active'`,
      [ids],
    )
    if (result.rows.length !== count.rows[0]?.count) {
      throw applyError('PROJECT_UPDATE_EVIDENCE_ATTACHMENT_NOT_READY')
    }
    return result.rows
  }

  private async promoteEvidence(
    client: PoolClient,
    context: Readonly<{
      update: UpdateRow
      evidence: readonly EvidenceRow[]
      attachments: readonly AttachmentRow[]
      projectId: string
      versionId: string
      eventId: string
      reviewDecisionId: string
      appliedAt: Date
    }>,
  ): Promise<readonly string[]> {
    const promoted: string[] = []
    for (const draft of context.evidence) {
      const evidenceId = randomUUID()
      promoted.push(evidenceId)
      const objectId = draft.final_target_kind === 'project'
        ? context.projectId
        : draft.final_target_kind === 'version'
          ? context.versionId
          : context.eventId
      const preview = this.record(draft.final_field_preview_json, 'PROJECT_UPDATE_EVIDENCE_PREVIEW_INVALID')
      if (draft.internal_record_ref_ciphertext !== null) {
        throw applyError('PROJECT_UPDATE_EVIDENCE_INTERNAL_REFERENCE_UNSUPPORTED')
      }
      await client.query(
        `INSERT INTO catalog.evidence (
           evidence_id,source_evidence_draft_id,object_type,object_id,project_id,version_id,event_id,
           field_path,evidence_type,source_channel,source_url,internal_record_ref,source_summary,
           captured_at,verified_at,collected_by,confidence,visibility,validity_status,freshness_status,
           dispute_status,validity_decision_type,validity_decision_id,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,$17,
           'valid','valid','none','review_decision',$18,$14)`,
        [evidenceId, draft.evidence_draft_id, draft.final_target_kind, objectId, context.projectId,
          draft.final_target_kind === 'version' ? context.versionId : null,
          draft.final_target_kind === 'event' ? context.eventId : null,
          draft.field_path, draft.evidence_type, draft.source_channel, draft.source_url,
          this.requiredText(preview.source_summary, 2_000), draft.completed_at, context.appliedAt,
          draft.collector_actor_type, this.confidence(preview.confidence), draft.requested_visibility,
          context.reviewDecisionId],
      )
      for (const attachment of context.attachments.filter(
        (item) => item.evidence_draft_id === draft.evidence_draft_id,
      )) {
        const attachmentId = randomUUID()
        await client.query(
          `INSERT INTO catalog.evidence_attachments (
             attachment_id,evidence_id,media_resource_id,role,visibility,
             source_attachment_draft_id,created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [attachmentId, evidenceId, attachment.media_resource_id, attachment.role,
            attachment.requested_visibility, attachment.attachment_draft_id, context.appliedAt],
        )
        const changed = await client.query(
          `UPDATE workflow.evidence_attachment_drafts
           SET status='promoted',promoted_attachment_id=$2,version=version+1,updated_at=$3
           WHERE attachment_draft_id=$1 AND status='active'`,
          [attachment.attachment_draft_id, attachmentId, context.appliedAt],
        )
        if (changed.rowCount !== 1) throw applyError('PROJECT_UPDATE_EVIDENCE_ATTACHMENT_STATE_CONFLICT')
      }
      const changed = await client.query(
        `UPDATE workflow.evidence_drafts SET status='promoted',promoted_evidence_id=$2,
           version=version+1,updated_at=$3 WHERE evidence_draft_id=$1 AND status='ready'`,
        [draft.evidence_draft_id, evidenceId, context.appliedAt],
      )
      if (changed.rowCount !== 1) throw applyError('PROJECT_UPDATE_EVIDENCE_STATE_CONFLICT')
    }
    return promoted
  }

  private officialSnapshot(snapshot: ProjectSnapshot, ids: ReadonlyMap<string, string>): ProjectSnapshot {
    return Object.freeze({
      ...snapshot,
      project_core: Object.freeze({
        ...snapshot.project_core,
        cover_media_reference_ids: Object.freeze(
          snapshot.project_core.cover_media_reference_ids.map((id) => ids.get(id) ?? id),
        ),
      }),
    }) as ProjectSnapshot
  }

  private async markFailed(updateId: string, code: string): Promise<void> {
    await this.pool.query(
      `UPDATE catalog.project_updates SET status='apply_failed',last_apply_error_code=$2,
         version=version+1,updated_at=GREATEST($3,updated_at+interval '1 microsecond')
       WHERE update_id=$1 AND status='applying'`,
      [updateId, code.slice(0, 128), this.now()],
    )
  }

  private async receipt(
    queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    updateId: string,
  ): Promise<ReceiptRow | null> {
    const result = await queryable.query<ReceiptRow>(
      `SELECT update_id,review_decision_id,project_id,base_version_id,version_id,event_id,
         transaction_id,applied_at FROM workflow.project_update_application_receipts
       WHERE update_id=$1`,
      [updateId],
    )
    return result.rows[0] ?? null
  }

  private replay(row: ReceiptRow, decisionId: string): ProjectUpdateApplicationProjection {
    if (row.review_decision_id !== decisionId) {
      throw applyError('PROJECT_UPDATE_APPLICATION_DECISION_CONFLICT')
    }
    return Object.freeze({
      update_id: row.update_id,
      review_decision_id: row.review_decision_id,
      project_id: row.project_id,
      base_version_id: row.base_version_id,
      version_id: row.version_id,
      event_id: row.event_id,
      transaction_id: row.transaction_id,
      applied_at: row.applied_at.toISOString(),
      schema_version: 'project_update_application.v1',
    })
  }

  private objectArray(value: unknown, code: string): readonly JsonRecord[] {
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw applyError(code)
    }
    return value as readonly JsonRecord[]
  }

  private idArray(value: unknown, code: string): readonly string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw applyError(code)
    const ids = value as string[]
    if (new Set(ids).size !== ids.length) throw applyError(code)
    return ids
  }

  private stringArray(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw applyError('PROJECT_UPDATE_AUTHORIZATION_INVALID')
    }
    return value as readonly string[]
  }

  private record(value: unknown, code: string): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw applyError(code)
    return value as JsonRecord
  }

  private requiredText(value: unknown, maximum: number): string {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > maximum) {
      throw applyError('PROJECT_UPDATE_EVIDENCE_PREVIEW_INVALID')
    }
    return value.trim()
  }

  private confidence(value: unknown): string {
    if (!['high', 'medium', 'low'].includes(String(value))) {
      throw applyError('PROJECT_UPDATE_EVIDENCE_PREVIEW_INVALID')
    }
    return String(value)
  }

  private sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  private uuid(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw applyError('PROJECT_UPDATE_APPLICATION_EVENT_INVALID')
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }

  private errorCode(error: unknown): string {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.message)) return error.message
    return 'PROJECT_UPDATE_APPLICATION_FAILED'
  }
}
