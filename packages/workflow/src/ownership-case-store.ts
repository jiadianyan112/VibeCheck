import type {
  AddOwnershipEvidenceCommand,
  CreateOwnershipCaseCommand,
  GetOwnershipPartyCaseCommand,
  OwnershipMutationProjection,
  OwnershipPartyCaseProjection,
  OwnershipReviewerCaseProjection,
  RejectOwnershipWithdrawalCommand,
  RequestOwnershipWithdrawalCommand,
} from './ownership-case-types.js'

export interface OwnershipCaseStore {
  create(input: CreateOwnershipCaseCommand & { readonly now: Date }): Promise<OwnershipMutationProjection>
  getParty(input: GetOwnershipPartyCaseCommand): Promise<OwnershipPartyCaseProjection>
  getReviewer(input: Readonly<{
    actorUserId: string
    caseId: string
    claimTokenHash: Buffer
    now: Date
  }>): Promise<OwnershipReviewerCaseProjection>
  addEvidence(input: AddOwnershipEvidenceCommand & { readonly now: Date }): Promise<OwnershipMutationProjection>
  requestWithdrawal(input: RequestOwnershipWithdrawalCommand & { readonly now: Date }): Promise<OwnershipMutationProjection>
  rejectWithdrawal(input: Omit<RejectOwnershipWithdrawalCommand,'claimToken'> & {
    readonly claimTokenHash: Buffer
    readonly now: Date
  }): Promise<OwnershipMutationProjection>
}
