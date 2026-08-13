import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import pg from 'pg'
import { PostgresPublishedProjectIndexer } from '@vibecheck/catalog'

import { PostgresSubmissionPublisher } from '../publication.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const ownerUserId = '96000000-0000-4000-8000-000000000001'
const reviewerUserId = '96000000-0000-4000-8000-000000000002'
const checkId = '96000000-0000-4000-8000-000000000003'
const draftId = '96000000-0000-4000-8000-000000000004'
const chainId = '96000000-0000-4000-8000-000000000005'
const resourceId = '96000000-0000-4000-8000-000000000006'
const referenceId = '96000000-0000-4000-8000-000000000007'
const evidenceDraftId = '96000000-0000-4000-8000-000000000008'
const attachmentDraftId = '96000000-0000-4000-8000-000000000009'
const workItemId = '96000000-0000-4000-8000-000000000010'
const submissionId = '96000000-0000-4000-8000-000000000011'
const reviewDecisionId = '96000000-0000-4000-8000-000000000012'
const reviewTransactionId = '96000000-0000-4000-8000-000000000013'
const now = new Date('2026-08-13T16:00:00.000Z')
const canonicalUrl = 'https://submission-publication-fixture.example'
const publisher = new PostgresSubmissionPublisher(pool, () => now)
const indexer = new PostgresPublishedProjectIndexer(pool, () => now)

const payload = Object.freeze({
  project_core: Object.freeze({
    current_name: 'Publication Transaction Fixture', public_url: canonicalUrl,
    repository_url: null, original_platform: null,
    cover_media_reference_ids: Object.freeze([referenceId]),
    one_line_definition: '验证审核后正式发布事务及幂等收据',
    ai_coding_tools: Object.freeze({
      knowledge_state: 'unknown', values: Object.freeze([]),
      source_type: 'system_inference', observed_at: now.toISOString(),
    }),
    tech_stack: Object.freeze(['TypeScript']), deployment_platform: 'Render',
    access_status: 'normal', maintenance_signal: 'page_updated', status_note: null,
  }),
  category_id: 'personal_site_portfolio', category_schema_version: 'portfolio.v1',
  category_data: Object.freeze({
    site_type: 'portfolio', creator_roles: Object.freeze(['engineer']),
    primary_goals: Object.freeze(['showcase_work']), page_model: 'multi_page',
    navigation_pattern: null, homepage_sequence: Object.freeze([]),
    core_modules: Object.freeze(['hero', 'projects']), project_showcase_format: 'card_grid',
    case_study_depth: 'summary', visual_styles: Object.freeze(['editorial']),
    layout_patterns: Object.freeze(['grid']), color_character: 'neutral', theme_mode: 'light_only',
    interaction_level: 'light', interaction_patterns: Object.freeze(['microinteraction']),
    responsive_support: 'confirmed', blog_support: 'none',
  }),
})

