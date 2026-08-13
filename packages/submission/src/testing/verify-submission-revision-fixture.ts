import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import pg from 'pg'

import { PostgresSubmissionStore } from '../postgres-store.js'
import { SubmissionService } from '../service.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const userId = '95000000-0000-4000-8000-000000000001'
const sourceCheckId = '95000000-0000-4000-8000-000000000002'
const sourceDraftId = '95000000-0000-4000-8000-000000000003'
const chainId = '95000000-0000-4000-8000-000000000004'
const resourceId = '95000000-0000-4000-8000-000000000005'
const sourceReferenceId = '95000000-0000-4000-8000-000000000006'
const sourceEvidenceId = '95000000-0000-4000-8000-000000000007'
const sourceSubmissionId = '95000000-0000-4000-8000-000000000008'
const sourceWorkItemId = '95000000-0000-4000-8000-000000000009'
const decisionId = '95000000-0000-4000-8000-000000000010'
const now = new Date('2026-08-13T15:00:00.000Z')
const canonicalUrl = 'https://submission-revision-fixture.example'
const canonicalUrlHash = createHash('sha256').update(canonicalUrl, 'utf8').digest()

const service = new SubmissionService({
  store: new PostgresSubmissionStore(pool),
  urlSafetyResolver: {
    async resolve() {
      return Object.freeze({
        result: 'allowed' as const,
        safeWebUrl: canonicalUrl,
        redirectChain: Object.freeze([canonicalUrl]),
        reasonCode: null,
        httpStatusCode: 200,
      })
    },
  },
  config: Object.freeze({ enabled: true, urlCheckTtlSeconds: 1_800, draftTtlSeconds: 2_592_000 }),
  now: () => now,
})

