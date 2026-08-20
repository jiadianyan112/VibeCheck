import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ReviewDecisionStore } from './review-decision-store.js'
import { ReviewDecisionService } from './review-decision-service.js'
import type {
  ReviewDecisionProjection,
  StoredReviewDecisionInput,
} from './review-decision-types.js'

const actor = Object.freeze({
  userId: '10000000-0000-4000-8000-000000000001',
  roles: Object.freeze(['editor'] as const),
  permissions: Object.freeze(['admin:review']),
})

class FakeStore implements ReviewDecisionStore {
  input: StoredReviewDecisionInput | null = null

  async decideReview(input: StoredReviewDecisionInput): Promise<ReviewDecisionProjection> {
    this.input = input
    return Object.freeze({
      review_decision_id: '10000000-0000-4000-8000-000000000002',
      work_item_id: input.workItemId,
      work_type: 'submission',
      target_type: 'submission',
      target_id: '10000000-0000-4000-8000-000000000003',
      decision: input.decision,
      project_id: null,
      base_version_id: null,
      resulting_status: input.resultingStatus,
      work_item_status: 'decided',
      work_item_decision_ref_type: 'review_decision',
      transaction_id: '10000000-0000-4000-8000-000000000004',
      committed_at: input.now.toISOString(),
      schema_version: 'review_decision.v1',
      domain_status: input.resultingStatus,
      outbox_status: 'pending',
      resulting_creator_id: null,
      resulting_link_id: null,
      resulting_author_relation_id: null,
      resulting_profile_version_id: null,
      approved_link_role: null,
      approved_permission_profile_ref: null,
      effective_capabilities: Object.freeze([]),
      effective_field_permissions: Object.freeze([]),
      creator_aggregate_version: null,
      owner_link_set_version: null,
    })
  }
}

function service(store: FakeStore): ReviewDecisionService {
  return new ReviewDecisionService(store, {
    tokenSecret: 'workflow-test-secret-that-is-at-least-32-chars',
    authTokenSecret: 'identity-test-secret-that-is-at-least-32-chars',
  }, () => new Date('2026-08-13T14:00:00.000Z'))
}

function command(overrides: Partial<Parameters<ReviewDecisionService['decideSubmission']>[0]> = {}) {
  return {
    actor,
    sessionToken: 's'.repeat(43),
    workItemId: '10000000-0000-4000-8000-000000000005',
    previewToken: 'p'.repeat(43),
    claimToken: 'c'.repeat(43),
    confirmToken: 'f'.repeat(43),
    decision: 'approve',
    reasonCode: 'submission_approved',
    fieldPaths: [],
    decisionEvidenceRefs: [],
    expectedVersion: 2,
    decisionRequestId: 'decision_request_0001',
    decisionPayload: {},
    requestId: 'request_decision_0001',
    ...overrides,
  }
}