async function seed(): Promise<void> {
  await pool.query('BEGIN')
  try {
    await pool.query(
      `INSERT INTO iam.users (user_id,status,created_at,updated_at)
       VALUES ($1,'active',$3,$3),($2,'active',$3,$3)`,
      [ownerUserId, reviewerUserId, now],
    )
    await pool.query(
      `INSERT INTO workflow.submission_url_checks (
         check_id,owner_user_id,category_id,category_schema_version,input_hash,canonical_url,
         canonical_url_hash,risk_result,access_result,category_result,duplicate_result,
         client_request_id,request_hash,request_id,checked_at,expires_at
       ) VALUES ($1,$2,'personal_site_portfolio','portfolio.v1',$3,$4,$5,
         'allowed','accessible','matched','none','publication-fixture-check-0001',$6,
         'publication-fixture-request-0001',$7,$8)`,
      [checkId, ownerUserId, 'a'.repeat(64), canonicalUrl,
        createHash('sha256').update(canonicalUrl).digest(), 'b'.repeat(64), now,
        new Date('2026-08-13T16:30:00.000Z')],
    )
    await pool.query(
      `INSERT INTO workflow.submission_drafts (
         draft_id,submission_chain_id,owner_user_id,category_id,category_schema_version,check_id,
         payload_snapshot,media_reference_ids_json,evidence_draft_ids_json,asset_drafts_json,
         status,version,idempotency_key,request_hash,created_at,updated_at,saved_at,expires_at
       ) VALUES ($1,$2,$3,'personal_site_portfolio','portfolio.v1',$4,$5::jsonb,$6::jsonb,$7::jsonb,
         '[]'::jsonb,'submitted',2,'publication-fixture-draft-0001',$8,$9,$9,$9,$10)`,
      [draftId, chainId, ownerUserId, checkId, JSON.stringify(payload), JSON.stringify([referenceId]),
        JSON.stringify([evidenceDraftId]), 'c'.repeat(64), now,
        new Date('2026-09-13T16:00:00.000Z')],
    )
    await pool.query(
      `INSERT INTO media.media_resources (
         media_resource_id,owner_user_id,purpose,storage_key,declared_mime,detected_mime,byte_size,
         width,height,checksum_sha256,status,scan_result,exif_removed,version,idempotency_key,
         request_hash,created_at,updated_at
       ) VALUES ($1,$2,'project_cover','fixture/publication-cover.png','image/png','image/png',
         2048,1200,800,$3,'ready','clean',true,1,'publication-fixture-resource-0001',$4,$5,$5)`,
      [resourceId, ownerUserId, 'd'.repeat(64), 'e'.repeat(64), now],
    )
    await pool.query(
      `INSERT INTO media.media_references (
         media_reference_id,media_resource_id,target_type,target_id,role,alt_text,sort_order,
         lifecycle_status,version,created_at,updated_at
       ) VALUES ($1,$2,'submission_draft',$3,'cover','Publication transaction fixture cover',0,
         'active',1,$4,$4)`,
      [referenceId, resourceId, draftId, now],
    )
    await pool.query(
      `INSERT INTO workflow.evidence_drafts (
         evidence_draft_id,owner_user_id,collector_actor_type,parent_type,parent_id,final_target_kind,
         evidence_type,source_channel,field_path,requested_visibility,source_url,text_excerpt,status,
         source_hash,final_field_preview_json,bound_at,completed_at,client_request_id,request_hash,
         version,created_at,updated_at
       ) VALUES ($1,$2,'user','submission_draft',$3,'project','trusted_external_source','official_site',
         '/project_core/public_url','public',$4,'Public publication fixture page','ready',$5,$6::jsonb,
         $7,$7,'publication-fixture-evidence-0001',$8,1,$7,$7)`,
      [evidenceDraftId, ownerUserId, draftId, canonicalUrl, 'f'.repeat(64), JSON.stringify({
        source_summary: 'Public publication fixture page', captured_at: now.toISOString(),
        collected_by: 'user', confidence: 'medium', source_channel: 'official_site',
      }), now, '1'.repeat(64)],
    )
    await pool.query(
      `INSERT INTO workflow.evidence_attachment_drafts (
         attachment_draft_id,evidence_draft_id,media_resource_id,role,requested_visibility,status,
         version,client_request_id,request_hash,created_at,updated_at
       ) VALUES ($1,$2,$3,'supporting_image','public','active',1,
         'publication-fixture-attachment-0001',$4,$5,$5)`,
      [attachmentDraftId, evidenceDraftId, resourceId, '2'.repeat(64), now],
    )
    await pool.query(
      `INSERT INTO workflow.review_work_items (
         work_item_id,work_type,target_type,target_id,status,version,created_at,updated_at
       ) VALUES ($1,'submission','submission',$2,'queued',1,$3,$3)`,
      [workItemId, submissionId, now],
    )
    await pool.query(
      `INSERT INTO workflow.submissions (
         submission_id,submission_chain_id,draft_id,owner_user_id,snapshot_version,payload_snapshot,
         evidence_draft_ids_json,media_reference_ids_json,review_status,review_work_item_id,
         preview_hash,idempotency_key,request_hash,version,created_at,updated_at,decided_at
       ) VALUES ($1,$2,$3,$4,1,$5::jsonb,$6::jsonb,$7::jsonb,'approved',$8,$9,
         'publication-fixture-submission-0001',$10,2,$11,$11,$11)`,
      [submissionId, chainId, draftId, ownerUserId, JSON.stringify(payload),
        JSON.stringify([evidenceDraftId]), JSON.stringify([referenceId]), workItemId,
        '3'.repeat(64), '4'.repeat(64), now],
    )
    await pool.query(
      `INSERT INTO workflow.review_decisions (
         review_decision_id,decision_request_id,work_item_id,work_type,target_type,target_id,
         decision,actor_user_id,reason_code,field_paths_json,decision_evidence_refs_json,
         preview_hash,confirmation_summary_hash,decision_payload_hash,resulting_status,
         transaction_id,committed_at,schema_version
       ) VALUES ($1,'publication_fixture_decision',$2,'submission','submission',$3,'approve',$4,
         'submission_approved','[]'::jsonb,'[]'::jsonb,$5,$6,$7,'approved',$8,$9,'review_decision.v1')`,
      [reviewDecisionId, workItemId, submissionId, reviewerUserId,
        '5'.repeat(64), '6'.repeat(64), '7'.repeat(64), reviewTransactionId, now],
    )
    await pool.query(
      `UPDATE workflow.review_work_items SET status='decided',decision_ref_type='review_decision',
         decision_ref_id=$2,version=2,updated_at=$3 WHERE work_item_id=$1`,
      [workItemId, reviewDecisionId, now],
    )
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw error
  }
}

