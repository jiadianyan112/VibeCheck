import { createHash, createHmac } from 'node:crypto'

import { workflowError } from './errors.js'
import type { ReviewDecisionStore } from './review-decision-store.js'
import {
  submissionReviewDecisions,
  type DecideSubmissionReviewCommand,
  type ReviewDecisionProjection,
  type SubmissionReviewDecision,
} from './review-decision-types.js'
import type { ReviewActor } from './types.js'

export interface ReviewDecisionServiceConfig {
  readonly tokenSecret: string
  readonly authTokenSecret: string
}

export class ReviewDecisionService {
  constructor(
    private readonly store: ReviewDecisionStore,
    private readonly config: ReviewDecisionServiceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (config.tokenSecret.length < 32 || config.authTokenSecret.length < 32) {
      throw new Error('REVIEW_DECISION_TOKEN_SECRET_INVALID')
    }
  }

  async decideSubmission(
    command: DecideSubmissionReviewCommand,
  ): Promise<ReviewDecisionProjection> {
    const actor = this.actor(command.actor)
    const decision = this.decision(command.decision)
    const resultingStatus = decision === 'approve'
      ? 'approved'
      : decision === 'reject'
        ? 'rejected'
        : 'changes_requested'
    const fieldPaths = this.fieldPaths(command.fieldPaths)
    if (decision === 'changes_requested' && fieldPaths.length === 0) {
      throw workflowError('REVIEW_DECISION_FIELD_PATHS_REQUIRED', 422)
    }
    const evidenceRefs = this.uuidList(command.decisionEvidenceRefs, 'DECISION_EVIDENCE_REFS_INVALID')
    const decisionPayload = this.emptyPayload(command.decisionPayload)
    const workItemId = this.uuid(command.workItemId, 'WORK_ITEM_ID_INVALID')
    const expectedVersion = this.version(command.expectedVersion)
    const reasonCode = this.safeKey(command.reasonCode, 'REASON_CODE_INVALID')
    const decisionRequestId = this.requestId(command.decisionRequestId, 'DECISION_REQUEST_ID_INVALID')
    const decisionPayloadHash = this.hash(this.canonicalJson({
      decision,
      decision_evidence_refs: evidenceRefs,
      decision_payload: decisionPayload,
      expected_version: expectedVersion,
      field_paths: fieldPaths,
      reason_code: reasonCode,
      work_item_id: workItemId,
    }))
    return this.store.decideSubmission({
      actor,
      primarySessionIdHash: this.authHash(this.sessionToken(command.sessionToken)),
      workItemId,
      previewTokenHash: this.authHash(this.opaqueToken(command.previewToken, 'PREVIEW_TOKEN_INVALID')),
      claimTokenHash: this.hashBuffer(this.opaqueToken(command.claimToken, 'CLAIM_TOKEN_INVALID')),
      confirmTokenHash: this.tokenHash(this.opaqueToken(command.confirmToken, 'CONFIRM_TOKEN_INVALID')),
      decision,
      resultingStatus,
      reasonCode,
      fieldPaths,
      decisionEvidenceRefs: evidenceRefs,
      expectedVersion,
      decisionRequestId,
      decisionPayload,
      decisionPayloadHash,
      now: this.now(),
      requestId: this.requestId(command.requestId, 'REQUEST_ID_INVALID'),
    })
  }

  private actor(value: ReviewActor): ReviewActor {
    const userId = this.uuid(value.userId, 'ACTOR_USER_ID_INVALID')
    if (!Array.isArray(value.roles) || !Array.isArray(value.permissions)) {
      throw workflowError('ACTOR_CONTEXT_INVALID', 403)
    }
    if (!value.roles.includes('admin') && !value.roles.includes('editor')) {
      throw workflowError('WORK_ITEM_FORBIDDEN', 403)
    }
    if (!value.roles.includes('admin') && !value.permissions.includes('admin:review')) {
      throw workflowError('WORK_ITEM_FORBIDDEN', 403)
    }
    return Object.freeze({
      userId,
      roles: Object.freeze([...new Set(value.roles)].sort()),
      permissions: Object.freeze([...new Set(value.permissions)].sort()),
    })
  }

  private decision(value: string): SubmissionReviewDecision {
    if (!(submissionReviewDecisions as readonly string[]).includes(value)) {
      throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
    }
    return value as SubmissionReviewDecision
  }

  private fieldPaths(value: readonly string[]): readonly string[] {
    if (!Array.isArray(value) || value.length > 50) {
      throw workflowError('REVIEW_DECISION_FIELD_PATHS_INVALID', 422)
    }
    const normalized = value.map((item) => {
      if (typeof item !== 'string' || item.length < 1 || item.length > 512 || item[0] !== '/') {
        throw workflowError('REVIEW_DECISION_FIELD_PATHS_INVALID', 422)
      }
      return item
    })
    if (new Set(normalized).size !== normalized.length) {
      throw workflowError('REVIEW_DECISION_FIELD_PATHS_INVALID', 422)
    }
    return Object.freeze([...normalized].sort())
  }

  private uuidList(value: readonly string[], code: string): readonly string[] {
    if (!Array.isArray(value) || value.length > 50) throw workflowError(code, 422)
    const normalized = value.map((item) => this.uuid(item, code))
    if (new Set(normalized).size !== normalized.length) throw workflowError(code, 422)
    return Object.freeze([...normalized].sort())
  }

  private emptyPayload(value: unknown): Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
    }
    if (Object.keys(value).length !== 0) throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
    return Object.freeze({})
  }

  private canonicalJson(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
      return JSON.stringify(value)
    }
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`
    if (typeof value !== 'object') throw workflowError('REVIEW_DECISION_SCHEMA_INVALID', 422)
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`
    )).join(',')}}`
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw workflowError(code, 422)
    }
    return value.toLowerCase()
  }

  private safeKey(value: string, code: string): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
      throw workflowError(code, 422)
    }
    return value
  }

  private version(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw workflowError('EXPECTED_VERSION_INVALID', 422)
    return value
  }

  private requestId(value: string, code: string): string {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw workflowError(code, 422)
    return value
  }

  private sessionToken(value: string): string {
    if (typeof value !== 'string' || value.length < 32 || value.length > 128) {
      throw workflowError('SESSION_INVALID', 401)
    }
    return value
  }

  private opaqueToken(value: string, code: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw workflowError(code, 403)
    return value
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }

  private hashBuffer(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest()
  }

  private authHash(value: string): Buffer {
    return createHmac('sha256', this.config.authTokenSecret).update(value, 'utf8').digest()
  }

  private tokenHash(value: string): Buffer {
    return createHmac('sha256', this.config.tokenSecret).update(value, 'utf8').digest()
  }
}