describe('ReviewDecisionService', () => {
  it('normalizes a submission approval and binds all opaque credentials', async () => {
    const store = new FakeStore()
    const projection = await service(store).decideSubmission(command())
    assert.equal(projection.resulting_status, 'approved')
    assert.equal(store.input?.decision, 'approve')
    assert.equal(store.input?.resultingStatus, 'approved')
    assert.equal(store.input?.primarySessionIdHash.length, 32)
    assert.equal(store.input?.previewTokenHash.length, 32)
    assert.equal(store.input?.claimTokenHash.length, 32)
    assert.equal(store.input?.confirmTokenHash.length, 32)
    assert.match(store.input?.decisionPayloadHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('requires actionable field paths for changes requested', async () => {
    await assert.rejects(
      () => service(new FakeStore()).decideSubmission(command({
        decision: 'changes_requested',
        reasonCode: 'submission_changes_requested',
      })),
      (error: unknown) => (
        typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'REVIEW_DECISION_FIELD_PATHS_REQUIRED'
      ),
    )
  })

  it('maps every allowed decision to its immutable resulting status', async () => {
    for (const [decision, expected] of [
      ['approve', 'approved'],
      ['changes_requested', 'changes_requested'],
      ['reject', 'rejected'],
    ] as const) {
      const store = new FakeStore()
      await service(store).decideReview(command({
        decision,
        reasonCode: `project_update_${expected}`,
        fieldPaths: decision === 'changes_requested' ? ['/project_core/current_name'] : [],
      }))
      assert.equal(store.input?.resultingStatus, expected)
    }
  })

  it('rejects unknown decisions and client-authoritative branch payload fields', async () => {
    await assert.rejects(
      () => service(new FakeStore()).decideSubmission(command({ decision: 'publish' })),
      (error: unknown) => typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'REVIEW_DECISION_SCHEMA_INVALID',
    )
    await assert.rejects(
      () => service(new FakeStore()).decideSubmission(command({ decisionPayload: { project_id: 'x' } })),
      (error: unknown) => typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'REVIEW_DECISION_SCHEMA_INVALID',
    )
  })

  it('normalizes the exact verification approval union for an identity reviewer', async () => {
    const store=new FakeStore()
    await service(store).decideReview(command({
      actor:Object.freeze({...actor,permissions:Object.freeze(['admin:identity_review'])}),
      reasonCode:'verification_approved',
      decisionPayload:{
        author_role:'co_creator',field_permissions:['/project_core/current_name'],
        policy_version:'creator_link.v1',expected_creator_aggregate_version:3,
        expected_owner_link_set_version:1,expected_reused_link_version:null,
        approved_link_role:'manager',approved_permission_profile_ref:{
          profile_id:'MANAGER_V1',profile_version:1,config_hash:'a'.repeat(64),
        },
      },
    }))
    assert.deepEqual(store.input?.decisionPayload,{
      author_role:'co_creator',field_permissions:['/project_core/current_name'],
      policy_version:'creator_link.v1',expected_creator_aggregate_version:3,
      expected_owner_link_set_version:1,expected_reused_link_version:null,
      approved_link_role:'manager',approved_permission_profile_ref:{
        profile_id:'MANAGER_V1',profile_version:1,config_hash:'a'.repeat(64),
      },
    })
  })

  it('rejects verification branch data on non-approve decisions', async () => {
    await assert.rejects(()=>service(new FakeStore()).decideReview(command({
      decision:'reject',reasonCode:'verification_rejected',decisionPayload:{
        author_role:'owner',field_permissions:[],policy_version:'creator_link.v1',
        expected_creator_aggregate_version:null,expected_owner_link_set_version:null,
        expected_reused_link_version:null,
      },
    })),(error:unknown)=>typeof error==='object'&&error!==null&&'code' in error&&
      error.code==='REVIEW_DECISION_SCHEMA_INVALID')
  })

  it('normalizes ownership terminal decisions and binds withdrawal only to withdraw',async()=>{
    for(const [decision,status] of [['uphold','resolved_upheld'],['revoke','resolved_revoked'],['withdraw','withdrawn']] as const){const store=new FakeStore();await service(store).decideReview(command({actor:Object.freeze({...actor,permissions:Object.freeze(['admin:identity_review'])}),decision,reasonCode:`ownership_${decision}`,decisionPayload:{expected_conflict_principal_version:3,withdrawal_request_id:decision==='withdraw'?'70000000-0000-4000-8000-000000000001':null}}));assert.equal(store.input?.resultingStatus,status);assert.deepEqual(store.input?.decisionPayload,{expected_conflict_principal_version:3,withdrawal_request_id:decision==='withdraw'?'70000000-0000-4000-8000-000000000001':null})}
    await assert.rejects(()=>service(new FakeStore()).decideReview(command({decision:'withdraw',decisionPayload:{expected_conflict_principal_version:1,withdrawal_request_id:null}})),/OWNERSHIP_WITHDRAWAL_REQUIRED/)
  })
})
