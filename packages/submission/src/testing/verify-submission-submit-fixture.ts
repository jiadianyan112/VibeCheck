import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresSubmissionStore } from '../postgres-store.js'
import { SubmissionService } from '../service.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const userId = '94000000-0000-4000-8000-000000000001'
const checkId = '94000000-0000-4000-8000-000000000002'
const draftId = '94000000-0000-4000-8000-000000000003'
const chainId = '94000000-0000-4000-8000-000000000004'
const resourceId = '94000000-0000-4000-8000-000000000005'
const referenceId = '94000000-0000-4000-8000-000000000006'
const evidenceDraftId = '94000000-0000-4000-8000-000000000007'
const now = new Date('2026-08-13T14:00:00.000Z')
const canonicalUrl = 'https://submission-submit-fixture.example'
const service = new SubmissionService({
  store: new PostgresSubmissionStore(pool),
  urlSafetyResolver: { async resolve() { throw new Error('FIXTURE_RESOLVER_MUST_NOT_RUN') } },
  config: Object.freeze({ enabled: true, urlCheckTtlSeconds: 1_800, draftTtlSeconds: 2_592_000 }),
  now: () => now,
})

const payload = Object.freeze({
  project_core: Object.freeze({
    current_name: 'Submission Transaction Fixture', public_url: canonicalUrl,
    repository_url: null, original_platform: null,
    cover_media_reference_ids: Object.freeze([referenceId]),
    one_line_definition: '验证提交冻结事务的完整作品集夹具',
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
     ) VALUES ($1,$2,'personal_site_portfolio','portfolio.v1',$3,$4,digest($4::text,'sha256'),
       'allowed','accessible','matched','none','submission-submit-check-0001',$5,
       'submission-submit-request-0001',$6,$7)`,
    [checkId, userId, 'a'.repeat(64), canonicalUrl, 'b'.repeat(64), now, new Date('2026-08-13T14:30:00.000Z')],
  )
  await pool.query(
    `INSERT INTO workflow.submission_drafts (
       draft_id,submission_chain_id,owner_user_id,category_id,category_schema_version,check_id,
       payload_snapshot,media_reference_ids_json,evidence_draft_ids_json,status,version,
       idempotency_key,request_hash,created_at,updated_at,saved_at,expires_at
     ) VALUES ($1,$2,$3,'personal_site_portfolio','portfolio.v1',$4,$5::jsonb,$6::jsonb,$7::jsonb,
       'editing',1,'submission-submit-draft-0001',$8,$9,$9,$9,$10)`,
    [
      draftId, chainId, userId, checkId, JSON.stringify(payload), JSON.stringify([referenceId]),
      JSON.stringify([evidenceDraftId]), 'c'.repeat(64), now, new Date('2026-09-13T14:00:00.000Z'),
    ],
  )
  await pool.query(
    `INSERT INTO media.media_resources (
       media_resource_id,owner_user_id,purpose,storage_key,declared_mime,detected_mime,byte_size,
       width,height,checksum_sha256,status,scan_result,exif_removed,version,idempotency_key,
       request_hash,created_at,updated_at
     ) VALUES ($1,$2,'project_cover','fixture/submission-submit-cover.png','image/png','image/png',
       2048,1200,800,$3,'ready','clean',true,1,'submission-submit-resource-0001',$4,$5,$5)`,
    [resourceId, userId, 'd'.repeat(64), 'e'.repeat(64), now],
  )
  await pool.query(
    `INSERT INTO media.media_references (
       media_reference_id,media_resource_id,target_type,target_id,role,alt_text,sort_order,
       lifecycle_status,version,created_at,updated_at
     ) VALUES ($1,$2,'submission_draft',$3,'cover','Submission transaction fixture cover',0,
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
       '/project_core/public_url','public',$4,'Public project page','ready',$5,$6::jsonb,$7,$7,
       'submission-submit-evidence-0001',$8,1,$7,$7)`,
    [
      evidenceDraftId, userId, draftId, canonicalUrl, 'f'.repeat(64),
      JSON.stringify({ source_summary: '外部来源域名：submission-submit-fixture.example', confidence: 'medium' }),
      now, '1'.repeat(64),
    ],
  )
}

async function run(): Promise<void> {
  const existing = await pool.query<{ readonly submission_id: string }>(
    `SELECT submission_id FROM workflow.submissions WHERE owner_user_id=$1 AND idempotency_key=$2`,
    [userId, 'submission-submit-key-0001'],
  )
  if (!existing.rows[0]) await seed()
  let submissionId = existing.rows[0]?.submission_id
  if (!submissionId) {
    const preview = await service.previewDraft({
      userId, draftId, expectedVersion: 1, checkId, requestId: 'submission-submit-preview-0001',
    })
    assert.equal(preview.validation.valid, true)
    const submitted = await service.submitDraft({
      userId, draftId, draftVersion: 1, checkId, previewHash: preview.preview_hash,
      submissionKey: 'submission-submit-key-0001', requestId: 'submission-submit-request-0002',
    })
    const replay = await service.submitDraft({
      userId, draftId, draftVersion: 1, checkId, previewHash: preview.preview_hash,
      submissionKey: 'submission-submit-key-0001', requestId: 'submission-submit-request-0003',
    })
    assert.equal(replay.submission_id, submitted.submission_id)
    submissionId = submitted.submission_id
  }
  const withdrawn = await service.withdrawSubmission({
    userId, submissionId, expectedVersion: 1,
    operationId: 'submission-withdraw-operation-0001', reasonCode: 'fixture_withdrawal',
    requestId: 'submission-withdraw-request-0001',
  })
  const withdrawalReplay = await service.withdrawSubmission({
    userId, submissionId, expectedVersion: 1,
    operationId: 'submission-withdraw-operation-0001', reasonCode: 'fixture_withdrawal',
    requestId: 'submission-withdraw-request-0002',
  })
  assert.deepEqual(withdrawalReplay, withdrawn)
  const verified = await pool.query<{
    readonly review_status: string; readonly draft_status: string; readonly draft_version: number
    readonly work_status: string; readonly principal_count: number; readonly outbox_count: number
    readonly project_count: number; readonly payload: Record<string, unknown>
    readonly withdrawal_outbox_count: number; readonly withdrawal_receipt_count: number
    readonly cancellation_event_count: number
  }>(
    `SELECT submission.review_status,draft.status AS draft_status,draft.version AS draft_version,
       work.status AS work_status,
       (SELECT count(*)::int FROM workflow.review_work_item_conflict_principals
        WHERE work_item_id=work.work_item_id AND principal_user_id=$2) AS principal_count,
       (SELECT count(*)::int FROM ops.outbox_events WHERE aggregate_type='submission'
        AND aggregate_id=submission.submission_id::text AND event_name='project_submitted') AS outbox_count,
       (SELECT count(*)::int FROM ops.outbox_events WHERE aggregate_type='submission'
        AND aggregate_id=submission.submission_id::text AND event_name='submission_withdrawn') AS withdrawal_outbox_count,
       (SELECT count(*)::int FROM workflow.submission_operation_receipts
        WHERE submission_id=submission.submission_id AND operation_type='withdraw') AS withdrawal_receipt_count,
       (SELECT count(*)::int FROM workflow.review_work_item_events
        WHERE work_item_id=work.work_item_id AND event_type='cancelled') AS cancellation_event_count,
       (SELECT count(*)::int FROM catalog.projects WHERE canonical_url_hash=digest($3,'sha256')) AS project_count,
       (SELECT payload_json FROM ops.outbox_events WHERE aggregate_id=submission.submission_id::text
        AND event_name='project_submitted' LIMIT 1) AS payload
     FROM workflow.submissions submission
     JOIN workflow.submission_drafts draft ON draft.draft_id=submission.draft_id
     JOIN workflow.review_work_items work ON work.work_item_id=submission.review_work_item_id
     WHERE submission.submission_id=$1`,
    [submissionId, userId, canonicalUrl],
  )
  assert.equal(verified.rows[0]?.review_status, 'withdrawn')
  assert.equal(verified.rows[0]?.draft_status, 'submitted')
  assert.equal(verified.rows[0]?.draft_version, 2)
  assert.equal(verified.rows[0]?.work_status, 'cancelled')
  assert.equal(verified.rows[0]?.principal_count, 1)
  assert.equal(verified.rows[0]?.outbox_count, 1)
  assert.equal(verified.rows[0]?.withdrawal_outbox_count, 1)
  assert.equal(verified.rows[0]?.withdrawal_receipt_count, 1)
  assert.equal(verified.rows[0]?.cancellation_event_count, 1)
  assert.equal(verified.rows[0]?.project_count, 0)
  assert.equal('project_id' in (verified.rows[0]?.payload ?? {}), false)
}

try {
  await run()
  process.stdout.write('submission_submit_fixture_ok submissions=1 work_items=1 withdrawal=1 projects=0\n')
} finally {
  await pool.end()
}
