import assert from 'node:assert/strict'

import { Pool } from 'pg'

import { AdminProjectImportError, PostgresAdminProjectImporter } from '../admin-importer.js'
import { syntheticCatalogFixture } from './synthetic-fixture.js'

const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({ connectionString, ssl, application_name: 'vibecheck-admin-import-verify', max: 3 })
const editorId = '2a000000-0000-4000-8000-000000000001'
const regularUserId = '2a000000-0000-4000-8000-000000000002'
const sourceName = 'ci-reviewed-catalog'

function item(index: number) {
  const project = syntheticCatalogFixture.projects[index]!
  return {
    source_record_key: `reviewed-project-${index + 1}`,
    category_id: project.snapshot.category_id,
    category_schema_version: project.snapshot.category_schema_version,
    reason_code: 'COLD_START_REVIEW',
    initial_snapshot: project.snapshot,
  }
}

function envelope(batchKey: string, items: readonly unknown[]) {
  return {
    schema_version: 'admin_project_import.v1',
    batch_key: batchKey,
    items,
  }
}

try {
  await pool.query(
    `INSERT INTO iam.users (user_id,status) VALUES ($1,'active'),($2,'active')
     ON CONFLICT (user_id) DO NOTHING`,
    [editorId, regularUserId],
  )
  await pool.query(
    `INSERT INTO iam.user_roles (user_id,role,granted_by_operation_id)
     VALUES ($1,'editor','ci-admin-import-fixture')
     ON CONFLICT (user_id,role) WHERE valid_to IS NULL DO NOTHING`,
    [editorId],
  )
  const importer = new PostgresAdminProjectImporter(pool)
  const projectsBefore = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM catalog.projects',
  )
  const acceptedInput = envelope('reviewed-batch-001', [item(0), item(1)])
  const accepted = await importer.import({
    sourceName,
    actorUserId: editorId,
    requestId: 'ci-import-request-001',
    input: acceptedInput,
  })
  assert.equal(accepted.status, 'completed')
  assert.equal(accepted.accepted_count, 2)
  assert.equal(accepted.rejected_count, 0)
  assert.ok(accepted.items.every(({ duplicate_candidates }) => duplicate_candidates.length === 1))
  assert.ok(accepted.items.every(({ replayed }) => replayed === false))

  const sameBatchReplay = await importer.import({
    sourceName,
    actorUserId: editorId,
    requestId: 'ci-import-request-001-retry',
    input: acceptedInput,
  })
  assert.deepEqual(sameBatchReplay, accepted)

  const crossBatchReplay = await importer.import({
    sourceName,
    actorUserId: editorId,
    requestId: 'ci-import-request-002',
    input: envelope('reviewed-batch-002', [item(0)]),
  })
  assert.equal(crossBatchReplay.status, 'completed')
  assert.equal(crossBatchReplay.items[0]!.replayed, true)
  assert.equal(crossBatchReplay.items[0]!.admin_creation_draft_id, accepted.items[0]!.admin_creation_draft_id)

  const changedItem = { ...item(0), reason_code: 'SOURCE_RECORD_CHANGED' }
  const conflict = await importer.import({
    sourceName,
    actorUserId: editorId,
    requestId: 'ci-import-request-003',
    input: envelope('reviewed-batch-003', [changedItem]),
  })
  assert.equal(conflict.status, 'completed_with_errors')
  assert.equal(conflict.items[0]!.error_code, 'IMPORT_ITEM_KEY_CONFLICT')

  const invalid = await importer.import({
    sourceName,
    actorUserId: editorId,
    requestId: 'ci-import-request-004',
    input: envelope('reviewed-batch-004', [{
      ...item(1),
      source_record_key: 'invalid-schema-pair',
      category_id: 'ai_learning_quiz',
      category_schema_version: 'portfolio.v1',
    }]),
  })
  assert.equal(invalid.status, 'completed_with_errors')
  assert.equal(invalid.items[0]!.error_code, 'IMPORT_CATEGORY_SCHEMA_MISMATCH')

  await assert.rejects(
    () => importer.import({
      sourceName,
      actorUserId: regularUserId,
      requestId: 'ci-import-request-forbidden',
      input: envelope('reviewed-batch-forbidden', [item(2)]),
    }),
    (error) => error instanceof AdminProjectImportError && error.code === 'IMPORT_ACTOR_FORBIDDEN',
  )

  const facts = await pool.query<{
    project_count: number
    draft_count: number
    receipt_count: number
    creation_audit_count: number
    forbidden_batch_count: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM catalog.projects) AS project_count,
       (SELECT count(*)::int FROM workflow.admin_project_creation_drafts
         WHERE import_source=$1) AS draft_count,
       (SELECT count(*)::int FROM workflow.admin_project_import_receipts receipt
         JOIN workflow.admin_project_import_batches batch
           ON batch.import_batch_id=receipt.import_batch_id
         WHERE batch.source_name=$1) AS receipt_count,
       (SELECT count(*)::int FROM audit.audit_logs
         WHERE target_type='admin_project_creation_draft'
           AND diff_json->>'import_source'=$1 AND result='accepted') AS creation_audit_count,
       (SELECT count(*)::int FROM workflow.admin_project_import_batches
         WHERE source_name=$1 AND batch_key='reviewed-batch-forbidden') AS forbidden_batch_count`,
    [sourceName],
  )
  assert.equal(facts.rows[0]!.project_count, projectsBefore.rows[0]!.count)
  assert.equal(facts.rows[0]!.draft_count, 2)
  assert.equal(facts.rows[0]!.receipt_count, 5)
  assert.equal(facts.rows[0]!.creation_audit_count, 2)
  assert.equal(facts.rows[0]!.forbidden_batch_count, 0)

  const receiptId = await pool.query<{ import_item_id: string }>(
    `SELECT import_item_id FROM workflow.admin_project_import_receipts
     ORDER BY created_at,import_item_id LIMIT 1`,
  )
  await assert.rejects(
    () => pool.query(
      'UPDATE workflow.admin_project_import_receipts SET result_json=result_json WHERE import_item_id=$1',
      [receiptId.rows[0]!.import_item_id],
    ),
    /IMMUTABLE_IMPORT_RECEIPT/,
  )
  const auditId = await pool.query<{ audit_id: string }>(
    `SELECT audit_id FROM audit.audit_logs
     WHERE target_type='admin_project_creation_draft' ORDER BY created_at LIMIT 1`,
  )
  await assert.rejects(
    () => pool.query('DELETE FROM audit.audit_logs WHERE audit_id=$1', [auditId.rows[0]!.audit_id]),
    /IMMUTABLE_AUDIT_LOG/,
  )

  console.info(JSON.stringify({
    message: 'admin_project_import_verified',
    accepted_draft_count: facts.rows[0]!.draft_count,
    receipt_count: facts.rows[0]!.receipt_count,
    project_count_unchanged: true,
  }))
} finally {
  await pool.end()
}
