import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresEvidenceStore } from '../postgres-store.js'
import { EvidenceService } from '../service.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({ connectionString: databaseUrl })
const userId = '93000000-0000-4000-8000-000000000001'
const draftId = '93000000-0000-4000-8000-000000000003'
const resourceId = '93000000-0000-4000-8000-000000000005'
const actor = Object.freeze({ userId, roles: Object.freeze(['user'] as const) })
let clock = new Date('2026-08-13T13:10:00.000Z')
const service = new EvidenceService({
  store: new PostgresEvidenceStore(pool),
  urlSafetyResolver: {
    async resolve() {
      return Object.freeze({
        result: 'allowed' as const,
        safeWebUrl: 'https://Example.com/releases/v1?source=fixture',
        reasonCode: null,
      })
    },
  },
  now: () => clock,
})

async function run(): Promise<void> {
  const existing = await pool.query<{ readonly status: string; readonly version: number }>(
    `SELECT status,version FROM workflow.evidence_drafts
     WHERE owner_user_id=$1 AND client_request_id='evidence-fixture-create-0001'`,
    [userId],
  )
  if (existing.rows[0]) {
    assert.deepEqual(existing.rows[0], { status: 'withdrawn', version: 6 })
    return
  }
  const created = await service.createDraft({
    actor, parentType: 'submission_draft', parentId: draftId, finalTargetKind: 'event',
    targetAssetDraftKey: null, fieldPath: '/event_summary', requestedVisibility: 'public',
    evidenceType: 'trusted_external_source', sourceChannel: 'release_note',
    clientRequestId: 'evidence-fixture-create-0001', requestId: 'evidence-fixture-request-0001',
  })
  const evidenceDraftId = created.evidence_draft_id
  const parent = await pool.query<{ readonly version: number }>(
    'SELECT version FROM workflow.submission_drafts WHERE draft_id=$1', [draftId],
  )
  const bound = await service.bindDraft({
    actor, evidenceDraftId, parentType: 'submission_draft', parentId: draftId,
    expectedParentVersion: parent.rows[0]!.version, operationId: 'evidence-fixture-bind-0001',
    requestId: 'evidence-fixture-request-0002',
  })
  assert.equal(bound.evidence_draft_version, 2)
  clock = new Date('2026-08-13T13:11:00.000Z')
  const patched = await service.patchDraft({
    actor, evidenceDraftId, expectedVersion: 2,
    patch: Object.freeze({ sourceUrl: 'https://example.com/releases/v1#details' }),
    operationId: 'evidence-fixture-patch-0001', requestId: 'evidence-fixture-request-0003',
  })
  assert.equal(patched.version, 3)
  const attachment = await service.createAttachment({
    actor, evidenceDraftId, mediaResourceId: resourceId, role: 'supporting_image',
    requestedVisibility: 'public', expectedDraftVersion: 3,
    clientRequestId: 'evidence-fixture-attach-0001', requestId: 'evidence-fixture-request-0004',
  })
  assert.equal(attachment.evidence_draft_version, 4)
  clock = new Date('2026-08-13T13:12:00.000Z')
  const completed = await service.completeDraft({
    actor, evidenceDraftId, expectedVersion: 4,
    operationId: 'evidence-fixture-complete-0001', requestId: 'evidence-fixture-request-0005',
  })
  assert.equal(completed.status, 'ready')
  assert.equal(completed.final_field_preview?.source_summary, '外部来源域名：example.com')
  assert.equal(completed.final_field_preview?.confidence, 'medium')
  const completeReplay = await service.completeDraft({
    actor, evidenceDraftId, expectedVersion: 4,
    operationId: 'evidence-fixture-complete-0001', requestId: 'evidence-fixture-request-0006',
  })
  assert.equal(completeReplay.version, 5)
  clock = new Date('2026-08-13T13:13:00.000Z')
  const withdrawn = await service.withdrawDraft({
    actor, evidenceDraftId, expectedVersion: 5, reasonCode: 'fixture_withdrawal',
    operationId: 'evidence-fixture-withdraw-0001', requestId: 'evidence-fixture-request-0007',
  })
  assert.equal(withdrawn.status, 'withdrawn')
  assert.equal(withdrawn.attachment_drafts[0]?.status, 'withdrawn')

  const verified = await pool.query<{
    readonly snapshot_count: number
    readonly audit_count: number
    readonly active_reference_count: number
    readonly parent_ids: unknown
    readonly attachment_status: string
  }>(
    `SELECT
       (SELECT count(*)::int FROM workflow.evidence_draft_snapshots
        WHERE evidence_draft_id=$1) AS snapshot_count,
       (SELECT count(*)::int FROM audit.audit_logs
        WHERE target_id IN ($1::text,$2::text)) AS audit_count,
       (SELECT count(*)::int FROM media.media_references
        WHERE media_resource_id=$3 AND lifecycle_status='active') AS active_reference_count,
       (SELECT evidence_draft_ids_json FROM workflow.submission_drafts WHERE draft_id=$4) AS parent_ids,
       (SELECT status FROM workflow.evidence_attachment_drafts
        WHERE attachment_draft_id=$2) AS attachment_status`,
    [evidenceDraftId, attachment.attachment_draft_id, resourceId, draftId],
  )
  assert.equal(verified.rows[0]?.snapshot_count, 6)
  assert.equal(verified.rows[0]?.audit_count, 6)
  assert.equal(verified.rows[0]?.active_reference_count, 0)
  assert.deepEqual(verified.rows[0]?.parent_ids, [evidenceDraftId])
  assert.equal(verified.rows[0]?.attachment_status, 'withdrawn')
}

try {
  await run()
  process.stdout.write('evidence_fixture_ok snapshots=6 audits=6\n')
} finally {
  await pool.end()
}
