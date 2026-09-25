import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

import type { AdminOperationSecurityStore } from './admin-operation-store.js'
import type {
  AdminOperationConfirmProjection,
  AdminOperationImpact,
  AdminOperationPreviewProjection,
  AdminOperationTarget,
  ConfirmAdminOperationCommand,
  PreviewAdminOperationCommand,
} from './admin-operation-types.js'
import { workflowError } from './errors.js'
import type { ReviewActor } from './types.js'

export interface AdminOperationSecurityConfig {
  readonly tokenSecret: string
  readonly authTokenSecret: string
  readonly previewTtlSeconds: number
  readonly confirmTtlSeconds: number
  readonly recentAuthWindowSeconds: number
}

export class AdminOperationSecurityService {
  private readonly now: () => Date

  constructor(
    private readonly store: AdminOperationSecurityStore,
    private readonly config: AdminOperationSecurityConfig,
    now: () => Date = () => new Date(),
  ) {
    this.now = now
    if (config.tokenSecret.length < 32 || config.authTokenSecret.length < 32) {
      throw new Error('ADMIN_OPERATION_TOKEN_SECRET_INVALID')
    }
    if (
      config.previewTtlSeconds !== 600 || config.confirmTtlSeconds !== 120 ||
      config.recentAuthWindowSeconds !== 300
    ) throw new Error('ADMIN_OPERATION_TTL_CONFIG_INVALID')
  }

