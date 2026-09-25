import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { workflowError } from './errors.js'
import type { ReviewQueueAnchor, WorkflowStore } from './store-port.js'
import {
  reviewTargetTypes,
  reviewWorkItemStatuses,
  reviewWorkTypes,
  type ClaimReviewWorkItemCommand,
  type HeartbeatReviewWorkItemCommand,
  type ListReviewWorkItemsCommand,
  type ReleaseReviewWorkItemCommand,
  type ReviewActor,
  type ReviewClaimProjection,
  type ReviewTargetType,
  type ReviewWorkItemPage,
  type ReviewWorkItemStatus,
  type ReviewWorkType,
} from './types.js'

export interface WorkflowServiceConfig {
  readonly cursorSecret: string
  readonly leaseSeconds: number
  readonly maximumClaimSeconds: number
  readonly queuePageSize: number
}

interface CursorPayload {
  readonly v: 1
  readonly work_type: ReviewWorkType
  readonly target_type: ReviewTargetType | null
  readonly status: ReviewWorkItemStatus
  readonly created_at: string
  readonly work_item_id: string
}

const identityWorkTypes = new Set<ReviewWorkType>(['verification', 'ownership_case'])

export class WorkflowService {
  constructor(
    private readonly store: WorkflowStore,
    private readonly config: WorkflowServiceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (config.cursorSecret.length < 32) throw new Error('WORKFLOW_CURSOR_SECRET_INVALID')
    if (config.leaseSeconds !== 60) throw new Error('WORKFLOW_LEASE_SECONDS_INVALID')
    if (config.maximumClaimSeconds < config.leaseSeconds || config.maximumClaimSeconds > 86_400) {
      throw new Error('WORKFLOW_MAXIMUM_CLAIM_SECONDS_INVALID')
    }
    if (config.queuePageSize < 1 || config.queuePageSize > 50) {
      throw new Error('WORKFLOW_QUEUE_PAGE_SIZE_INVALID')
    }
  }

  async listWorkItems(command: ListReviewWorkItemsCommand): Promise<ReviewWorkItemPage> {
    const actor = this.actor(command.actor)
    const workType = this.workType(command.workType)
    const targetType = command.targetType === null ? null : this.targetType(command.targetType)
    const status = command.status === null ? 'queued' : this.status(command.status)
    this.authorize(actor, workType)
    const anchor = command.cursor === null
      ? null
      : this.decodeCursor(command.cursor, workType, targetType, status)
    const stored = await this.store.listWorkItems({
      actorUserId: actor.userId,
      workType,
      targetType,
      status,
      anchor,
      limit: this.config.queuePageSize,
    })
    return Object.freeze({
      items: Object.freeze([...stored.items]),
      total_count: stored.totalCount,
      next_cursor: stored.nextAnchor === null
        ? null
        : this.encodeCursor(workType, targetType, status, stored.nextAnchor),
    })
  }

  async claimWorkItem(command: ClaimReviewWorkItemCommand): Promise<ReviewClaimProjection> {
    const actor = this.actor(command.actor)
    const workItemId = this.uuid(command.workItemId, 'WORK_ITEM_ID_INVALID')
    this.version(command.expectedVersion)
    if (
      command.expectedConflictPrincipalVersion !== null &&
      (!Number.isSafeInteger(command.expectedConflictPrincipalVersion) ||
        command.expectedConflictPrincipalVersion < 1)
    ) throw workflowError('EXPECTED_CONFLICT_PRINCIPAL_VERSION_INVALID', 422)

    // Authorization is repeated by the store after it locks and reads the work type.
    const claimToken = randomBytes(32).toString('base64url')
    const projection = await this.store.claimWorkItem({
      actor,
      workItemId,
      expectedVersion: command.expectedVersion,
      expectedConflictPrincipalVersion: command.expectedConflictPrincipalVersion,
      claimTokenHash: this.tokenHash(claimToken),
      leaseSeconds: this.config.leaseSeconds,
      now: this.now(),
      requestId: this.requestId(command.requestId),
    })
    this.authorize(actor, projection.work_type)
    return Object.freeze({ ...projection, claim_token: claimToken })
  }

  async heartbeatWorkItem(
    command: HeartbeatReviewWorkItemCommand,
  ): Promise<import('./types.js').ReviewWorkItemProjection> {
    const actor = this.actor(command.actor)
    return this.store.heartbeatWorkItem({
      actor,
      workItemId: this.uuid(command.workItemId, 'WORK_ITEM_ID_INVALID'),
      claimTokenHash: this.tokenHash(this.claimToken(command.claimToken)),
      leaseSeconds: this.config.leaseSeconds,
      maximumClaimSeconds: this.config.maximumClaimSeconds,
      now: this.now(),
      requestId: this.requestId(command.requestId),
    })
  }

