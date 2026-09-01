import { createHash, createHmac } from 'node:crypto'

import { workflowError } from './errors.js'
import {
  PostgresVerificationRequestStore,
  type ResolutionSelection,
} from './verification-request-store.js'
import {
  creatorResolutionModes,
  type CreateVerificationRequestCommand,
  type CreatorResolutionMode,
  type GetVerificationRequestCommand,
  type NewCreatorProfileInput,
  type PatchVerificationRequestCommand,
  type RequestedLinkRole,
  type SubmitVerificationRequestCommand,
  type SupplementVerificationRequestCommand,
  type VerificationRequestProjection,
  type WithdrawVerificationRequestCommand,
  type ReviewVerificationRequestCommand,
  type VerificationRequestReviewerProjection,
} from './verification-request-types.js'

export interface VerificationRequestStorePort {
  findCreateReplay: PostgresVerificationRequestStore['findCreateReplay']
  getOwned: PostgresVerificationRequestStore['getOwned']
  create: PostgresVerificationRequestStore['create']
  patch: PostgresVerificationRequestStore['patch']
  submit: PostgresVerificationRequestStore['submit']
  withdraw: PostgresVerificationRequestStore['withdraw']
  resolveSelection: PostgresVerificationRequestStore['resolveSelection']
  projection: PostgresVerificationRequestStore['projection']
  getForReviewer: PostgresVerificationRequestStore['getForReviewer']
}

export class VerificationRequestService {
  private readonly now: () => Date
  private readonly authTokenSecret: string | null

  constructor(private readonly store: VerificationRequestStorePort, now?: () => Date,
    reviewConfig?:Readonly<{authTokenSecret:string}>) {
    this.now = now ?? (() => new Date())
    this.authTokenSecret=reviewConfig?.authTokenSecret??null
    if(this.authTokenSecret!==null&&this.authTokenSecret.length<32)throw new Error('VERIFICATION_REVIEW_AUTH_SECRET_INVALID')
  }

  async create(command: CreateVerificationRequestCommand & { readonly requestId?: string }): Promise<VerificationRequestProjection> {
    const userId = uuid(command.userId, 'VERIFICATION_USER_INVALID')
    const projectId = uuid(command.projectId, 'VERIFICATION_PROJECT_INVALID')
    const supersedes = nullableUuid(command.supersedesVerificationId, 'VERIFICATION_SUPERSEDES_INVALID')
    const idempotencyKey = operationId(command.idempotencyKey)
    const mode = resolutionMode(command.creatorResolutionMode)
    const selectionInput = this.selectionInput(command, userId, mode)
    const requestHash = hashJson({ project_id: projectId, supersedes_verification_id: supersedes, ...selectionInput })
    const replay = await this.store.findCreateReplay(userId, idempotencyKey)
    if (replay) {
      if (replay.request_hash !== requestHash) throw workflowError('VERIFICATION_IDEMPOTENCY_KEY_REUSED', 409)
      const policy = (await this.resolveStored(replay)).provisionalPolicy
      return this.store.projection(replay, policy)
    }
    const selection = await this.store.resolveSelection(selectionInput)
    const row = await this.store.create({
      userId, projectId, supersedesVerificationId: supersedes, selection,
      idempotencyKey, requestHash, now: this.now(), requestId: command.requestId ?? idempotencyKey,
    })
    return this.store.projection(row, selection.provisionalPolicy)
  }

  async get(command: GetVerificationRequestCommand): Promise<VerificationRequestProjection> {
    const userId = uuid(command.userId, 'VERIFICATION_USER_INVALID')
    const row = await this.store.getOwned(userId, uuid(command.verificationId, 'VERIFICATION_ID_INVALID'))
    if (!row) throw workflowError('VERIFICATION_REQUEST_NOT_FOUND', 404)
    const policy = row.status==='draft' || row.status==='changes_requested'
      ? (await this.resolveStored(row)).provisionalPolicy
      : null
    return this.store.projection(row, policy)
  }