  async preview(command: PreviewAdminOperationCommand): Promise<AdminOperationPreviewProjection> {
    const actor = this.actor(command.actor)
    const sessionToken = this.sessionToken(command.sessionToken)
    const operationType = this.safeKey(command.operationType, 'ADMIN_OPERATION_TYPE_INVALID')
    const targets = this.targets(command.targets)
    const expectedVersions = this.expectedVersions(command.expectedVersions)
    const proposedDiff = this.jsonObject(command.proposedDiff, 'ADMIN_OPERATION_DIFF_INVALID')
    const reasonCode = this.safeKey(command.reasonCode, 'REASON_CODE_INVALID')
    const claimToken = command.claimToken === null ? null : this.claimToken(command.claimToken)
    const conflictVersion = this.optionalVersion(command.expectedConflictPrincipalVersion)
    const requestId = this.requestId(command.requestId)
    const diffHash = this.hash(this.canonicalJson(proposedDiff))
    const impact = this.impact(targets, expectedVersions, proposedDiff)
    const impactHash = this.hash(this.canonicalJson(impact))
    const confirmationSummaryHash = this.hash(this.canonicalJson({
      operation_type: operationType,
      targets,
      expected_versions: expectedVersions,
      diff_hash: diffHash,
      impact_hash: impactHash,
      reason_code: reasonCode,
      expected_conflict_principal_version: conflictVersion,
    }))
    const previewToken = randomBytes(32).toString('base64url')
    const previewId = randomUUID()
    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + this.config.previewTtlSeconds * 1_000)
    await this.store.createPreview({
      previewId,
      previewTokenHash: this.authHash(previewToken),
      primarySessionIdHash: this.authHash(sessionToken),
      actor,
      operationType,
      targets,
      expectedVersions,
      proposedDiff,
      reasonCode,
      claimTokenHash: claimToken === null ? null : this.hashBuffer(claimToken),
      expectedConflictPrincipalVersion: conflictVersion,
      diffHash,
      impactHash,
      confirmationSummaryHash,
      impact,
      createdAt,
      expiresAt,
      requestId,
    })
    return Object.freeze({
      preview_token: previewToken,
      operation_type: operationType,
      targets,
      expected_versions: expectedVersions,
      diff: proposedDiff,
      impact,
      confirmation_summary_hash: confirmationSummaryHash,
      expires_at: expiresAt.toISOString(),
      conflict_principal_version: conflictVersion,
    })
  }

  async confirm(command: ConfirmAdminOperationCommand): Promise<AdminOperationConfirmProjection> {
    const actor = this.actor(command.actor)
    const sessionToken = this.sessionToken(command.sessionToken)
    const previewToken = this.opaqueToken(command.previewToken, 'PREVIEW_TOKEN_INVALID')
    const confirmationSummaryHash = this.sha256(command.confirmationSummaryHash)
    const confirmRequestId = this.requestId(command.confirmRequestId)
    const reauthGrantId = command.reauthGrantId === null
      ? null
      : this.uuid(command.reauthGrantId, 'REAUTH_GRANT_ID_INVALID')
    const conflictVersion = this.optionalVersion(command.expectedConflictPrincipalVersion)
    const requestId = this.requestId(command.requestId)
    const confirmGrantId = randomUUID()
    const confirmToken = this.confirmToken(confirmGrantId)
    const result = await this.store.confirmPreview({
      previewTokenHash: this.authHash(previewToken),
      primarySessionIdHash: this.authHash(sessionToken),
      actor,
      confirmationSummaryHash,
      confirmRequestId,
      confirmGrantId,
      confirmTokenHash: this.tokenHash(confirmToken),
      reauthGrantId,
      expectedConflictPrincipalVersion: conflictVersion,
      recentAuthWindowSeconds: this.config.recentAuthWindowSeconds,
      confirmTtlSeconds: this.config.confirmTtlSeconds,
      now: this.now(),
      requestId,
    })
    if (result.kind === 'error') throw workflowError(result.code, result.httpStatus)
    if (result.kind === 'reauth_required') {
      throw workflowError('REAUTH_REQUIRED', 401, false, {
        purpose: 'admin_confirm',
        preview_expires_at: result.preview.expiresAt.toISOString(),
      })
    }
    const stableToken = this.confirmToken(result.confirmGrantId)
    return Object.freeze({
      confirm_token: stableToken,
      expires_at: result.expiresAt.toISOString(),
      binding_summary: Object.freeze({
        operation_type: result.preview.operationType,
        target_count: result.preview.targetCount,
        confirmation_summary_hash: result.preview.confirmationSummaryHash,
      }),
      assurance_source: result.assuranceSource,
      conflict_principal_version: result.preview.expectedConflictPrincipalVersion,
      replayed: result.kind === 'replayed',
    })
  }

  private actor(value: ReviewActor): ReviewActor {
    const userId = this.uuid(value.userId, 'ACTOR_USER_ID_INVALID')
    if (!Array.isArray(value.roles) || !Array.isArray(value.permissions)) {
      throw workflowError('ACTOR_CONTEXT_INVALID', 403)
    }
    if (!value.roles.includes('admin') && !value.roles.includes('editor')) {
      throw workflowError('ADMIN_OPERATION_FORBIDDEN', 403)
    }
    return Object.freeze({
      userId,
      roles: Object.freeze([...new Set(value.roles)].sort()),
      permissions: Object.freeze([...new Set(value.permissions)].sort()),
    })
  }

  private targets(value: readonly AdminOperationTarget[]): readonly AdminOperationTarget[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
      throw workflowError('ADMIN_OPERATION_TARGETS_INVALID', 422)
    }
    const normalized = value.map((item) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw workflowError('ADMIN_OPERATION_TARGETS_INVALID', 422)
      }
      const keys = Object.keys(item)
      if (keys.length !== 2 || !keys.includes('target_type') || !keys.includes('target_id')) {
        throw workflowError('ADMIN_OPERATION_TARGETS_INVALID', 422)
      }
      const targetType = this.safeKey(item.target_type, 'ADMIN_OPERATION_TARGETS_INVALID')
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.target_id)) {
        throw workflowError('ADMIN_OPERATION_TARGETS_INVALID', 422)
      }
      return Object.freeze({ target_type: targetType, target_id: item.target_id })
    }).sort((left, right) => (
      left.target_type.localeCompare(right.target_type) || left.target_id.localeCompare(right.target_id)
    ))
    const unique = new Set(normalized.map((item) => `${item.target_type}\u0000${item.target_id}`))
    if (unique.size !== normalized.length) throw workflowError('ADMIN_OPERATION_TARGETS_INVALID', 422)
    return Object.freeze(normalized)
  }

  private expectedVersions(value: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
    const object = this.jsonObject(value, 'EXPECTED_VERSIONS_INVALID')
    const entries = Object.entries(object)
    if (entries.length < 1 || entries.length > 50) throw workflowError('EXPECTED_VERSIONS_INVALID', 422)
    const normalized: Record<string, number> = {}
    for (const [key, item] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key) || !Number.isSafeInteger(item) || (item as number) < 1) {
        throw workflowError('EXPECTED_VERSIONS_INVALID', 422)
      }
      normalized[key] = item as number
    }
    return Object.freeze(normalized)
  }

  private impact(
    targets: readonly AdminOperationTarget[],
    expectedVersions: Readonly<Record<string, number>>,
    proposedDiff: Readonly<Record<string, unknown>>,
  ): AdminOperationImpact {
    return Object.freeze({
      target_count: targets.length,
      expected_version_count: Object.keys(expectedVersions).length,
      changed_top_level_fields: Object.freeze(Object.keys(proposedDiff).sort()),
    })
  }

  private jsonObject(value: unknown, code: string): Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw workflowError(code, 422)
    }
    this.canonicalJson(value)
    return Object.freeze({ ...(value as Record<string, unknown>) })
  }

  private canonicalJson(value: unknown, depth = 0): string {
    if (depth > 20) throw workflowError('ADMIN_OPERATION_PAYLOAD_INVALID', 422)
    if (value === null) return 'null'
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw workflowError('ADMIN_OPERATION_PAYLOAD_INVALID', 422)
      return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
      if (value.length > 200) throw workflowError('ADMIN_OPERATION_PAYLOAD_INVALID', 422)
      return `[${value.map((item) => this.canonicalJson(item, depth + 1)).join(',')}]`
    }
    if (typeof value !== 'object') throw workflowError('ADMIN_OPERATION_PAYLOAD_INVALID', 422)
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).sort()
    if (keys.length > 200 || keys.some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
      throw workflowError('ADMIN_OPERATION_PAYLOAD_INVALID', 422)
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key], depth + 1)}`).join(',')}}`
  }

  private optionalVersion(value: number | null): number | null {
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      throw workflowError('EXPECTED_CONFLICT_PRINCIPAL_VERSION_INVALID', 422)
    }
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

  private claimToken(value: string): string {
    return this.opaqueToken(value, 'CLAIM_TOKEN_INVALID')
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw workflowError('REQUEST_ID_INVALID', 422)
    return value
  }

  private safeKey(value: string, code: string): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
      throw workflowError(code, 422)
    }
    return value
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw workflowError(code, 422)
    }
    return value.toLowerCase()
  }

  private sha256(value: string): string {
    if (!/^[a-f0-9]{64}$/.test(value)) throw workflowError('CONFIRMATION_SUMMARY_HASH_INVALID', 422)
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

  private confirmToken(confirmGrantId: string): string {
    return createHmac('sha256', this.config.tokenSecret)
      .update(`admin-confirm:v1:${confirmGrantId}`, 'utf8')
      .digest('base64url')
  }

  private tokenHash(value: string): Buffer {
    return createHmac('sha256', this.config.tokenSecret).update(value, 'utf8').digest()
  }
}
