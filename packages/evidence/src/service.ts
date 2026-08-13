import { createHash } from 'node:crypto'

import { evidenceError } from './errors.js'
import type { EvidenceStore, EvidenceUrlSafetyResolver } from './store-port.js'
import {
  evidenceFinalTargetKinds,
  evidenceParentTypes,
  evidenceSourceChannels,
  evidenceTypes,
  evidenceVisibilities,
  type BindEvidenceDraftCommand,
  type CompleteEvidenceDraftCommand,
  type CreateEvidenceAttachmentCommand,
  type CreateEvidenceDraftCommand,
  type DeleteEvidenceAttachmentCommand,
  type EvidenceActor,
  type EvidenceAttachmentDraftProjection,
  type EvidenceAttachmentRole,
  type EvidenceBindingProjection,
  type EvidenceCollectorActorType,
  type EvidenceDraftProjection,
  type EvidenceFinalTargetKind,
  type EvidenceParentType,
  type EvidenceSourceChannel,
  type EvidenceType,
  type EvidenceVisibility,
  type GetEvidenceDraftCommand,
  type PatchEvidenceDraftCommand,
  type WithdrawEvidenceDraftCommand,
} from './types.js'

export class EvidenceService {
  private readonly now: () => Date

  constructor(private readonly dependencies: Readonly<{
    store: EvidenceStore
    urlSafetyResolver: EvidenceUrlSafetyResolver
    now?: () => Date
  }>) {
    this.now = dependencies.now ?? (() => new Date())
  }

  createDraft(command: CreateEvidenceDraftCommand): Promise<EvidenceDraftProjection> {
    const actor = this.actor(command.actor)
    const parentType = this.parentType(command.parentType)
    const finalTargetKind = this.finalTarget(command.finalTargetKind)
    this.assertTargetMatrix(parentType, finalTargetKind)
    const evidenceType = this.evidenceType(command.evidenceType)
    this.authorizeEvidenceType(actor, evidenceType)
    const sourceChannel = this.sourceChannel(command.sourceChannel)
    if (sourceChannel === 'platform_check' && !this.isStaff(actor)) {
      throw evidenceError('EVIDENCE_SOURCE_CHANNEL_FORBIDDEN', 403)
    }
    const targetAssetDraftKey = finalTargetKind === 'asset'
      ? this.assetDraftKey(command.targetAssetDraftKey)
      : command.targetAssetDraftKey === null
        ? null
        : (() => { throw evidenceError('EVIDENCE_ASSET_DRAFT_KEY_FORBIDDEN', 422) })()
    const normalized = Object.freeze({
      actor,
      collectorActorType: this.collector(actor),
      parentType,
      parentId: this.uuid(command.parentId, 'EVIDENCE_PARENT_ID_INVALID'),
      finalTargetKind,
      targetAssetDraftKey,
      fieldPath: this.fieldPath(command.fieldPath),
      requestedVisibility: this.visibility(command.requestedVisibility),
      evidenceType,
      sourceChannel,
      clientRequestId: this.operationId(command.clientRequestId),
      requestId: this.requestId(command.requestId),
    })
    return this.dependencies.store.createDraft({
      ...normalized,
      requestHash: this.hash(JSON.stringify({
        parent_type: normalized.parentType,
        parent_id: normalized.parentId,
        final_target_kind: normalized.finalTargetKind,
        target_asset_draft_key: normalized.targetAssetDraftKey,
        field_path: normalized.fieldPath,
        requested_visibility: normalized.requestedVisibility,
        evidence_type: normalized.evidenceType,
        source_channel: normalized.sourceChannel,
      })),
      now: this.now(),
    })
  }

  getDraft(command: GetEvidenceDraftCommand): Promise<EvidenceDraftProjection> {
    return this.dependencies.store.getDraft({
      actor: this.actor(command.actor),
      evidenceDraftId: this.uuid(command.evidenceDraftId, 'EVIDENCE_DRAFT_ID_INVALID'),
      now: this.now(),
    })
  }

