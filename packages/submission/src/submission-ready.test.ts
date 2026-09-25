import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProjectSnapshot } from '@vibecheck/catalog'
import type { Pool } from 'pg'

import { SubmissionError } from './errors.js'
import { PostgresSubmissionStore } from './postgres-store.js'
import { PostgresSubmissionPublisher } from './publication.js'
import { canonicalJson, validateSubmissionReadySnapshot } from './submission-ready.js'

const now = new Date('2026-09-14T08:00:00.000Z')
const input = {
  categoryId: 'personal_site_portfolio' as const,
  schemaVersion: 'portfolio.v1' as const,
  canonicalUrl: 'https://example.com',
  mediaReferenceIds: [], coverMediaReferenceIds: [], evidenceDraftIds: [],
  draftId: 'draft', draftVersion: 1, checkId: 'check', checkInputHash: 'a'.repeat(64),
  checkedAt: now.toISOString(), accessResult: 'uncertain' as const,
  payloadSnapshot: {
    category_id: 'personal_site_portfolio', category_schema_version: 'portfolio.v1',
    project_core: { current_name: 'My work', public_url: 'https://example.com', one_line_definition: 'A personal collection' },
    category_data: {},
  },
}

describe('compact submission snapshots', () => {
  it('accepts four fields without media or evidence and preserves unknowns through catalog parsing', () => {
    const ready = validateSubmissionReadySnapshot(input)
    const published = parseProjectSnapshot(ready.payloadSnapshot, 'personal_site_portfolio', 'portfolio.v1')
    assert.equal(published.category_id, 'personal_site_portfolio')
    if (published.category_id !== 'personal_site_portfolio') throw new Error('wrong category')
    assert.deepEqual(published.project_core.cover_media_reference_ids, [])
    assert.equal(published.project_core.access_status, 'unknown')
    assert.equal(published.project_core.ai_coding_tools.knowledge_state, 'unknown')
    assert.deepEqual(published.category_data.creator_roles, [])
    assert.equal(published.category_data.site_type, 'unknown')
    assert.equal(published.category_data.interaction_level, 'unknown')
    assert.equal(canonicalJson(ready.previewHashInput), canonicalJson(validateSubmissionReadySnapshot(input).previewHashInput))
  })

  it('accepts an empty learning profile without inventing a flow or audience', () => {
    const ready = validateSubmissionReadySnapshot({ ...input,
      categoryId: 'ai_learning_quiz', schemaVersion: 'learning.v1',
      payloadSnapshot: { ...input.payloadSnapshot, category_id: 'ai_learning_quiz', category_schema_version: 'learning.v1' },
    })
    if (ready.projectSnapshot.category_id !== 'ai_learning_quiz') throw new Error('wrong category')
    assert.deepEqual(ready.projectSnapshot.category_data.core_flow, [])
    assert.equal(ready.projectSnapshot.category_data.core_problem, '')
  })

  it('overrides a normal access claim when probing was inconclusive without dropping supplied facts', () => {
    const ready = validateSubmissionReadySnapshot({ ...input, payloadSnapshot: {
      ...input.payloadSnapshot, project_core: { ...input.payloadSnapshot.project_core, access_status: 'normal', tech_stack: ['React'] },
    } })
    assert.equal(ready.projectSnapshot.project_core.access_status, 'unknown')
    assert.deepEqual(ready.projectSnapshot.project_core.tech_stack, ['React'])
  })

  it('still rejects missing required content, invalid category facts and foreign covers', () => {
    for (const payloadSnapshot of [
      { ...input.payloadSnapshot, project_core: { ...input.payloadSnapshot.project_core, current_name: '' } },
      { ...input.payloadSnapshot, category_data: { site_type: 'invented' } },
      { ...input.payloadSnapshot, project_core: { ...input.payloadSnapshot.project_core, cover_media_reference_ids: ['foreign'] } },
    ]) assert.throws(() => validateSubmissionReadySnapshot({ ...input, payloadSnapshot }), SubmissionError)
  })
})

