import { createHash, randomUUID } from 'node:crypto'

import { parseProjectSnapshot, type ProjectSnapshot } from '@vibecheck/catalog'
import type { Pool, PoolClient, QueryResultRow } from 'pg'

export interface SubmissionPublicationProjection {
  readonly submission_id: string
  readonly review_decision_id: string
  readonly project_id: string
  readonly version_id: string
  readonly event_id: string
  readonly transaction_id: string
  readonly published_at: string
  readonly schema_version: 'submission_publication.v1'
}

interface PublicationRow extends QueryResultRow {
  readonly submission_id: string
  readonly review_decision_id: string
  readonly project_id: string
  readonly version_id: string
  readonly event_id: string
  readonly transaction_id: string
  readonly published_at: Date
}

interface SubmissionRow extends QueryResultRow {
  readonly submission_id: string
  readonly draft_id: string
  readonly owner_user_id: string
  readonly review_status: string
  readonly review_work_item_id: string
  readonly payload_snapshot: unknown
  readonly evidence_draft_ids_json: unknown
  readonly media_reference_ids_json: unknown
  readonly category_id: string
  readonly category_schema_version: string
  readonly canonical_url: string
  readonly canonical_url_hash: Buffer
  readonly draft_status: string
  readonly asset_drafts_json: unknown
  readonly version: number
}

interface DecisionRow extends QueryResultRow {
  readonly review_decision_id: string
  readonly target_id: string
  readonly decision: string
  readonly resulting_status: string
  readonly work_item_id: string
  readonly actor_user_id: string
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

interface EvidenceDraftRow extends QueryResultRow {
  readonly evidence_draft_id: string
  readonly collector_actor_type: string
  readonly final_target_kind: 'project' | 'version' | 'event' | 'asset' | 'relation'
  readonly target_asset_draft_key: string | null
  readonly evidence_type: string
  readonly source_channel: string
  readonly field_path: string | null
  readonly requested_visibility: string
  readonly source_url: string | null
  readonly internal_record_ref_ciphertext: Buffer | null
  readonly text_excerpt: string | null
  readonly final_field_preview_json: unknown
  readonly completed_at: Date
}

interface AttachmentDraftRow extends QueryResultRow {
  readonly attachment_draft_id: string
  readonly evidence_draft_id: string
  readonly media_resource_id: string
  readonly role: string
  readonly requested_visibility: string
}

type JsonRecord = Record<string, unknown>

const assetTypes = new Set([
  'source_code','starter','template','page_layout','ui_component','motion_interaction',
  'theme_design_system','resume_module','blog_cms_module','deployment_config','prompt','design_file',
])
const componentRoles = new Set([
  'hero','navigation','project_showcase','case_study','contact','footer','resume','blog','theme','motion','other',
])
const acquisitionMethods = new Set([
  'repository','clone','fork','use_template','direct_download','purchase','contact',
])
const availabilityStatuses = new Set([
  'available','login_required','paid','contact_required','link_abnormal','removed','unknown',
])
const priceTypes = new Set(['free','paid','contact','unknown'])

function publicationError(code: string): Error {
  return new Error(code)
}

function arrayOfIds(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw publicationError(code)
  }
  const ids = value as string[]
  if (new Set(ids).size !== ids.length) throw publicationError(code)
  return ids
}

function record(value: unknown, code: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw publicationError(code)
  }
  return value as JsonRecord
}

function requiredText(value: unknown, maximum: number, code: string): string {
  if (typeof value !== 'string') throw publicationError(code)
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > maximum) throw publicationError(code)
  return normalized
}

function nullableText(value: unknown, maximum: number, code: string): string | null {
  if (value === null || value === undefined) return null
  return requiredText(value, maximum, code)
}

function enumText(value: unknown, allowed: ReadonlySet<string>, code: string): string {
  const parsed = requiredText(value, 128, code)
  if (!allowed.has(parsed)) throw publicationError(code)
  return parsed
}

