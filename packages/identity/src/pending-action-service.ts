import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import type { IdentityConfig } from '@vibecheck/config'

import { decryptText, encryptText, keyedHash } from './crypto.js'
import { identityError } from './errors.js'
import { normalizeReturnTo } from './normalize.js'
import type {
  AccessPendingActionStoreInput,
  PendingActionStore,
  PendingActionStoreOwner,
} from './pending-action-store.js'
import {
  pendingActionTypes,
  type CancelPendingActionCommand,
  type CompletePendingActionExecutionCommand,
  type ConsumePendingActionCommand,
  type CreatePendingActionCommand,
  type GetPendingActionCommand,
  type GetPendingActionExecutionCommand,
  type PendingActionExecutionProjection,
  type PendingActionExecutionReceiptInput,
  type PendingActionPayload,
  type PendingActionProjection,
  type PendingActionSubject,
  type PendingActionType,
} from './pending-action-types.js'

interface ExecutionReceiptPayload {
  readonly v: 1
  readonly pending_action_id: string
  readonly user_id: string
  readonly business_request_id: string
  readonly result: 'success'
  readonly expires_at: number
}

export interface PendingActionServiceDependencies {
  readonly config: IdentityConfig
  readonly store: PendingActionStore
  readonly now?: () => Date
  readonly ttlSeconds?: number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw identityError(code, 422)
  return value.toLowerCase()
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const allowed = new Set(expected)
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw identityError('PENDING_ACTION_PAYLOAD_INVALID', 422)
  }
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw identityError('PENDING_ACTION_PAYLOAD_INVALID', 422)
  return value
}