  async patchDraft(command: PatchEvidenceDraftCommand): Promise<EvidenceDraftProjection> {
    const actor = this.actor(command.actor)
    const patch: {
      sourceUrl?: string | null
      internalRecordRef?: string | null
      textExcerpt?: string | null
      fieldPath?: string | null
      requestedVisibility?: string
    } = {}
    if (Object.hasOwn(command.patch, 'sourceUrl')) {
      const sourceUrl = command.patch.sourceUrl
      patch.sourceUrl = sourceUrl === null || sourceUrl === undefined
        ? null
        : await this.safeSourceUrl(sourceUrl)
    }
    if (Object.hasOwn(command.patch, 'internalRecordRef')) {
      if (command.patch.internalRecordRef !== null) {
        if (!this.isStaff(actor)) throw evidenceError('EVIDENCE_INTERNAL_RECORD_FORBIDDEN', 403)
        throw evidenceError('EVIDENCE_INTERNAL_RECORD_ADAPTER_UNAVAILABLE', 503, true)
      }
      patch.internalRecordRef = null
    }
    if (Object.hasOwn(command.patch, 'textExcerpt')) {
      patch.textExcerpt = this.text(command.patch.textExcerpt)
    }
    if (Object.hasOwn(command.patch, 'fieldPath')) {
      patch.fieldPath = this.fieldPath(command.patch.fieldPath)
    }
    if (Object.hasOwn(command.patch, 'requestedVisibility')) {
      patch.requestedVisibility = this.visibility(command.patch.requestedVisibility!)
    }
    if (Object.keys(patch).length === 0) throw evidenceError('EVIDENCE_PATCH_EMPTY', 422)
    const expectedVersion = this.version(command.expectedVersion)
    const operationId = this.operationId(command.operationId)
    return this.dependencies.store.patchDraft({
      actor,
      evidenceDraftId: this.uuid(command.evidenceDraftId, 'EVIDENCE_DRAFT_ID_INVALID'),
      expectedVersion,
      patch: Object.freeze(patch),
      operationId,
      requestHash: this.hash(JSON.stringify({ expected_version: expectedVersion, patch })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  bindDraft(command: BindEvidenceDraftCommand): Promise<EvidenceBindingProjection> {
    const parentType = this.parentType(command.parentType)
    const expectedParentVersion = this.version(command.expectedParentVersion)
    const operationId = this.operationId(command.operationId)
    const parentId = this.uuid(command.parentId, 'EVIDENCE_PARENT_ID_INVALID')
    return this.dependencies.store.bindDraft({
      actor: this.actor(command.actor),
      evidenceDraftId: this.uuid(command.evidenceDraftId, 'EVIDENCE_DRAFT_ID_INVALID'),
      parentType,
      parentId,
      expectedParentVersion,
      operationId,
      requestHash: this.hash(JSON.stringify({
        parent_type: parentType,
        parent_id: parentId,
        expected_parent_version: expectedParentVersion,
      })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  completeDraft(command: CompleteEvidenceDraftCommand): Promise<EvidenceDraftProjection> {
    const expectedVersion = this.version(command.expectedVersion)
    const operationId = this.operationId(command.operationId)
    return this.dependencies.store.completeDraft({
      actor: this.actor(command.actor),
      evidenceDraftId: this.uuid(command.evidenceDraftId, 'EVIDENCE_DRAFT_ID_INVALID'),
      expectedVersion,
      operationId,
      requestHash: this.hash(JSON.stringify({ expected_version: expectedVersion })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  createAttachment(
    command: CreateEvidenceAttachmentCommand,
  ): Promise<EvidenceAttachmentDraftProjection> {
    const role = command.role as EvidenceAttachmentRole
    if (!['supporting_document', 'supporting_image'].includes(role)) {
      throw evidenceError('EVIDENCE_ATTACHMENT_ROLE_INVALID', 422)
    }
    const requestedVisibility = this.visibility(command.requestedVisibility)
    const expectedDraftVersion = this.version(command.expectedDraftVersion)
    const operationId = this.operationId(command.clientRequestId)
    const mediaResourceId = this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID')
    return this.dependencies.store.createAttachment({
      actor: this.actor(command.actor),
      evidenceDraftId: this.uuid(command.evidenceDraftId, 'EVIDENCE_DRAFT_ID_INVALID'),
      mediaResourceId,
      role,
      requestedVisibility,
      expectedDraftVersion,
      operationId,
      requestHash: this.hash(JSON.stringify({
        media_resource_id: mediaResourceId,
        role,
        requested_visibility: requestedVisibility,
        expected_draft_version: expectedDraftVersion,
      })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  deleteAttachment(
    command: DeleteEvidenceAttachmentCommand,
  ): Promise<EvidenceAttachmentDraftProjection> {
    const expectedVersion = this.version(command.expectedVersion)
    const operationId = this.operationId(command.operationId)
    return this.dependencies.store.deleteAttachment({
      actor: this.actor(command.actor),
      attachmentDraftId: this.uuid(command.attachmentDraftId, 'EVIDENCE_ATTACHMENT_ID_INVALID'),
      expectedVersion,
      operationId,
      requestHash: this.hash(JSON.stringify({ expected_version: expectedVersion })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  withdrawDraft(command: WithdrawEvidenceDraftCommand): Promise<EvidenceDraftProjection> {
    const expectedVersion = this.version(command.expectedVersion)
    const reasonCode = this.reasonCode(command.reasonCode)
    const operationId = this.operationId(command.operationId)
    return this.dependencies.store.withdrawDraft({
      actor: this.actor(command.actor),
      evidenceDraftId: this.uuid(command.evidenceDraftId, 'EVIDENCE_DRAFT_ID_INVALID'),
      expectedVersion,
      reasonCode,
      operationId,
      requestHash: this.hash(JSON.stringify({ expected_version: expectedVersion, reason_code: reasonCode })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  private actor(value: EvidenceActor): EvidenceActor {
    const userId = this.uuid(value.userId, 'EVIDENCE_USER_INVALID')
    if (value.roles.length === 0 || value.roles.some(
      (role) => !['user', 'verified_author', 'editor', 'admin'].includes(role),
    )) throw evidenceError('EVIDENCE_ACTOR_INVALID', 403)
    return Object.freeze({ userId, roles: Object.freeze([...new Set(value.roles)]) })
  }

  private authorizeEvidenceType(actor: EvidenceActor, evidenceType: EvidenceType): void {
    if (evidenceType === 'trusted_external_source') return
    if (evidenceType === 'platform_verified_fact' && this.isStaff(actor)) return
    if (evidenceType === 'verified_author_statement') {
      if (!actor.roles.includes('verified_author')) throw evidenceError('EVIDENCE_TYPE_FORBIDDEN', 403)
      throw evidenceError('EVIDENCE_AUTHOR_CAPABILITY_UNAVAILABLE', 503, true)
    }
    throw evidenceError('EVIDENCE_TYPE_FORBIDDEN', 403)
  }

  private collector(actor: EvidenceActor): EvidenceCollectorActorType {
    if (this.isStaff(actor)) return 'platform_editor'
    if (actor.roles.includes('verified_author')) return 'verified_author'
    return 'user'
  }

  private isStaff(actor: EvidenceActor): boolean {
    return actor.roles.includes('editor') || actor.roles.includes('admin')
  }

  private assertTargetMatrix(parent: EvidenceParentType, target: EvidenceFinalTargetKind): void {
    if (parent === 'relation_candidate' && target !== 'relation') {
      throw evidenceError('EVIDENCE_TARGET_MATRIX_INVALID', 422)
    }
    if (parent !== 'relation_candidate' && target === 'relation') {
      throw evidenceError('EVIDENCE_TARGET_MATRIX_INVALID', 422)
    }
  }

  private async safeSourceUrl(value: string): Promise<string> {
    let url: URL
    try {
      url = new URL(value.trim())
    } catch {
      throw evidenceError('EVIDENCE_SOURCE_URL_INVALID', 422)
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
      throw evidenceError('EVIDENCE_SOURCE_URL_INVALID', 422)
    }
    url.hash = ''
    const resolved = await this.dependencies.urlSafetyResolver.resolve(url.toString())
    if (resolved.result === 'blocked') {
      throw evidenceError('EVIDENCE_SOURCE_URL_BLOCKED', 422, false, {
        reason_code: resolved.reasonCode,
      })
    }
    if (resolved.result !== 'allowed' || resolved.safeWebUrl === null) {
      throw evidenceError('EVIDENCE_SOURCE_URL_CHECK_UNAVAILABLE', 504, true)
    }
    const safe = new URL(resolved.safeWebUrl)
    safe.hash = ''
    if (safe.toString().length > 2_048) throw evidenceError('EVIDENCE_SOURCE_URL_INVALID', 422)
    return safe.toString()
  }

  private text(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const normalized = Array.from(value)
      .filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint === 9 || codePoint === 10 || codePoint === 13 || codePoint > 31 && codePoint !== 127
      })
      .join('')
      .replace(/\r\n?/g, '\n').trim()
    if (!normalized) return null
    if (normalized.length > 2_000) throw evidenceError('EVIDENCE_TEXT_EXCERPT_INVALID', 422)
    return normalized
  }

  private fieldPath(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const normalized = value.trim()
    if (
      normalized.length < 2 || normalized.length > 240 || !normalized.startsWith('/') ||
      normalized.includes('//') || Array.from(normalized).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint < 32 || codePoint === 127
      })
    ) throw evidenceError('EVIDENCE_FIELD_PATH_INVALID', 422)
    return normalized
  }

  private assetDraftKey(value: string | null): string {
    const normalized = value?.trim() ?? ''
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) {
      throw evidenceError('EVIDENCE_ASSET_DRAFT_KEY_INVALID', 422)
    }
    return normalized
  }

  private parentType(value: string): EvidenceParentType {
    if (!evidenceParentTypes.includes(value as EvidenceParentType)) {
      throw evidenceError('EVIDENCE_PARENT_TYPE_INVALID', 422)
    }
    return value as EvidenceParentType
  }

  private finalTarget(value: string): EvidenceFinalTargetKind {
    if (!evidenceFinalTargetKinds.includes(value as EvidenceFinalTargetKind)) {
      throw evidenceError('EVIDENCE_FINAL_TARGET_INVALID', 422)
    }
    return value as EvidenceFinalTargetKind
  }

  private evidenceType(value: string): EvidenceType {
    if (!evidenceTypes.includes(value as EvidenceType)) throw evidenceError('EVIDENCE_TYPE_INVALID', 422)
    return value as EvidenceType
  }

  private sourceChannel(value: string): EvidenceSourceChannel {
    if (!evidenceSourceChannels.includes(value as EvidenceSourceChannel)) {
      throw evidenceError('EVIDENCE_SOURCE_CHANNEL_INVALID', 422)
    }
    return value as EvidenceSourceChannel
  }

  private visibility(value: string): EvidenceVisibility {
    if (!evidenceVisibilities.includes(value as EvidenceVisibility)) {
      throw evidenceError('EVIDENCE_VISIBILITY_INVALID', 422)
    }
    return value as EvidenceVisibility
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw evidenceError(code, 422)
    }
    return value.toLowerCase()
  }

  private version(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw evidenceError('EVIDENCE_VERSION_INVALID', 422)
    return value
  }

  private operationId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw evidenceError('OPERATION_ID_INVALID', 422)
    return value
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw evidenceError('REQUEST_ID_INVALID', 422)
    return value
  }

  private reasonCode(value: string): string {
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) throw evidenceError('REASON_CODE_INVALID', 422)
    return normalized
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