describe('compact submission publication', () => {
  async function publish(approved = true) {
    const submissionId = '81000000-0000-4000-8000-000000000001'
    const decisionId = '81000000-0000-4000-8000-000000000002'
    let status = 'approved'
    let officialSnapshot: unknown
    const client = {
      release() {},
      async query(sql: string, values: unknown[] = []) {
        if (sql.includes('FROM workflow.submissions submission')) return { rows: [{
          submission_id: submissionId, draft_id: 'draft', owner_user_id: 'owner',
          review_status: status, review_work_item_id: 'work', draft_status: 'submitted', version: 1,
          category_id: input.categoryId, category_schema_version: input.schemaVersion,
          payload_snapshot: validateSubmissionReadySnapshot(input).payloadSnapshot,
          canonical_url: input.canonicalUrl, canonical_url_hash: Buffer.alloc(32),
          media_reference_ids_json: [], evidence_draft_ids_json: [], asset_drafts_json: [],
        }] }
        if (sql.includes('FROM workflow.review_decisions decision')) return { rows: [{
          review_decision_id: decisionId, target_id: submissionId, work_item_id: 'work',
          decision: approved ? 'approve' : 'reject', resulting_status: approved ? 'approved' : 'rejected',
        }] }
        if (sql.includes("SET review_status='publishing'")) status = 'publishing'
        if (sql.includes('SELECT count(*)::int')) return { rows: [{ count: 0 }] }
        if (sql.includes('INSERT INTO catalog.project_versions')) officialSnapshot = JSON.parse(values[4] as string)
        return { rows: [], rowCount: 1 }
      },
    }
    const pool = { query: client.query, connect: async () => client } as unknown as Pool
    const result = await new PostgresSubmissionPublisher(pool, () => now).publishApprovedSubmission(submissionId, decisionId)
    return { result, officialSnapshot }
  }

  it('publishes an approved compact snapshot with no fabricated media, evidence or known facts', async () => {
    const { result, officialSnapshot } = await publish()
    assert.equal(result.schema_version, 'submission_publication.v1')
    const snapshot = parseProjectSnapshot(officialSnapshot, input.categoryId, input.schemaVersion)
    assert.equal(snapshot.project_core.access_status, 'unknown')
    assert.deepEqual(snapshot.project_core.cover_media_reference_ids, [])
    assert.deepEqual(snapshot.project_core.tech_stack, [])
  })

  it('does not let the compact payload bypass the review approval gate', async () => {
    await assert.rejects(publish(false), /SUBMISSION_PUBLICATION_DECISION_CONFLICT/)
  })
})

describe('Postgres submission preview eligibility', () => {
  async function preview(overrides: Record<string, unknown> = {}, duplicate = false) {
    const queries: string[] = []
    const client = {
      release() {},
      async query(sql: string) {
        queries.push(sql)
        if (sql.includes('SELECT * FROM workflow.submission_drafts')) return { rows: [{
          draft_id: 'draft', owner_user_id: 'owner', status: 'editing', version: 1,
          category_id: input.categoryId, category_schema_version: input.schemaVersion, check_id: 'check',
          expires_at: new Date(now.getTime() + 60_000), asset_drafts_json: [],
          media_reference_ids_json: [], evidence_draft_ids_json: [], payload_snapshot: input.payloadSnapshot,
        }] }
        if (sql.includes('SELECT * FROM workflow.submission_url_checks')) return { rows: [{
          owner_user_id: 'owner', category_id: input.categoryId, category_schema_version: input.schemaVersion,
          expires_at: new Date(now.getTime() + 60_000), checked_at: now, input_hash: input.checkInputHash,
          risk_result: 'allowed', access_result: 'uncertain', category_result: 'unconfirmed',
          duplicate_result: 'none', canonical_url: input.canonicalUrl, ...overrides,
        }] }
        if (sql.includes('SELECT project_id FROM catalog.projects')) return { rows: duplicate ? [{ project_id: 'existing' }] : [] }
        return { rows: [], rowCount: 0 }
      },
    }
    const store = new PostgresSubmissionStore({ connect: async () => client } as unknown as Pool)
    return { result: await store.previewDraft({ userId: 'owner', draftId: 'draft', expectedVersion: 1, checkId: 'check', requestId: 'request', now }), queries }
  }

  it('creates an audited preview for safe but inconclusive links and unconfirmed classifications', async () => {
    const { result, queries } = await preview()
    assert.equal(result.validation.valid, true)
    assert.deepEqual(result.media_reference_ids, [])
    assert.ok(queries.some((query) => query.includes('INSERT INTO workflow.submission_preview_audits')))
    assert.equal(queries.at(-1), 'COMMIT')
  })

  it('continues rejecting unresolved safety, unavailable links, expired checks and exact duplicate URLs', async () => {
    for (const overrides of [
      { risk_result: 'blocked' }, { risk_result: 'uncertain' }, { access_result: 'unavailable' },
      { canonical_url: null }, { expires_at: new Date(now.getTime() - 1) }, { owner_user_id: 'other' },
    ]) await assert.rejects(preview(overrides), SubmissionError)
    await assert.rejects(preview({}, true), (error: unknown) => error instanceof SubmissionError && error.code === 'SUBMISSION_DUPLICATE_FOUND')
  })
})