interface ParsedAssetDraft {
  readonly assetDraftKey: string
  readonly assetType: string
  readonly componentRole: string | null
  readonly name: string
  readonly description: string
  readonly safeWebUrl: string | null
  readonly contactUri: string | null
  readonly licenseType: string
  readonly priceType: string
  readonly acquisitionMethod: string
  readonly availabilityStatus: string
  readonly visibility: 'public' | 'reviewer_only' | 'private'
}

function parseAssetDrafts(value: unknown): readonly ParsedAssetDraft[] {
  if (!Array.isArray(value) || value.length > 50) throw publicationError('SUBMISSION_ASSET_DRAFTS_INVALID')
  const parsed = value.map((item): ParsedAssetDraft => {
    const draft = record(item, 'SUBMISSION_ASSET_DRAFT_INVALID')
    const allowedKeys = new Set([
      'asset_draft_key','asset_type','component_role','name','description','safe_web_url','contact_uri',
      'license_type','price_type','acquisition_method','availability_status','visibility',
    ])
    if (Object.keys(draft).some((key) => !allowedKeys.has(key))) {
      throw publicationError('SUBMISSION_ASSET_DRAFT_INVALID')
    }
    const safeWebUrl = nullableText(draft.safe_web_url, 2_048, 'SUBMISSION_ASSET_DRAFT_INVALID')
    const contactUri = nullableText(draft.contact_uri, 512, 'SUBMISSION_ASSET_DRAFT_INVALID')
    if (safeWebUrl === null && contactUri === null) throw publicationError('SUBMISSION_ASSET_TARGET_REQUIRED')
    if (safeWebUrl !== null && !/^https?:\/\//i.test(safeWebUrl)) {
      throw publicationError('SUBMISSION_ASSET_TARGET_INVALID')
    }
    if (contactUri !== null && !/^(mailto:|tel:)/i.test(contactUri)) {
      throw publicationError('SUBMISSION_ASSET_TARGET_INVALID')
    }
    const visibility = draft.visibility === undefined ? 'public' : enumText(
      draft.visibility, new Set(['public','reviewer_only','private']), 'SUBMISSION_ASSET_DRAFT_INVALID',
    ) as ParsedAssetDraft['visibility']
    return Object.freeze({
      assetDraftKey: requiredText(draft.asset_draft_key, 128, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      assetType: enumText(draft.asset_type, assetTypes, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      componentRole: draft.component_role === undefined
        ? null
        : nullableText(draft.component_role, 64, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      name: requiredText(draft.name, 120, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      description: requiredText(draft.description, 1_000, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      safeWebUrl,
      contactUri,
      licenseType: draft.license_type === undefined
        ? 'unknown'
        : requiredText(draft.license_type, 120, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      priceType: draft.price_type === undefined
        ? 'unknown'
        : enumText(draft.price_type, priceTypes, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      acquisitionMethod: enumText(
        draft.acquisition_method, acquisitionMethods, 'SUBMISSION_ASSET_DRAFT_INVALID',
      ),
      availabilityStatus: draft.availability_status === undefined
        ? 'unknown'
        : enumText(draft.availability_status, availabilityStatuses, 'SUBMISSION_ASSET_DRAFT_INVALID'),
      visibility,
    })
  })
  if (new Set(parsed.map((item) => item.assetDraftKey)).size !== parsed.length) {
    throw publicationError('SUBMISSION_ASSET_DRAFT_KEY_DUPLICATE')
  }
  if (parsed.some((item) => item.componentRole !== null && !componentRoles.has(item.componentRole))) {
    throw publicationError('SUBMISSION_ASSET_DRAFT_INVALID')
  }
  return parsed
}

export class PostgresSubmissionPublisher {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publishApprovedSubmission(
    submissionId: string,
    reviewDecisionId: string,
  ): Promise<SubmissionPublicationProjection> {
    if (!/^[0-9a-f-]{36}$/i.test(submissionId) || !/^[0-9a-f-]{36}$/i.test(reviewDecisionId)) {
      throw publicationError('SUBMISSION_PUBLICATION_EVENT_INVALID')
    }
    const existing = await this.receipt(this.pool, submissionId)
    if (existing) {
      if (existing.review_decision_id !== reviewDecisionId) {
        throw publicationError('SUBMISSION_PUBLICATION_DECISION_CONFLICT')
      }
      return this.projection(existing)
    }

    await this.begin(submissionId, reviewDecisionId)
    try {
      return await this.commit(submissionId, reviewDecisionId)
    } catch (error) {
      await this.markFailed(submissionId, this.errorCode(error)).catch(() => undefined)
      throw error
    }
  }

  private async begin(submissionId: string, reviewDecisionId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (await this.receipt(client, submissionId)) {
        await client.query('COMMIT')
        return
      }
      const submission = await this.submission(client, submissionId)
      const decision = await this.decision(client, reviewDecisionId)
      this.assertApproval(submission, decision)
      if (submission.review_status === 'publishing') {
        await client.query('COMMIT')
        return
      }
      if (!['approved', 'publish_failed'].includes(submission.review_status)) {
        throw publicationError('SUBMISSION_PUBLICATION_STATE_CONFLICT')
      }
      const updated = await client.query(
        `UPDATE workflow.submissions SET review_status='publishing',publish_attempt_count=publish_attempt_count+1,
           last_error_code=NULL,version=version+1,updated_at=$2
         WHERE submission_id=$1 AND review_status=$3 AND version=$4`,
        [submissionId, this.now(), submission.review_status, submission.version],
      )
      if (updated.rowCount !== 1) throw publicationError('SUBMISSION_PUBLICATION_STATE_CONFLICT')
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async commit(
    submissionId: string,
    reviewDecisionId: string,
  ): Promise<SubmissionPublicationProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await this.receipt(client, submissionId)
      if (replay) {
        if (replay.review_decision_id !== reviewDecisionId) {
          throw publicationError('SUBMISSION_PUBLICATION_DECISION_CONFLICT')
        }
        await client.query('COMMIT')
        return this.projection(replay)
      }

      const submission = await this.submission(client, submissionId)
      const decision = await this.decision(client, reviewDecisionId)
      this.assertApproval(submission, decision)
      if (submission.review_status !== 'publishing' || submission.draft_status !== 'submitted') {
        throw publicationError('SUBMISSION_PUBLICATION_STATE_CONFLICT')
      }

      const categoryId = submission.category_id as 'ai_learning_quiz' | 'personal_site_portfolio'
      const schemaVersion = submission.category_schema_version as 'learning.v1' | 'portfolio.v1'
      const draftSnapshot = parseProjectSnapshot(submission.payload_snapshot, categoryId, schemaVersion)
      if (draftSnapshot.project_core.public_url !== submission.canonical_url) {
        throw publicationError('SUBMISSION_PUBLIC_URL_MISMATCH')
      }
      const mediaIds = arrayOfIds(submission.media_reference_ids_json, 'SUBMISSION_MEDIA_INVALID')
      const evidenceDraftIds = arrayOfIds(
        submission.evidence_draft_ids_json, 'SUBMISSION_EVIDENCE_INVALID',
      )
      if (mediaIds.length < 1 || evidenceDraftIds.length < 1) {
        throw publicationError('SUBMISSION_PUBLICATION_DEPENDENCIES_MISSING')
      }

      const media = await this.media(client, submission, mediaIds)
      const evidenceDrafts = await this.evidenceDrafts(client, submission, evidenceDraftIds)
      const attachments = await this.attachments(client, evidenceDraftIds)
      const assetDrafts = parseAssetDrafts(submission.asset_drafts_json)
      this.assertAssetEvidence(assetDrafts, evidenceDrafts)

      const projectId = randomUUID()
      const versionId = randomUUID()
      const eventId = randomUUID()
      const transactionId = randomUUID()
      const publishedAt = this.now()
      const officialMediaIds = new Map<string, string>()
      for (const reference of media) officialMediaIds.set(reference.media_reference_id, randomUUID())
      const snapshot = this.officialSnapshot(draftSnapshot, officialMediaIds)
      parseProjectSnapshot(snapshot, categoryId, schemaVersion)

      await client.query(
        `INSERT INTO catalog.projects (
           project_id,current_version_id,current_name,category_id,category_schema_version,
           canonical_public_url,canonical_url_hash,review_status,access_status,author_link_status,
           completeness_level,freshness_status,record_source,first_seen_at,last_verified_at,
           aggregate_version,created_at,updated_at
         ) VALUES ($1,NULL,$2,$3,$4,$5,$6,'published_platform',$7,'unlinked',
           'pending_verification','valid','user_submission',$8,$8,1,$8,$8)`,
        [projectId, snapshot.project_core.current_name, categoryId, schemaVersion,
          submission.canonical_url, submission.canonical_url_hash, snapshot.project_core.access_status,
          publishedAt],
      )

      for (const reference of media) {
        await client.query(
          `INSERT INTO media.media_references (
             media_reference_id,media_resource_id,target_type,target_id,role,alt_text,sort_order,
             crop_focus_json,variant,source_media_reference_id,lifecycle_status,version,created_at,updated_at
           ) VALUES ($1,$2,'project_version',$3,$4,$5,$6,$7::jsonb,$8,$9,'active',1,$10,$10)`,
          [officialMediaIds.get(reference.media_reference_id), reference.media_resource_id, versionId,
            reference.role, reference.alt_text, reference.sort_order,
            reference.crop_focus_json === null ? null : JSON.stringify(reference.crop_focus_json),
            reference.variant, reference.media_reference_id, publishedAt],
        )
      }

      await client.query(
        `INSERT INTO catalog.project_versions (
           version_id,project_id,version_number,previous_version_id,category_id,
           category_schema_version,snapshot_json,source_decision_type,source_decision_id,
           transaction_id,effective_at,created_at
         ) VALUES ($1,$2,1,NULL,$3,$4,$5::jsonb,'review_decision',$6,$7,$8,$8)`,
        [versionId, projectId, categoryId, schemaVersion, JSON.stringify(snapshot),
          reviewDecisionId, transactionId, publishedAt],
      )
      await client.query(
        `UPDATE catalog.projects SET current_version_id=$2 WHERE project_id=$1`,
        [projectId, versionId],
      )

      const eventDate = publishedAt.toISOString().slice(0, 10)
      await client.query(
        `INSERT INTO catalog.events (
           event_id,project_id,version_id,event_type,event_time,time_precision,event_sort_at,
           event_summary,before_after,source_actor,source_object_type,source_object_id,created_at
         ) VALUES ($1,$2,$3,'first_published',$4,'day',$5,$6,'[]'::jsonb,
           'public_observation','submission',$7,$8)`,
        [eventId, projectId, versionId, eventDate,
          new Date(`${eventDate}T00:00:00.000Z`), `${snapshot.project_core.current_name} 首次公开记录`,
          submissionId, publishedAt],
      )

      const assetIds = new Map<string, string>()
      for (const asset of assetDrafts) {
        const assetId = randomUUID()
        assetIds.set(asset.assetDraftKey, assetId)
        const target = asset.safeWebUrl ?? asset.contactUri!
        await client.query(
          `INSERT INTO catalog.assets (
             asset_id,project_id,asset_type,component_role,name,description,safe_web_url,contact_uri,
             target_hash,license_type,price_type,acquisition_method,availability_status,visibility,
             last_verified_at,version,created_at,updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,$15,$15)`,
          [assetId, projectId, asset.assetType, asset.componentRole, asset.name, asset.description,
            asset.safeWebUrl, asset.contactUri, createHash('sha256').update(target).digest(),
            asset.licenseType, asset.priceType, asset.acquisitionMethod, asset.availabilityStatus,
            asset.visibility, publishedAt],
        )
      }

      const promotedEvidenceIds: string[] = []
      for (const evidence of evidenceDrafts) {
        const evidenceId = randomUUID()
        promotedEvidenceIds.push(evidenceId)
        const objectId = this.evidenceObjectId(evidence, { projectId, versionId, eventId, assetIds })
        const preview = record(evidence.final_field_preview_json, 'SUBMISSION_EVIDENCE_PREVIEW_INVALID')
        const sourceSummary = requiredText(
          preview.source_summary, 2_000, 'SUBMISSION_EVIDENCE_PREVIEW_INVALID',
        )
        const confidence = enumText(
          preview.confidence, new Set(['high','medium','low']), 'SUBMISSION_EVIDENCE_PREVIEW_INVALID',
        )
        if (evidence.internal_record_ref_ciphertext !== null) {
          throw publicationError('SUBMISSION_EVIDENCE_INTERNAL_REFERENCE_UNSUPPORTED')
        }
        await client.query(
          `INSERT INTO catalog.evidence (
             evidence_id,source_evidence_draft_id,object_type,object_id,project_id,version_id,event_id,
             field_path,evidence_type,source_channel,source_url,internal_record_ref,source_summary,
             captured_at,verified_at,collected_by,confidence,visibility,validity_status,freshness_status,
             dispute_status,validity_decision_type,validity_decision_id,created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,$17,
             'valid','valid','none','review_decision',$18,$14)`,
          [evidenceId, evidence.evidence_draft_id, evidence.final_target_kind, objectId, projectId,
            evidence.final_target_kind === 'version' ? versionId : null,
            evidence.final_target_kind === 'event' ? eventId : null, evidence.field_path,
            evidence.evidence_type, evidence.source_channel, evidence.source_url, sourceSummary,
            evidence.completed_at, publishedAt, evidence.collector_actor_type, confidence,
            evidence.requested_visibility, reviewDecisionId],
        )
        for (const attachment of attachments.filter(
          (item) => item.evidence_draft_id === evidence.evidence_draft_id,
        )) {
          const attachmentId = randomUUID()
          await client.query(
            `INSERT INTO catalog.evidence_attachments (
               attachment_id,evidence_id,media_resource_id,role,visibility,
               source_attachment_draft_id,created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [attachmentId, evidenceId, attachment.media_resource_id, attachment.role,
              attachment.requested_visibility, attachment.attachment_draft_id, publishedAt],
          )
          const promotedAttachment = await client.query(
            `UPDATE workflow.evidence_attachment_drafts
             SET status='promoted',promoted_attachment_id=$2,version=version+1,updated_at=$3
             WHERE attachment_draft_id=$1 AND status='active'`,
            [attachment.attachment_draft_id, attachmentId, publishedAt],
          )
          if (promotedAttachment.rowCount !== 1) {
            throw publicationError('SUBMISSION_EVIDENCE_ATTACHMENT_STATE_CONFLICT')
          }
        }
        const promotedDraft = await client.query(
          `UPDATE workflow.evidence_drafts
           SET status='promoted',promoted_evidence_id=$2,version=version+1,updated_at=$3
           WHERE evidence_draft_id=$1 AND status='ready'`,
          [evidence.evidence_draft_id, evidenceId, publishedAt],
        )
        if (promotedDraft.rowCount !== 1) {
          throw publicationError('SUBMISSION_EVIDENCE_STATE_CONFLICT')
        }
      }

      const publishedSubmission = await client.query(
        `UPDATE workflow.submissions SET review_status='published',resulting_project_id=$2,
           promoted_evidence_ids_json=$3::jsonb,last_error_code=NULL,published_at=$4,
           version=version+1,updated_at=$4
         WHERE submission_id=$1 AND review_status='publishing'`,
        [submissionId, projectId, JSON.stringify(promotedEvidenceIds), publishedAt],
      )
      if (publishedSubmission.rowCount !== 1) {
        throw publicationError('SUBMISSION_PUBLICATION_STATE_CONFLICT')
      }

      const response: SubmissionPublicationProjection = Object.freeze({
        submission_id: submissionId,
        review_decision_id: reviewDecisionId,
        project_id: projectId,
        version_id: versionId,
        event_id: eventId,
        transaction_id: transactionId,
        published_at: publishedAt.toISOString(),
        schema_version: 'submission_publication.v1',
      })
      await client.query(
        `INSERT INTO workflow.submission_publication_receipts (
           submission_id,review_decision_id,project_id,version_id,event_id,transaction_id,
           response_json,published_at,schema_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'submission_publication.v1')`,
        [submissionId, reviewDecisionId, projectId, versionId, eventId, transactionId,
          JSON.stringify(response), publishedAt],
      )
      await client.query(
        `INSERT INTO ops.outbox_events (
           outbox_id,event_id,aggregate_type,aggregate_id,event_name,event_version,payload_json,
           transaction_id,status,next_attempt_at,created_at
         ) VALUES ($1,$2,'project',$3,'project_published',1,$4::jsonb,$5,'pending',$6,$6)`,
        [randomUUID(), randomUUID(), projectId, JSON.stringify({
          project_id: projectId, version_id: versionId, event_id: eventId,
          submission_id: submissionId, review_decision_id: reviewDecisionId,
        }), transactionId, publishedAt],
      )
      await client.query(
        `INSERT INTO audit.audit_logs (
           audit_id,operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           before_hash,after_hash,diff_json,reason_code,request_id,trace_id,result,created_at
         ) VALUES ($1,'OP-SUBMISSION-PUBLISH','system',NULL,'[]'::jsonb,'submission',$2,
           NULL,$3,$4::jsonb,'approved_review_decision',$5,$6,'succeeded',$7)`,
        [randomUUID(), submissionId, createHash('sha256').update(JSON.stringify(response)).digest('hex'),
          JSON.stringify({ review_status: 'published', project_id: projectId }),
          `publish-${submissionId}`.slice(0, 64), transactionId, publishedAt],
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

  private async markFailed(submissionId: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE workflow.submissions SET review_status='publish_failed',last_error_code=$2,
         version=version+1,updated_at=$3
       WHERE submission_id=$1 AND review_status='publishing'`,
      [submissionId, errorCode.slice(0, 128), this.now()],
    )
  }

  private async receipt(
    queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    submissionId: string,
  ): Promise<PublicationRow | null> {
    const result = await queryable.query<PublicationRow>(
      `SELECT submission_id,review_decision_id,project_id,version_id,event_id,transaction_id,published_at
       FROM workflow.submission_publication_receipts WHERE submission_id=$1`,
      [submissionId],
    )
    return result.rows[0] ?? null
  }

  private async submission(client: PoolClient, submissionId: string): Promise<SubmissionRow> {
    const result = await client.query<SubmissionRow>(
      `SELECT submission.submission_id,submission.draft_id,submission.owner_user_id,
         submission.review_status,submission.review_work_item_id,submission.payload_snapshot,
         submission.evidence_draft_ids_json,draft.media_reference_ids_json,draft.category_id,
         draft.category_schema_version,check_record.canonical_url,check_record.canonical_url_hash,
         draft.status AS draft_status,draft.asset_drafts_json,submission.version
       FROM workflow.submissions submission
       JOIN workflow.submission_drafts draft ON draft.draft_id=submission.draft_id
       JOIN workflow.submission_url_checks check_record ON check_record.check_id=draft.check_id
       WHERE submission.submission_id=$1 FOR UPDATE OF submission,draft,check_record`,
      [submissionId],
    )
    if (!result.rows[0]) throw publicationError('SUBMISSION_PUBLICATION_TARGET_NOT_FOUND')
    return result.rows[0]
  }

  private async decision(client: PoolClient, reviewDecisionId: string): Promise<DecisionRow> {
    const result = await client.query<DecisionRow>(
      `SELECT decision.review_decision_id,decision.target_id,decision.decision,
         decision.resulting_status,decision.work_item_id,decision.actor_user_id
       FROM workflow.review_decisions decision
       JOIN workflow.review_work_items work ON work.work_item_id=decision.work_item_id
       WHERE decision.review_decision_id=$1 AND work.status='decided'
         AND work.decision_ref_type='review_decision'
         AND work.decision_ref_id=decision.review_decision_id
       FOR SHARE OF decision,work`,
      [reviewDecisionId],
    )
    if (!result.rows[0]) throw publicationError('SUBMISSION_PUBLICATION_DECISION_NOT_FOUND')
    return result.rows[0]
  }

  private assertApproval(submission: SubmissionRow, decision: DecisionRow): void {
    if (
      decision.target_id !== submission.submission_id ||
      decision.work_item_id !== submission.review_work_item_id ||
      decision.decision !== 'approve' || decision.resulting_status !== 'approved'
    ) throw publicationError('SUBMISSION_PUBLICATION_DECISION_CONFLICT')
  }

  private async media(
    client: PoolClient,
    submission: SubmissionRow,
    ids: readonly string[],
  ): Promise<readonly MediaRow[]> {
    const result = await client.query<MediaRow>(
      `SELECT reference.media_reference_id,reference.media_resource_id,reference.role,
         reference.alt_text,reference.sort_order,reference.crop_focus_json,reference.variant
       FROM media.media_references reference
       JOIN media.media_resources resource ON resource.media_resource_id=reference.media_resource_id
       WHERE reference.media_reference_id=ANY($1::uuid[]) AND reference.target_type='submission_draft'
         AND reference.target_id=$2 AND reference.lifecycle_status='active'
         AND resource.owner_user_id=$3 AND resource.status='ready' AND resource.scan_result='clean'
         AND resource.deletion_guard_job_id IS NULL
       ORDER BY reference.role,reference.sort_order,reference.media_reference_id
       FOR SHARE OF reference,resource`,
      [ids, submission.draft_id, submission.owner_user_id],
    )
    if (result.rows.length !== ids.length) throw publicationError('SUBMISSION_MEDIA_NOT_READY')
    return result.rows
  }

  private async evidenceDrafts(
    client: PoolClient,
    submission: SubmissionRow,
    ids: readonly string[],
  ): Promise<readonly EvidenceDraftRow[]> {
    const result = await client.query<EvidenceDraftRow>(
      `SELECT evidence_draft_id,collector_actor_type,final_target_kind,target_asset_draft_key,
         evidence_type,source_channel,field_path,requested_visibility,source_url,
         internal_record_ref_ciphertext,text_excerpt,final_field_preview_json,completed_at
       FROM workflow.evidence_drafts
       WHERE evidence_draft_id=ANY($1::uuid[]) AND parent_type='submission_draft' AND parent_id=$2
         AND owner_user_id=$3 AND status='ready'
       ORDER BY evidence_draft_id FOR UPDATE`,
      [ids, submission.draft_id, submission.owner_user_id],
    )
    if (result.rows.length !== ids.length) throw publicationError('SUBMISSION_EVIDENCE_NOT_READY')
    return result.rows
  }

  private async attachments(
    client: PoolClient,
    evidenceDraftIds: readonly string[],
  ): Promise<readonly AttachmentDraftRow[]> {
    const result = await client.query<AttachmentDraftRow>(
      `SELECT attachment.attachment_draft_id,attachment.evidence_draft_id,
         attachment.media_resource_id,attachment.role,attachment.requested_visibility
       FROM workflow.evidence_attachment_drafts attachment
       JOIN media.media_resources resource ON resource.media_resource_id=attachment.media_resource_id
       WHERE attachment.evidence_draft_id=ANY($1::uuid[]) AND attachment.status='active'
         AND resource.status='ready' AND resource.scan_result='clean'
         AND resource.deletion_guard_job_id IS NULL
       ORDER BY attachment.evidence_draft_id,attachment.attachment_draft_id
       FOR UPDATE OF attachment`,
      [evidenceDraftIds],
    )
    const total = await client.query<{ readonly count: number } & QueryResultRow>(
      `SELECT count(*)::int AS count FROM workflow.evidence_attachment_drafts
       WHERE evidence_draft_id=ANY($1::uuid[]) AND status='active'`,
      [evidenceDraftIds],
    )
    if (result.rows.length !== total.rows[0]?.count) {
      throw publicationError('SUBMISSION_EVIDENCE_ATTACHMENT_NOT_READY')
    }
    return result.rows
  }

  private assertAssetEvidence(
    assets: readonly ParsedAssetDraft[],
    evidence: readonly EvidenceDraftRow[],
  ): void {
    for (const draft of evidence) {
      if (draft.final_target_kind === 'relation') {
        throw publicationError('SUBMISSION_EVIDENCE_TARGET_INVALID')
      }
      if (
        draft.final_target_kind === 'asset' &&
        !assets.some((asset) => asset.assetDraftKey === draft.target_asset_draft_key)
      ) throw publicationError('SUBMISSION_EVIDENCE_ASSET_TARGET_INVALID')
    }
    for (const asset of assets) {
      if (!evidence.some(
        (draft) => draft.final_target_kind === 'asset' && draft.target_asset_draft_key === asset.assetDraftKey,
      )) throw publicationError('SUBMISSION_ASSET_EVIDENCE_REQUIRED')
    }
  }

  private officialSnapshot(
    snapshot: ProjectSnapshot,
    mediaIds: ReadonlyMap<string, string>,
  ): ProjectSnapshot {
    const covers = snapshot.project_core.cover_media_reference_ids.map((id) => {
      const official = mediaIds.get(id)
      if (!official) throw publicationError('SUBMISSION_COVER_MEDIA_MISMATCH')
      return official
    })
    return Object.freeze({
      ...snapshot,
      project_core: Object.freeze({ ...snapshot.project_core, cover_media_reference_ids: Object.freeze(covers) }),
    }) as ProjectSnapshot
  }

  private evidenceObjectId(
    evidence: EvidenceDraftRow,
    targets: Readonly<{
      projectId: string
      versionId: string
      eventId: string
      assetIds: ReadonlyMap<string, string>
    }>,
  ): string {
    switch (evidence.final_target_kind) {
      case 'project': return targets.projectId
      case 'version': return targets.versionId
      case 'event': return targets.eventId
      case 'asset': {
        const id = evidence.target_asset_draft_key
          ? targets.assetIds.get(evidence.target_asset_draft_key)
          : undefined
        if (!id) throw publicationError('SUBMISSION_EVIDENCE_ASSET_TARGET_INVALID')
        return id
      }
      case 'relation': throw publicationError('SUBMISSION_EVIDENCE_TARGET_INVALID')
    }
  }

  private projection(row: PublicationRow): SubmissionPublicationProjection {
    return Object.freeze({
      submission_id: row.submission_id,
      review_decision_id: row.review_decision_id,
      project_id: row.project_id,
      version_id: row.version_id,
      event_id: row.event_id,
      transaction_id: row.transaction_id,
      published_at: row.published_at.toISOString(),
      schema_version: 'submission_publication.v1',
    })
  }

  private errorCode(error: unknown): string {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.message)) return error.message
    return 'SUBMISSION_PUBLICATION_FAILED'
  }
}