  async releaseWorkItem(
    command: ReleaseReviewWorkItemCommand,
  ): Promise<import('./types.js').ReviewWorkItemProjection> {
    const actor = this.actor(command.actor)
    const workItemId = this.uuid(command.workItemId, 'WORK_ITEM_ID_INVALID')
    const claimToken = this.claimToken(command.claimToken)
    const reasonCode = this.reasonCode(command.reasonCode)
    return this.store.releaseWorkItem({
      actor,
      workItemId,
      claimTokenHash: this.tokenHash(claimToken),
      requestHash: this.hash(JSON.stringify({ work_item_id: workItemId, reason_code: reasonCode })),
      reasonCode,
      allowAdminOverride: actor.roles.includes('admin'),
      now: this.now(),
      requestId: this.requestId(command.requestId),
    })
  }

  private authorize(actor: ReviewActor, workType: ReviewWorkType): void {
    if (workType === 'creator_profile') {
      if (!actor.roles.includes('admin')) throw workflowError('WORK_ITEM_FORBIDDEN', 403)
      return
    }
    if (actor.roles.includes('admin')) return
    const required = identityWorkTypes.has(workType) ? 'admin:identity_review' : 'admin:review'
    if (!actor.permissions.includes(required)) throw workflowError('WORK_ITEM_FORBIDDEN', 403)
  }

  private actor(value: ReviewActor): ReviewActor {
    const userId = this.uuid(value.userId, 'ACTOR_USER_ID_INVALID')
    if (!Array.isArray(value.roles) || !Array.isArray(value.permissions)) {
      throw workflowError('ACTOR_CONTEXT_INVALID', 403)
    }
    return Object.freeze({
      userId,
      roles: Object.freeze([...value.roles]),
      permissions: Object.freeze([...value.permissions]),
    })
  }

  private workType(value: string): ReviewWorkType {
    if (!(reviewWorkTypes as readonly string[]).includes(value)) {
      throw workflowError('WORK_TYPE_INVALID', 422)
    }
    return value as ReviewWorkType
  }

  private targetType(value: string): ReviewTargetType {
    if (!(reviewTargetTypes as readonly string[]).includes(value)) {
      throw workflowError('TARGET_TYPE_INVALID', 422)
    }
    return value as ReviewTargetType
  }

  private status(value: string): ReviewWorkItemStatus {
    if (!(reviewWorkItemStatuses as readonly string[]).includes(value)) {
      throw workflowError('WORK_ITEM_STATUS_INVALID', 422)
    }
    return value as ReviewWorkItemStatus
  }

  private version(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw workflowError('EXPECTED_VERSION_INVALID', 422)
    return value
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw workflowError(code, 422)
    }
    return value.toLowerCase()
  }

  private claimToken(value: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw workflowError('CLAIM_TOKEN_INVALID', 403)
    return value
  }

  private reasonCode(value: string): string {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw workflowError('REASON_CODE_INVALID', 422)
    return value
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw workflowError('REQUEST_ID_INVALID', 422)
    return value
  }

  private tokenHash(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest()
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }

  private encodeCursor(
    workType: ReviewWorkType,
    targetType: ReviewTargetType | null,
    status: ReviewWorkItemStatus,
    anchor: ReviewQueueAnchor,
  ): string {
    const payload: CursorPayload = {
      v: 1,
      work_type: workType,
      target_type: targetType,
      status,
      created_at: anchor.createdAt.toISOString(),
      work_item_id: anchor.workItemId,
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signature = createHmac('sha256', this.config.cursorSecret)
      .update(encoded, 'utf8')
      .digest('base64url')
    return `${encoded}.${signature}`
  }

  private decodeCursor(
    cursor: string,
    workType: ReviewWorkType,
    targetType: ReviewTargetType | null,
    status: ReviewWorkItemStatus,
  ): ReviewQueueAnchor {
    if (cursor.length > 2_048) throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    const [encoded, supplied, extra] = cursor.split('.')
    if (!encoded || !supplied || extra !== undefined) throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    const expected = createHmac('sha256', this.config.cursorSecret)
      .update(encoded, 'utf8')
      .digest('base64url')
    const left = Buffer.from(supplied, 'utf8')
    const right = Buffer.from(expected, 'utf8')
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    }
    let value: unknown
    try {
      value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    }
    const payload = value as Partial<CursorPayload>
    if (
      payload.v !== 1 || payload.work_type !== workType ||
      payload.target_type !== targetType || payload.status !== status ||
      typeof payload.created_at !== 'string' || typeof payload.work_item_id !== 'string'
    ) throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    const createdAt = new Date(payload.created_at)
    if (!Number.isFinite(createdAt.getTime())) throw workflowError('WORK_ITEM_CURSOR_INVALID', 422)
    return Object.freeze({
      createdAt,
      workItemId: this.uuid(payload.work_item_id, 'WORK_ITEM_CURSOR_INVALID'),
    })
  }
}
