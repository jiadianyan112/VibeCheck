import { createHmac } from 'node:crypto'

import { workflowError } from './errors.js'
import type { OwnershipCaseStore } from './ownership-case-store.js'
import type {
  AddOwnershipEvidenceCommand,
  CreateOwnershipCaseCommand,
  GetOwnershipPartyCaseCommand,
  GetOwnershipReviewerCaseCommand,
  OwnershipMutationProjection,
  OwnershipPartyCaseProjection,
  OwnershipReviewerCaseProjection,
  RejectOwnershipWithdrawalCommand,
  RequestOwnershipWithdrawalCommand,
} from './ownership-case-types.js'
import type { ReviewActor } from './types.js'

export class OwnershipCaseService {
  constructor(
    private readonly store: OwnershipCaseStore,
    private readonly tokenSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (tokenSecret.length < 32) throw new Error('OWNERSHIP_TOKEN_SECRET_INVALID')
  }

  create(command: CreateOwnershipCaseCommand): Promise<OwnershipMutationProjection> {
    const actor = this.actor(command.actor)
    if (!actor.roles.includes('admin') && !actor.roles.includes('editor')) {
      throw workflowError('OWNERSHIP_CASE_CREATE_FORBIDDEN',403)
    }
    return this.store.create({...command,actor,
      authorRelationId:this.uuid(command.authorRelationId,'AUTHOR_RELATION_ID_INVALID'),
      appealedUserId:command.appealedUserId===null?null:this.uuid(command.appealedUserId,'APPEALED_USER_ID_INVALID'),
      reasonCode:this.reason(command.reasonCode),evidenceIds:this.ids(command.evidenceIds),
      clientRequestId:this.request(command.clientRequestId),requestId:this.request(command.requestId),now:this.now()})
  }

  getParty(command: GetOwnershipPartyCaseCommand): Promise<OwnershipPartyCaseProjection> {
    return this.store.getParty({userId:this.uuid(command.userId,'USER_ID_INVALID'),
      caseId:this.uuid(command.caseId,'OWNERSHIP_CASE_ID_INVALID')})
  }

  getReviewer(command: GetOwnershipReviewerCaseCommand): Promise<OwnershipReviewerCaseProjection> {
    const actor=this.actor(command.actor); this.identityReviewer(actor)
    return this.store.getReviewer({actorUserId:actor.userId,
      caseId:this.uuid(command.caseId,'OWNERSHIP_CASE_ID_INVALID'),
      claimTokenHash:this.token(command.claimToken),now:this.now()})
  }

  addEvidence(command: AddOwnershipEvidenceCommand): Promise<OwnershipMutationProjection> {
    const actor=this.actor(command.actor)
    return this.store.addEvidence({...command,actor,
      caseId:this.uuid(command.caseId,'OWNERSHIP_CASE_ID_INVALID'),
      expectedCaseVersion:this.version(command.expectedCaseVersion),evidenceIds:this.ids(command.evidenceIds,true),
      reasonCode:this.reason(command.reasonCode),clientRequestId:this.request(command.clientRequestId),
      requestId:this.request(command.requestId),now:this.now()})
  }

  requestWithdrawal(command: RequestOwnershipWithdrawalCommand): Promise<OwnershipMutationProjection> {
    const actor=this.actor(command.actor)
    return this.store.requestWithdrawal({...command,actor,
      caseId:this.uuid(command.caseId,'OWNERSHIP_CASE_ID_INVALID'),expectedVersion:this.version(command.expectedVersion),
      reasonCode:this.reason(command.reasonCode),evidenceIds:this.ids(command.evidenceIds),
      supersedesRequestId:command.supersedesRequestId===null?null:this.uuid(command.supersedesRequestId,'WITHDRAWAL_REQUEST_ID_INVALID'),
      clientRequestId:this.request(command.clientRequestId),requestId:this.request(command.requestId),now:this.now()})
  }

  rejectWithdrawal(command: RejectOwnershipWithdrawalCommand): Promise<OwnershipMutationProjection> {
    const actor=this.actor(command.actor); this.identityReviewer(actor)
    return this.store.rejectWithdrawal({...command,actor,
      caseId:this.uuid(command.caseId,'OWNERSHIP_CASE_ID_INVALID'),
      withdrawalRequestId:this.uuid(command.withdrawalRequestId,'WITHDRAWAL_REQUEST_ID_INVALID'),
      decisionId:this.uuid(command.decisionId,'WITHDRAWAL_DECISION_ID_INVALID'),
      expectedCaseVersion:this.version(command.expectedCaseVersion),
      expectedRequestVersion:this.version(command.expectedRequestVersion),
      reasonCode:this.reason(command.reasonCode),requestId:this.request(command.requestId),
      claimTokenHash:this.token(command.claimToken),now:this.now()})
  }

  private identityReviewer(actor:ReviewActor):void {
    if (!actor.roles.includes('admin')&&!actor.permissions.includes('admin:identity_review')) {
      throw workflowError('WORK_ITEM_FORBIDDEN',403)
    }
  }
  private actor(actor:ReviewActor):ReviewActor { return Object.freeze({userId:this.uuid(actor.userId,'ACTOR_USER_ID_INVALID'),roles:Object.freeze([...actor.roles]),permissions:Object.freeze([...actor.permissions])}) }
  private uuid(v:string,c:string):string { if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw workflowError(c,422);return v.toLowerCase() }
  private version(v:number):number { if(!Number.isSafeInteger(v)||v<1)throw workflowError('EXPECTED_VERSION_INVALID',422);return v }
  private reason(v:string):string { if(!/^[a-z][a-z0-9_]{0,63}$/.test(v))throw workflowError('REASON_CODE_INVALID',422);return v }
  private request(v:string):string { if(!/^[A-Za-z0-9_-]{8,128}$/.test(v))throw workflowError('REQUEST_ID_INVALID',422);return v }
  private ids(v:readonly string[],required=false):readonly string[] { if(!Array.isArray(v)||(required&&v.length===0)||v.length>20)throw workflowError('EVIDENCE_IDS_INVALID',422);const n=[...new Set(v.map(x=>this.uuid(x,'EVIDENCE_ID_INVALID')))].sort();if(n.length!==v.length)throw workflowError('EVIDENCE_IDS_DUPLICATE',422);return Object.freeze(n) }
  private token(v:string):Buffer { if(!/^[A-Za-z0-9_-]{43}$/.test(v))throw workflowError('CLAIM_TOKEN_INVALID',403);return createHmac('sha256',this.tokenSecret).update(v).digest() }
}
