import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { EvidenceError } from './errors.js'
import { EvidenceService } from './service.js'
import type { EvidenceStore } from './store-port.js'
import type { EvidenceDraftProjection } from './types.js'

const draft: EvidenceDraftProjection = Object.freeze({
  evidence_draft_id: '92000000-0000-4000-8000-000000000001',
  collector_actor_type: 'user',
  parent_type: 'submission_draft',
  parent_id: '92000000-0000-4000-8000-000000000002',
  final_target_kind: 'event',
  target_asset_draft_key: null,
  evidence_type: 'trusted_external_source',
  source_channel: 'official_site',
  field_path: '/event_summary',
  requested_visibility: 'public',
  source_url: null,
  text_excerpt: null,
  attachment_drafts: Object.freeze([]),
  status: 'editing',
  bound: false,
  source_hash: 'a'.repeat(64),
  final_field_preview: null,
  completed_at: null,
  promoted_evidence_id: null,
  version: 1,
  created_at: '2026-08-13T12:00:00.000Z',
  updated_at: '2026-08-13T12:00:00.000Z',
})

class FakeStore implements EvidenceStore {
  createInput: Parameters<EvidenceStore['createDraft']>[0] | null = null
  patchInput: Parameters<EvidenceStore['patchDraft']>[0] | null = null
  async createDraft(input: Parameters<EvidenceStore['createDraft']>[0]) { this.createInput = input; return draft }
  async getDraft() { return draft }
  async patchDraft(input: Parameters<EvidenceStore['patchDraft']>[0]) { this.patchInput = input; return draft }
  bindDraft(): never { throw new Error('not used') }
  completeDraft(): never { throw new Error('not used') }
  createAttachment(): never { throw new Error('not used') }
  deleteAttachment(): never { throw new Error('not used') }
  withdrawDraft(): never { throw new Error('not used') }
}

const actor = Object.freeze({
  userId: '92000000-0000-4000-8000-000000000003',
  roles: Object.freeze(['user'] as const),
})

describe('EvidenceService', () => {
  it('freezes collector identity and resolves a safe source URL before persistence', async () => {
    const store = new FakeStore()
    const service = new EvidenceService({
      store,
      urlSafetyResolver: {
        async resolve() {
          return Object.freeze({
            result: 'allowed' as const,
            safeWebUrl: 'https://example.com/release?ref=official',
            reasonCode: null,
          })
        },
      },
    })
    await service.createDraft({
      actor, parentType: 'submission_draft', parentId: draft.parent_id,
      finalTargetKind: 'event', targetAssetDraftKey: null, fieldPath: '/event_summary',
      requestedVisibility: 'public', evidenceType: 'trusted_external_source',
      sourceChannel: 'official_site', clientRequestId: 'evidence-create-0001',
      requestId: 'evidence-request-0001',
    })
    assert.equal(store.createInput?.collectorActorType, 'user')
    await service.patchDraft({
      actor, evidenceDraftId: draft.evidence_draft_id, expectedVersion: 1,
      patch: Object.freeze({ sourceUrl: 'https://example.com/release#section' }),
      operationId: 'evidence-patch-0001', requestId: 'evidence-request-0002',
    })
    assert.equal(store.patchInput?.patch.sourceUrl, 'https://example.com/release?ref=official')
  })

  it('rejects invalid parent-target matrices and author statements outside project updates', async () => {
    const service = new EvidenceService({
      store: new FakeStore(),
      urlSafetyResolver: { async resolve() { throw new Error('not used') } },
    })
    assert.throws(
      () => service.createDraft({
        actor, parentType: 'relation_candidate', parentId: draft.parent_id,
        finalTargetKind: 'project', targetAssetDraftKey: null, fieldPath: null,
        requestedVisibility: 'public', evidenceType: 'trusted_external_source',
        sourceChannel: 'official_site', clientRequestId: 'evidence-create-0002',
        requestId: 'evidence-request-0003',
      }),
      (error: unknown) => error instanceof EvidenceError && error.code === 'EVIDENCE_TARGET_MATRIX_INVALID',
    )
    assert.throws(
      () => service.createDraft({
        actor, parentType: 'submission_draft', parentId: draft.parent_id,
        finalTargetKind: 'project', targetAssetDraftKey: null, fieldPath: null,
        requestedVisibility: 'public', evidenceType: 'verified_author_statement',
        sourceChannel: 'author_statement', clientRequestId: 'evidence-create-0003',
        requestId: 'evidence-request-0004',
      }),
      (error: unknown) => error instanceof EvidenceError &&
        error.code === 'EVIDENCE_AUTHOR_CONTEXT_FORBIDDEN',
    )
  })

  it('derives an author collector only from a project-update statement context', async () => {
    const store = new FakeStore()
    const service = new EvidenceService({
      store,
      urlSafetyResolver: { async resolve() { throw new Error('not used') } },
    })
    await service.createDraft({
      actor, parentType: 'project_update', parentId: draft.parent_id,
      finalTargetKind: 'project', targetAssetDraftKey: null,
      fieldPath: '/project_core/current_name', requestedVisibility: 'public',
      evidenceType: 'verified_author_statement', sourceChannel: 'author_statement',
      clientRequestId: 'evidence-create-author-0001', requestId: 'evidence-request-author-0001',
    })
    assert.equal(store.createInput?.collectorActorType, 'verified_author')
    assert.throws(
      () => service.createDraft({
        actor, parentType: 'project_update', parentId: draft.parent_id,
        finalTargetKind: 'project', targetAssetDraftKey: null,
        fieldPath: '/project_core/current_name', requestedVisibility: 'public',
        evidenceType: 'verified_author_statement', sourceChannel: 'official_site',
        clientRequestId: 'evidence-create-author-0002', requestId: 'evidence-request-author-0002',
      }),
      (error: unknown) => error instanceof EvidenceError &&
        error.code === 'EVIDENCE_AUTHOR_SOURCE_CHANNEL_REQUIRED',
    )
  })
})