  async getForReviewer(command:ReviewVerificationRequestCommand):Promise<VerificationRequestReviewerProjection>{
    if(!this.authTokenSecret)throw workflowError('VERIFICATION_REVIEW_UNAVAILABLE',503,true)
    const reviewerUserId=uuid(command.reviewerUserId,'VERIFICATION_REVIEWER_INVALID')
    if(!Array.isArray(command.roles)||!Array.isArray(command.permissions)||
      (!command.roles.includes('admin')&&!command.permissions.includes('admin:identity_review'))){
      throw workflowError('WORK_ITEM_FORBIDDEN',403)
    }
    if(typeof command.sessionToken!=='string'||command.sessionToken.length<32||command.sessionToken.length>128){
      throw workflowError('SESSION_INVALID',401)
    }
    if(typeof command.claimToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(command.claimToken)){
      throw workflowError('WORK_ITEM_CLAIM_FORBIDDEN',403)
    }
    return this.store.getForReviewer({reviewerUserId,
      primarySessionIdHash:createHmac('sha256',this.authTokenSecret).update(command.sessionToken).digest(),
      verificationId:uuid(command.verificationId,'VERIFICATION_ID_INVALID'),
      claimTokenHash:createHash('sha256').update(command.claimToken).digest(),now:this.now()})
  }

  async patch(command: PatchVerificationRequestCommand & { readonly requestId?: string }): Promise<VerificationRequestProjection> {
    const userId = uuid(command.userId, 'VERIFICATION_USER_INVALID')
    const verificationId = uuid(command.verificationId, 'VERIFICATION_ID_INVALID')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw workflowError('VERIFICATION_VERSION_INVALID', 422)
    }
    const owned = await this.store.getOwned(userId, verificationId)
    if (!owned) throw workflowError('VERIFICATION_REQUEST_NOT_FOUND', 404)
    if (owned.status !== 'draft' && owned.status !== 'changes_requested') {
      throw workflowError('VERIFICATION_REQUEST_NOT_EDITABLE', 409)
    }
    const operation = operationId(command.operationId)
    const mode = resolutionMode(command.creatorResolutionMode)
    const selection = await this.store.resolveSelection(this.selectionInput(command, userId, mode))
    const method = optionalText(command.method, 64, 1, 'VERIFICATION_METHOD_INVALID')
    const publicSummary = optionalText(command.publicSummary, 1000, 10, 'VERIFICATION_PUBLIC_SUMMARY_INVALID')
    const requestHash = hashJson({
      expected_version: command.expectedVersion,
      creator_resolution_mode: selection.mode,
      creator_account_link_id: selection.creatorAccountLinkId,
      target_creator_id: selection.targetCreatorId,
      new_creator_profile_input: selection.newCreatorProfileInput,
      requested_link_role: selection.requestedLinkRole,
      method,
      public_summary: publicSummary,
    })
    const row = await this.store.patch({
      userId, verificationId, expectedVersion: command.expectedVersion, selection,
      method, publicSummary, operationId: operation, requestHash, now: this.now(),
      requestId: command.requestId ?? operation,
    })
    return this.store.projection(row, selection.provisionalPolicy)
  }

  async submit(command: SubmitVerificationRequestCommand): Promise<VerificationRequestProjection> {
    return this.submitRevision({ ...command, evidenceRefs: [], operationId: command.submissionKey, operationType: 'submit' })
  }

  async supplement(command: SupplementVerificationRequestCommand): Promise<VerificationRequestProjection> {
    return this.submitRevision({ ...command, operationType: 'supplement' })
  }

  async withdraw(command: WithdrawVerificationRequestCommand): Promise<VerificationRequestProjection> {
    const userId = uuid(command.userId,'VERIFICATION_USER_INVALID')
    const verificationId = uuid(command.verificationId,'VERIFICATION_ID_INVALID')
    const expectedVersion = version(command.expectedVersion)
    const operation = operationId(command.operationId)
    const reasonCode = command.reasonCode===null ? 'applicant_withdrawn' : safeKey(command.reasonCode,'VERIFICATION_REASON_INVALID')
    const requestHash = hashJson({ expected_version: expectedVersion,reason_code: reasonCode })
    const row = await this.store.withdraw({
      userId,verificationId,expectedVersion,operationId: operation,requestHash,reasonCode,
      now: this.now(),requestId: command.requestId ?? operation,
    })
    return this.store.projection(row,null)
  }

  private async submitRevision(command: Readonly<{
    userId: string
    verificationId: string
    expectedVersion: number
    materialIds: readonly string[]
    evidenceRefs: readonly string[]
    operationId: string
    operationType: 'submit' | 'supplement'
    requestId?: string
  }>): Promise<VerificationRequestProjection> {
    const userId = uuid(command.userId,'VERIFICATION_USER_INVALID')
    const verificationId = uuid(command.verificationId,'VERIFICATION_ID_INVALID')
    const expectedVersion = version(command.expectedVersion)
    const materialIds = uuidList(command.materialIds,1,5,'VERIFICATION_MATERIAL_IDS_INVALID')
    const evidenceRefs = uuidList(command.evidenceRefs,0,50,'VERIFICATION_EVIDENCE_REFS_INVALID')
    const operation = operationId(command.operationId)
    const row = await this.store.getOwned(userId,verificationId)
    if (!row) throw workflowError('VERIFICATION_REQUEST_NOT_FOUND',404)
    const selection = await this.resolveStored(row)
    const requestHash = hashJson({
      expected_version: expectedVersion,material_ids: materialIds,evidence_refs: evidenceRefs,
      creator_resolution_mode: selection.mode,creator_account_link_id: selection.creatorAccountLinkId,
      target_creator_id: selection.targetCreatorId,requested_link_role: selection.requestedLinkRole,
    })
    const updated = await this.store.submit({
      userId,verificationId,expectedVersion,materialIds,evidenceRefs,operationId: operation,
      operationType: command.operationType,requestHash,selection,now: this.now(),
      requestId: command.requestId ?? operation,
    })
    return this.store.projection(updated,null)
  }

  private selectionInput(
    command: Pick<CreateVerificationRequestCommand, 'creatorAccountLinkId' | 'targetCreatorId' | 'newCreatorProfileInput' | 'requestedLinkRole'>,
    userId: string,
    mode: CreatorResolutionMode,
  ) {
    return Object.freeze({
      userId,
      mode,
      creatorAccountLinkId: nullableUuid(command.creatorAccountLinkId, 'CREATOR_ACCOUNT_LINK_ID_INVALID'),
      targetCreatorId: nullableUuid(command.targetCreatorId, 'TARGET_CREATOR_ID_INVALID'),
      newCreatorProfileInput: profileInput(command.newCreatorProfileInput),
      requestedLinkRole: linkRole(command.requestedLinkRole),
    })
  }

  private resolveStored(row: Awaited<ReturnType<VerificationRequestStorePort['getOwned']>> & object): Promise<ResolutionSelection> {
    return this.store.resolveSelection({
      userId: row.applicant_user_id,
      mode: row.creator_resolution_mode,
      creatorAccountLinkId: row.creator_account_link_id,
      targetCreatorId: row.target_creator_id,
      newCreatorProfileInput: row.new_creator_profile_input_json as NewCreatorProfileInput | null,
      requestedLinkRole: row.requested_link_role,
    })
  }
}