const payload = Object.freeze({
  project_core: Object.freeze({
    current_name: 'Submission Revision Fixture', public_url: canonicalUrl,
    repository_url: null, original_platform: null,
    cover_media_reference_ids: Object.freeze([sourceReferenceId]),
    one_line_definition: '验证退回修改、资产复制与再次提交的事务夹具',
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
  await pool.query(
    `INSERT INTO iam.users (user_id,status,created_at,updated_at)
     VALUES ($1,'active',$2,$2) ON CONFLICT (user_id) DO UPDATE SET status='active',updated_at=$2`,
    [userId, now],
  )
  await pool.query(
    `INSERT INTO workflow.submission_url_checks (
       check_id,owner_user_id,category_id,category_schema_version,input_hash,canonical_url,
       canonical_url_hash,risk_result,access_result,category_result,duplicate_result,
       client_request_id,request_hash,request_id,checked_at,expires_at
     ) VALUES ($1,$2,'personal_site_portfolio','portfolio.v1',$3,$4,$5,
       'allowed','accessible','matched','none','submission-revision-source-check',$6,
       'submission-revision-seed',$7,$8)`,
    [
      sourceCheckId, userId, '2'.repeat(64), canonicalUrl, canonicalUrlHash, '3'.repeat(64),
      now, new Date('2026-08-13T15:30:00.000Z'),
    ],
  )
  await pool.query(
    `INSERT INTO workflow.submission_drafts (
       draft_id,submission_chain_id,owner_user_id,category_id,category_schema_version,check_id,
       payload_snapshot,media_reference_ids_json,evidence_draft_ids_json,status,version,
       idempotency_key,request_hash,created_at,updated_at,saved_at,expires_at
     ) VALUES ($1,$2,$3,'personal_site_portfolio','portfolio.v1',$4,$5::jsonb,$6::jsonb,$7::jsonb,
       'submitted',2,'submission-revision-source-draft',$8,$9,$9,$9,$10)`,
    [
      sourceDraftId, chainId, userId, sourceCheckId, JSON.stringify(payload),
      JSON.stringify([sourceReferenceId]), JSON.stringify([sourceEvidenceId]), '4'.repeat(64), now,
      new Date('2026-09-13T15:00:00.000Z'),
    ],
  )
  await pool.query(
    `INSERT INTO media.media_resources (
       media_resource_id,owner_user_id,purpose,storage_key,declared_mime,detected_mime,byte_size,
       width,height,checksum_sha256,status,scan_result,exif_removed,version,idempotency_key,
       request_hash,created_at,updated_at
     ) VALUES ($1,$2,'project_cover','fixture/submission-revision-cover.png','image/png','image/png',
       2048,1200,800,$3,'ready','clean',true,1,'submission-revision-resource',$4,$5,$5)`,
    [resourceId, userId, '5'.repeat(64), '6'.repeat(64), now],
  )
  await pool.query(
    `INSERT INTO media.media_references (
       media_reference_id,media_resource_id,target_type,target_id,role,alt_text,sort_order,
       lifecycle_status,version,created_at,updated_at
     ) VALUES ($1,$2,'submission_draft',$3,'cover','Submission revision fixture cover',0,
       'active',1,$4,$4)`,
    [sourceReferenceId, resourceId, sourceDraftId, now],
  )
  await pool.query(
    `INSERT INTO workflow.evidence_drafts (
       evidence_draft_id,owner_user_id,collector_actor_type,parent_type,parent_id,final_target_kind,
       evidence_type,source_channel,field_path,requested_visibility,source_url,text_excerpt,status,
       source_hash,final_field_preview_json,bound_at,completed_at,client_request_id,request_hash,
       version,created_at,updated_at
     ) VALUES ($1,$2,'user','submission_draft',$3,'project','trusted_external_source','official_site',
       '/project_core/public_url','public',$4,'Public project page','ready',$5,$6::jsonb,$7,$7,
       'submission-revision-source-evidence',$8,1,$7,$7)`,
    [
      sourceEvidenceId, userId, sourceDraftId, canonicalUrl, '7'.repeat(64),
      JSON.stringify({ source_summary: '外部来源域名：submission-revision-fixture.example', confidence: 'medium' }),
      now, '8'.repeat(64),
    ],
  )
  await pool.query(
    `INSERT INTO workflow.review_work_items (
       work_item_id,work_type,target_type,target_id,status,decision_ref_type,decision_ref_id,
       version,created_at,updated_at
     ) VALUES ($1,'submission','submission',$2,'decided','review_decision',$3,2,$4,$4)`,
    [sourceWorkItemId, sourceSubmissionId, decisionId, now],
  )
  await pool.query(
    `INSERT INTO workflow.submissions (
       submission_id,submission_chain_id,draft_id,owner_user_id,snapshot_version,payload_snapshot,
       evidence_draft_ids_json,media_reference_ids_json,review_status,review_work_item_id,preview_hash,
       idempotency_key,request_hash,version,created_at,updated_at,decided_at
     ) VALUES ($1,$2,$3,$4,1,$5::jsonb,$6::jsonb,$7::jsonb,'changes_requested',$8,$9,
       'submission-revision-source-submission',$10,2,$11,$11,$11)`,
    [
      sourceSubmissionId, chainId, sourceDraftId, userId, JSON.stringify(payload),
      JSON.stringify([sourceEvidenceId]), JSON.stringify([sourceReferenceId]), '9'.repeat(64),
      'a'.repeat(64), now,
    ],
  )
}

async function run(): Promise<void> {
  const source = await pool.query('SELECT submission_id FROM workflow.submissions WHERE submission_id=$1', [sourceSubmissionId])
  if (!source.rows[0]) await seed()

  const revision = await service.createRevisionDraft({
    userId, submissionId: sourceSubmissionId, baseSubmissionId: sourceSubmissionId,
    expectedSubmissionVersion: 2, clientRequestId: 'submission-revision-create-0001',
    requestId: 'submission-revision-request-0001',
  })
  const replay = await service.createRevisionDraft({
    userId, submissionId: sourceSubmissionId, baseSubmissionId: sourceSubmissionId,
    expectedSubmissionVersion: 2, clientRequestId: 'submission-revision-create-0001',
    requestId: 'submission-revision-request-0002',
  })
  assert.equal(replay.draft_id, revision.draft_id)
  assert.equal(revision.draft_revision, 2)
  assert.equal(revision.supersedes_draft_id, sourceDraftId)
  assert.equal(revision.base_submission_id, sourceSubmissionId)
  assert.notEqual(revision.media_reference_ids[0], sourceReferenceId)
  assert.notEqual(revision.evidence_draft_ids[0], sourceEvidenceId)
  assert.deepEqual(
    (revision.payload_snapshot.project_core as { cover_media_reference_ids: string[] }).cover_media_reference_ids,
    revision.media_reference_ids,
  )

  const cloned = await pool.query<{
    readonly evidence_status: string; readonly media_target: string
    readonly source_draft_status: string; readonly source_submission_status: string
    readonly outbox_count: number; readonly audit_count: number
  }>(
    `SELECT evidence.status AS evidence_status,reference.target_id::text AS media_target,
       source_draft.status AS source_draft_status,source_submission.review_status AS source_submission_status,
       (SELECT count(*)::int FROM ops.outbox_events WHERE aggregate_type='submission_draft'
         AND aggregate_id=$1 AND event_name='submission_revision_draft_created') AS outbox_count,
       (SELECT count(*)::int FROM audit.audit_logs WHERE operation_id='OP-DRAFT-REVISE'
         AND target_type='submission_draft' AND target_id=$1) AS audit_count
     FROM workflow.evidence_drafts evidence
     JOIN media.media_references reference ON reference.media_reference_id=$2
     JOIN workflow.submission_drafts source_draft ON source_draft.draft_id=$3
     JOIN workflow.submissions source_submission ON source_submission.submission_id=$4
     WHERE evidence.evidence_draft_id=$5`,
    [revision.draft_id, revision.media_reference_ids[0], sourceDraftId, sourceSubmissionId, revision.evidence_draft_ids[0]],
  )
  assert.equal(cloned.rows[0]?.evidence_status, 'editing')
  assert.equal(cloned.rows[0]?.media_target, revision.draft_id)
  assert.equal(cloned.rows[0]?.source_draft_status, 'submitted')
  assert.equal(cloned.rows[0]?.source_submission_status, 'changes_requested')
  assert.equal(cloned.rows[0]?.outbox_count, 1)
  assert.equal(cloned.rows[0]?.audit_count, 1)

  await pool.query(
    `UPDATE workflow.evidence_drafts SET status='ready',completed_at=$2,updated_at=$2,version=version+1
     WHERE evidence_draft_id=$1 AND status='editing'`,
    [revision.evidence_draft_ids[0], now],
  )
  const preview = await service.previewDraft({
    userId, draftId: revision.draft_id, expectedVersion: 1, checkId: revision.check_id,
    requestId: 'submission-revision-preview-0001',
  })
  const resubmitted = await service.submitDraft({
    userId, draftId: revision.draft_id, draftVersion: 1, checkId: revision.check_id,
    previewHash: preview.preview_hash, submissionKey: 'submission-revision-submit-0001',
    requestId: 'submission-revision-submit-request-0001',
  })
  const successor = await pool.query<{
    readonly supersedes_submission_id: string; readonly submission_chain_id: string
  }>('SELECT supersedes_submission_id,submission_chain_id FROM workflow.submissions WHERE submission_id=$1', [resubmitted.submission_id])
  assert.equal(successor.rows[0]?.supersedes_submission_id, sourceSubmissionId)
  assert.equal(successor.rows[0]?.submission_chain_id, chainId)
}

try {
  await run()
  process.stdout.write('submission_revision_fixture_ok revisions=1 resubmissions=1 immutable_sources=1\n')
} finally {
  await pool.end()
}
