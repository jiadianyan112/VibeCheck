import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { OwnershipCaseStore } from './ownership-case-store.js'
import { OwnershipCaseService } from './ownership-case-service.js'
import type { OwnershipMutationProjection } from './ownership-case-types.js'

const actor={userId:'10000000-0000-4000-8000-000000000001',roles:['admin'] as const,permissions:[] as const}
const projection:OwnershipMutationProjection=Object.freeze({case_id:'20000000-0000-4000-8000-000000000001',status:'open',review_work_item_id:'30000000-0000-4000-8000-000000000001',work_item_status:'queued',resulting_author_relation_status:'suspended',resulting_project_status:'published_platform',conflict_principal_version:1,version:1})

class Store implements OwnershipCaseStore {
  createInput:Parameters<OwnershipCaseStore['create']>[0]|null=null
  reviewerHash:Buffer|null=null
  async create(input:Parameters<OwnershipCaseStore['create']>[0]){this.createInput=input;return projection}
  getParty():ReturnType<OwnershipCaseStore['getParty']>{return Promise.reject(new Error('unused'))}
  async getReviewer(input:Parameters<OwnershipCaseStore['getReviewer']>[0]){this.reviewerHash=input.claimTokenHash;return {viewer_schema:'reviewer' as const,case_id:projection.case_id,project_id:'40000000-0000-4000-8000-000000000001',author_relation_id:'50000000-0000-4000-8000-000000000001',opened_by_user_id:actor.userId,reason_code:'claim_conflict',status:'investigating' as const,evidence_submissions:[],withdrawal_requests:[],review_work_item_summary:{work_item_id:projection.review_work_item_id,status:'claimed' as const,version:2},conflict_principal_version:1,allowed_actions:['preview' as const],version:2,created_at:new Date(0).toISOString(),updated_at:new Date(1).toISOString()}}
  async addEvidence(){return projection}
  async requestWithdrawal(){return projection}
  async rejectWithdrawal(){return projection}
}

describe('OwnershipCaseService',()=>{
  it('normalizes create input and keeps actor identity server authoritative',async()=>{const store=new Store();const service=new OwnershipCaseService(store,'s'.repeat(32),()=>new Date('2026-08-20T00:00:00Z'));await service.create({actor,authorRelationId:'50000000-0000-4000-8000-000000000001',appealedUserId:null,reasonCode:'claim_conflict',evidenceIds:['60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001'],clientRequestId:'ownership-create-1',requestId:'request-ownership-1'});assert.deepEqual(store.createInput?.evidenceIds,['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002']);assert.equal(store.createInput?.actor.userId,actor.userId)})
  it('rejects duplicate evidence before persistence',()=>{const service=new OwnershipCaseService(new Store(),'s'.repeat(32));assert.throws(()=>service.create({actor,authorRelationId:'50000000-0000-4000-8000-000000000001',appealedUserId:null,reasonCode:'claim_conflict',evidenceIds:['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001'],clientRequestId:'ownership-create-1',requestId:'request-ownership-1'}),/EVIDENCE_IDS_DUPLICATE/)})
  it('hashes reviewer claim tokens and rejects non identity reviewers',async()=>{const store=new Store();const service=new OwnershipCaseService(store,'s'.repeat(32));await service.getReviewer({actor,caseId:projection.case_id,claimToken:'a'.repeat(43)});assert.equal(store.reviewerHash?.length,32);assert.throws(()=>service.getReviewer({actor:{...actor,roles:['editor'],permissions:[]},caseId:projection.case_id,claimToken:'a'.repeat(43)}),/WORK_ITEM_FORBIDDEN/)})
})