function normalizedPayload(actionType: PendingActionType, input: Readonly<Record<string, unknown>>): PendingActionPayload {
  if (actionType === 'set_project_favorite' || actionType === 'set_project_like' || actionType === 'set_project_follow') {
    exactKeys(input, ['project_id', 'state'])
    return Object.freeze({
      action_type: actionType,
      project_id: requireUuid(input.project_id, 'PROJECT_ID_INVALID'),
      state: boolean(input.state),
    })
  }
  if (actionType === 'create_comment') {
    exactKeys(input, ['project_id', 'body', 'parent_comment_id'])
    if (typeof input.body !== 'string') throw identityError('PENDING_ACTION_PAYLOAD_INVALID', 422)
    const body = input.body.trim()
    if (body.length < 1 || body.length > 2_000) throw identityError('COMMENT_BODY_INVALID', 422)
    return Object.freeze({
      action_type: actionType,
      project_id: requireUuid(input.project_id, 'PROJECT_ID_INVALID'),
      body,
      parent_comment_id: input.parent_comment_id === null || input.parent_comment_id === undefined
        ? null
        : requireUuid(input.parent_comment_id, 'PARENT_COMMENT_ID_INVALID'),
    })
  }
  if (actionType === 'save_comparison') {
    exactKeys(input, ['comparison_id', 'comparison_version', 'state'])
    if (!Number.isSafeInteger(input.comparison_version) || Number(input.comparison_version) < 1 || input.state !== true) {
      throw identityError('PENDING_ACTION_PAYLOAD_INVALID', 422)
    }
    return Object.freeze({
      action_type: actionType,
      comparison_id: requireUuid(input.comparison_id, 'COMPARISON_ID_INVALID'),
      comparison_version: Number(input.comparison_version),
      state: true,
    })
  }
  exactKeys(input, ['category_id'])
  if (input.category_id !== 'ai_learning_quiz' && input.category_id !== 'personal_site_portfolio') {
    throw identityError('CATEGORY_ID_INVALID', 422)
  }
  return Object.freeze({ action_type: actionType, category_id: input.category_id })
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function derivedPayloadKey(config: IdentityConfig): string {
  return createHmac('sha256', Buffer.from(config.emailEncryptionKey, 'base64'))
    .update('vibecheck/pending-action/payload/v1', 'utf8')
    .digest('base64')
}

export class PendingActionService {
  private readonly now: () => Date
  private readonly ttlSeconds: number
  private readonly payloadKey: string

  constructor(private readonly dependencies: PendingActionServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.ttlSeconds = dependencies.ttlSeconds ?? 900
    this.payloadKey = derivedPayloadKey(dependencies.config)
  }

  async create(command: CreatePendingActionCommand): Promise<PendingActionProjection> {
    const now = this.now()
    const owner = this.owner(command.subject)
    const actionType = this.actionType(command.actionType)
    const payload = normalizedPayload(actionType, command.parameters)
    const serialized = canonical(payload)
    if (Buffer.byteLength(serialized, 'utf8') > 4_096) throw identityError('PENDING_ACTION_PAYLOAD_TOO_LARGE', 413)
    const returnTo = normalizeReturnTo(command.returnTo)
    const clientRequestId = requireUuid(command.clientRequestId, 'CLIENT_REQUEST_ID_INVALID')
    const requestPayloadHash = hash(canonical({ action_type: actionType, payload, return_to: returnTo }))
    return this.dependencies.store.create({
      pendingActionId: randomUUID(),
      ...owner,
      actionType,
      payloadCiphertext: encryptText(this.payloadKey, serialized),
      payloadKeyVersion: `pending-action:${this.dependencies.config.emailEncryptionKeyVersion}:v1`,
      requestPayloadHash,
      returnTo,
      clientRequestId,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1_000),
      requestId: command.requestId,
      now,
    })
  }

  get(command: GetPendingActionCommand): Promise<PendingActionProjection> {
    return this.dependencies.store.get(this.accessInput(command))
  }

  async getForExecution(command: GetPendingActionExecutionCommand): Promise<PendingActionExecutionProjection> {
    const stored = await this.dependencies.store.get(this.accessInput(command))
    if (stored.status !== 'pending' || stored.payloadCiphertext === null) {
      throw identityError('PENDING_ACTION_NOT_EXECUTABLE', 409)
    }
    const expectedVersion = `pending-action:${this.dependencies.config.emailEncryptionKeyVersion}:v1`
    if (stored.payloadKeyVersion !== expectedVersion) {
      throw identityError('PENDING_ACTION_KEY_VERSION_UNAVAILABLE', 503, true)
    }
    let parsed: PendingActionPayload
    try {
      parsed = JSON.parse(decryptText(this.payloadKey, stored.payloadCiphertext)) as PendingActionPayload
    } catch {
      throw identityError('PENDING_ACTION_PAYLOAD_INVALID', 500)
    }
    return Object.freeze({
      pending_action_id: stored.pending_action_id,
      action_type: stored.action_type,
      return_to: stored.return_to,
      status: stored.status,
      expires_at: stored.expires_at,
      consumed_at: stored.consumed_at,
      cancelled_at: stored.cancelled_at,
      cancel_reason: stored.cancel_reason,
      payload: Object.freeze(parsed),
      client_request_id: stored.clientRequestId,
    })
  }

  consume(command: ConsumePendingActionCommand): Promise<PendingActionProjection> {
    const now = this.now()
    const owner = this.owner(command.subject)
    const pendingActionId = requireUuid(command.pendingActionId, 'PENDING_ACTION_ID_INVALID')
    const identityLinkId = requireUuid(command.identityLinkId, 'IDENTITY_LINK_ID_INVALID')
    const clientRequestId = requireUuid(command.clientRequestId, 'CLIENT_REQUEST_ID_INVALID')
    if (command.expectedStatus !== 'pending') throw identityError('EXPECTED_STATUS_INVALID', 422)
    const receipt = this.verifyExecutionReceipt(command.executionReceipt, now)
    if (receipt.pending_action_id !== pendingActionId || receipt.user_id !== command.subject.id) {
      throw identityError('EXECUTION_RECEIPT_INVALID', 403)
    }
    const requestHash = hash(canonical({
      identity_link_id: identityLinkId,
      business_request_id: receipt.business_request_id,
      expected_status: command.expectedStatus,
    }))
    return this.dependencies.store.consume({
      pendingActionId,
      ...owner,
      identityLinkId,
      operationId: clientRequestId,
      requestHash,
      executionReceiptHash: keyedHash(this.dependencies.config.authTokenSecret, command.executionReceipt),
      businessRequestId: receipt.business_request_id,
      requestId: command.requestId,
      now,
    })
  }

  completeExecution(
    command: CompletePendingActionExecutionCommand,
  ): Promise<PendingActionProjection> {
    const now = this.now()
    const executionReceipt = this.issueExecutionReceipt({
      pendingActionId: command.pendingActionId,
      userId: command.subject.id,
      businessRequestId: command.businessRequestId,
      result: 'success',
      expiresAt: new Date(now.getTime() + 60_000),
    })
    return this.consume({
      pendingActionId: command.pendingActionId,
      subject: command.subject,
      identityLinkId: command.identityLinkId,
      executionReceipt,
      clientRequestId: command.clientRequestId,
      expectedStatus: command.expectedStatus,
      requestId: command.requestId,
    })
  }

  cancel(command: CancelPendingActionCommand): Promise<PendingActionProjection> {
    const now = this.now()
    const owner = this.owner(command.subject)
    const pendingActionId = requireUuid(command.pendingActionId, 'PENDING_ACTION_ID_INVALID')
    const identityLinkId = command.identityLinkId === null
      ? null
      : requireUuid(command.identityLinkId, 'IDENTITY_LINK_ID_INVALID')
    const clientRequestId = requireUuid(command.clientRequestId, 'CLIENT_REQUEST_ID_INVALID')
    const cancelReason = command.cancelReason.trim()
    if (cancelReason.length < 1 || cancelReason.length > 128) throw identityError('CANCEL_REASON_INVALID', 422)
    const requestHash = hash(canonical({ identity_link_id: identityLinkId, cancel_reason: cancelReason }))
    return this.dependencies.store.cancel({
      pendingActionId,
      ...owner,
      identityLinkId,
      operationId: clientRequestId,
      requestHash,
      cancelReason,
      requestId: command.requestId,
      now,
    })
  }

  issueExecutionReceipt(input: PendingActionExecutionReceiptInput): string {
    const now = this.now()
    if (input.expiresAt <= now || input.expiresAt.getTime() > now.getTime() + 300_000) {
      throw identityError('EXECUTION_RECEIPT_EXPIRY_INVALID', 422)
    }
    const payload: ExecutionReceiptPayload = Object.freeze({
      v: 1,
      pending_action_id: requireUuid(input.pendingActionId, 'PENDING_ACTION_ID_INVALID'),
      user_id: requireUuid(input.userId, 'USER_ID_INVALID'),
      business_request_id: requireUuid(input.businessRequestId, 'BUSINESS_REQUEST_ID_INVALID'),
      result: input.result,
      expires_at: Math.floor(input.expiresAt.getTime() / 1_000),
    })
    const encoded = Buffer.from(canonical(payload), 'utf8').toString('base64url')
    const signature = createHmac('sha256', this.dependencies.config.authTokenSecret)
      .update('pending-action-execution.v1.', 'utf8')
      .update(encoded, 'utf8')
      .digest('base64url')
    return `${encoded}.${signature}`
  }

  private verifyExecutionReceipt(token: string, now: Date): ExecutionReceiptPayload {
    const [encoded, supplied, extra] = token.split('.')
    if (!encoded || !supplied || extra !== undefined || token.length > 2_048) {
      throw identityError('EXECUTION_RECEIPT_INVALID', 403)
    }
    const expected = createHmac('sha256', this.dependencies.config.authTokenSecret)
      .update('pending-action-execution.v1.', 'utf8')
      .update(encoded, 'utf8')
      .digest()
    let actual: Buffer
    try {
      actual = Buffer.from(supplied, 'base64url')
    } catch {
      throw identityError('EXECUTION_RECEIPT_INVALID', 403)
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw identityError('EXECUTION_RECEIPT_INVALID', 403)
    }
    let payload: ExecutionReceiptPayload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ExecutionReceiptPayload
    } catch {
      throw identityError('EXECUTION_RECEIPT_INVALID', 403)
    }
    if (
      payload.v !== 1 || payload.result !== 'success' ||
      !uuidPattern.test(payload.pending_action_id) || !uuidPattern.test(payload.user_id) ||
      !uuidPattern.test(payload.business_request_id) || !Number.isSafeInteger(payload.expires_at) ||
      payload.expires_at <= Math.floor(now.getTime() / 1_000)
    ) {
      throw identityError('EXECUTION_RECEIPT_INVALID', 403)
    }
    return payload
  }

  private actionType(value: string): PendingActionType {
    if (!pendingActionTypes.includes(value as PendingActionType)) {
      throw identityError('PENDING_ACTION_TYPE_INVALID', 422)
    }
    return value as PendingActionType
  }

  private owner(subject: PendingActionSubject): PendingActionStoreOwner {
    const id = requireUuid(subject.id, 'PENDING_ACTION_SUBJECT_INVALID')
    return Object.freeze({
      subject: Object.freeze({ kind: subject.kind, id }) as PendingActionSubject,
      subjectHash: keyedHash(this.dependencies.config.authTokenSecret, `${subject.kind}:${id}`),
    })
  }

  private accessInput(command: GetPendingActionCommand): AccessPendingActionStoreInput {
    return {
      pendingActionId: requireUuid(command.pendingActionId, 'PENDING_ACTION_ID_INVALID'),
      ...this.owner(command.subject),
      identityLinkId: command.identityLinkId === null
        ? null
        : requireUuid(command.identityLinkId, 'IDENTITY_LINK_ID_INVALID'),
      requestId: command.requestId,
      now: this.now(),
    }
  }
}