function resolutionMode(value: string): CreatorResolutionMode {
  if (!creatorResolutionModes.includes(value as CreatorResolutionMode)) {
    throw workflowError('VERIFICATION_RESOLUTION_MODE_INVALID', 422)
  }
  return value as CreatorResolutionMode
}

function profileInput(value: unknown): NewCreatorProfileInput | null {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw workflowError('NEW_CREATOR_PROFILE_INVALID', 422)
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.some((key) => !['display_name','bio'].includes(key)) || typeof input.display_name !== 'string') {
    throw workflowError('NEW_CREATOR_PROFILE_INVALID', 422)
  }
  const displayName = input.display_name.trim()
  const bio = input.bio
  if (displayName.length < 1 || displayName.length > 80 || (bio !== undefined && (typeof bio !== 'string' || bio.length > 1000))) {
    throw workflowError('NEW_CREATOR_PROFILE_INVALID', 422)
  }
  return Object.freeze({ display_name: displayName, ...(bio === undefined ? {} : { bio: bio.trim() }) })
}

function linkRole(value: string | null): RequestedLinkRole | null {
  if (value === null) return null
  if (value !== 'owner' && value !== 'manager') throw workflowError('VERIFICATION_LINK_ROLE_INVALID', 422)
  return value
}

function uuid(value: string, code: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw workflowError(code, 422)
  }
  return value.toLowerCase()
}

function nullableUuid(value: string | null, code: string): string | null {
  return value === null ? null : uuid(value, code)
}

function operationId(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw workflowError('VERIFICATION_IDEMPOTENCY_KEY_INVALID', 422)
  }
  return value
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value<1) throw workflowError('VERIFICATION_VERSION_INVALID',422)
  return value
}

function uuidList(value: readonly string[], minimum: number, maximum: number, code: string): readonly string[] {
  if (!Array.isArray(value) || value.length<minimum || value.length>maximum) throw workflowError(code,422)
  const normalized = value.map((item) => uuid(item,code))
  if (new Set(normalized).size!==normalized.length) throw workflowError(code,422)
  return Object.freeze([...normalized])
}

function safeKey(value: string, code: string): string {
  if (typeof value!=='string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw workflowError(code,422)
  return value
}

function optionalText(value: string | null, maximum: number, minimum: number, code: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw workflowError(code, 422)
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) throw workflowError(code, 422)
  return normalized
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