async function run(): Promise<void> {
  const existing = await pool.query(
    'SELECT 1 FROM workflow.submissions WHERE submission_id=$1',
    [submissionId],
  )
  if (!existing.rows[0]) await seed()

  const published = await publisher.publishApprovedSubmission(submissionId, reviewDecisionId)
  const replay = await publisher.publishApprovedSubmission(submissionId, reviewDecisionId)
  assert.deepEqual(replay, published)
  const indexed = await indexer.indexPublishedProject({
    projectId: published.project_id,
    versionId: published.version_id,
    submissionId,
    reviewDecisionId,
  })
  const indexReplay = await indexer.indexPublishedProject({
    projectId: published.project_id,
    versionId: published.version_id,
    submissionId,
    reviewDecisionId,
  })
  assert.equal(indexReplay.project_id, indexed.project_id)
  assert.equal(indexReplay.version_id, indexed.version_id)
  assert.equal(indexReplay.index_status, 'already_current')
  await assert.rejects(
    () => publisher.publishApprovedSubmission(
      submissionId, '96000000-0000-4000-8000-000000000099',
    ),
    (error: unknown) => error instanceof Error &&
      error.message === 'SUBMISSION_PUBLICATION_DECISION_CONFLICT',
  )

  const verified = await pool.query<{
    readonly review_status: string
    readonly resulting_project_id: string
    readonly publish_attempt_count: number
    readonly project_status: string
    readonly record_source: string
    readonly author_link_status: string
    readonly version_count: number
    readonly version_source: string
    readonly event_count: number
    readonly evidence_count: number
    readonly attachment_count: number
    readonly official_media_count: number
    readonly author_relation_count: number
    readonly receipt_count: number
    readonly outbox_count: number
    readonly cover_ids: string[]
    readonly search_document_count: number
    readonly counter_count: number
  }>(
    `SELECT submission.review_status,submission.resulting_project_id,submission.publish_attempt_count,
       project.review_status AS project_status,project.record_source,project.author_link_status,
       (SELECT count(*)::int FROM catalog.project_versions WHERE project_id=project.project_id) AS version_count,
       version.source_decision_type AS version_source,
       (SELECT count(*)::int FROM catalog.events WHERE project_id=project.project_id
          AND event_type='first_published') AS event_count,
       (SELECT count(*)::int FROM catalog.evidence WHERE project_id=project.project_id) AS evidence_count,
       (SELECT count(*)::int FROM catalog.evidence_attachments attachment
          JOIN catalog.evidence evidence ON evidence.evidence_id=attachment.evidence_id
          WHERE evidence.project_id=project.project_id) AS attachment_count,
       (SELECT count(*)::int FROM media.media_references reference
          WHERE reference.target_type='project_version' AND reference.target_id=version.version_id
            AND reference.source_media_reference_id=$2) AS official_media_count,
       (SELECT count(*)::int FROM catalog.author_relations WHERE project_id=project.project_id) AS author_relation_count,
       (SELECT count(*)::int FROM workflow.submission_publication_receipts
          WHERE submission_id=submission.submission_id) AS receipt_count,
       (SELECT count(*)::int FROM ops.outbox_events WHERE aggregate_type='project'
          AND aggregate_id=project.project_id::text AND event_name='project_published') AS outbox_count,
       (SELECT count(*)::int FROM search.project_documents document
          WHERE document.project_id=project.project_id AND document.version_id=version.version_id
            AND document.visibility='public') AS search_document_count,
       (SELECT count(*)::int FROM catalog.project_interaction_counters counter
          WHERE counter.project_id=project.project_id) AS counter_count,
       ARRAY(SELECT jsonb_array_elements_text(version.snapshot_json->'project_core'->'cover_media_reference_ids')) AS cover_ids
     FROM workflow.submissions submission
     JOIN catalog.projects project ON project.project_id=submission.resulting_project_id
     JOIN catalog.project_versions version ON version.version_id=project.current_version_id
     WHERE submission.submission_id=$1`,
    [submissionId, referenceId],
  )
  const row = verified.rows[0]!
  assert.equal(row.review_status, 'published')
  assert.equal(row.resulting_project_id, published.project_id)
  assert.equal(row.publish_attempt_count, 1)
  assert.equal(row.project_status, 'published_platform')
  assert.equal(row.record_source, 'user_submission')
  assert.equal(row.author_link_status, 'unlinked')
  assert.equal(row.version_count, 1)
  assert.equal(row.version_source, 'review_decision')
  assert.equal(row.event_count, 1)
  assert.equal(row.evidence_count, 1)
  assert.equal(row.attachment_count, 1)
  assert.equal(row.official_media_count, 1)
  assert.equal(row.author_relation_count, 0)
  assert.equal(row.receipt_count, 1)
  assert.equal(row.outbox_count, 1)
  assert.equal(row.search_document_count, 1)
  assert.equal(row.counter_count, 1)
  assert.equal(row.cover_ids.length, 1)
  assert.notEqual(row.cover_ids[0], referenceId)
}

try {
  await run()
  process.stdout.write('submission_publication_fixture_ok projects=1 versions=1 events=1 evidence=1 receipts=1\n')
} finally {
  await pool.end()
}
