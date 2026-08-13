import { createHash } from 'node:crypto'

import { mediaError } from './errors.js'
import type { MediaStore } from './store-port.js'
import {
  mediaTargetTypes,
  type CreateMediaReferenceCommand,
  type DeleteMediaReferenceCommand,
  type GetMediaResourceCommand,
  type ListMediaReferencesCommand,
  type MediaReferencePage,
  type MediaReferenceProjection,
  type MediaResourceProjection,
  type MediaTargetType,
  type PatchMediaReferenceCommand,
} from './types.js'

const editableTargetTypes = new Set<MediaTargetType>([
  'submission_draft',
  'admin_project_creation_draft',
  'admin_project_edit_draft',
  'project_update',
  'creator_profile_draft',
])

export class MediaService {
  private readonly now: () => Date

  constructor(private readonly store: MediaStore, now: () => Date = () => new Date()) {
    this.now = now
  }

  getResource(command: GetMediaResourceCommand): Promise<MediaResourceProjection> {
    return this.store.getResource({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaResourceId: this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID'),
    })
  }

  createReference(command: CreateMediaReferenceCommand): Promise<MediaReferenceProjection> {
    const targetType = this.targetType(command.targetType)
    if (!editableTargetTypes.has(targetType)) throw mediaError('MEDIA_REFERENCE_TARGET_READ_ONLY', 403)
    const normalized = Object.freeze({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaResourceId: this.uuid(command.mediaResourceId, 'MEDIA_RESOURCE_ID_INVALID'),
      targetType,
      targetId: this.uuid(command.targetId, 'MEDIA_TARGET_ID_INVALID'),
      role: this.role(command.role),
      altText: this.alt(command.altText),
      sortOrder: this.sortOrder(command.sortOrder),
      cropFocus: this.cropFocus(command.cropFocus),
      variant: this.variant(command.variant),
      operationId: this.operationId(command.clientRequestId),
      requestId: this.requestId(command.requestId),
    })
    return this.store.createReference({
      ...normalized,
      requestHash: this.hash(JSON.stringify({
        media_resource_id: normalized.mediaResourceId,
        target_type: normalized.targetType,
        target_id: normalized.targetId,
        role: normalized.role,
        alt_text: normalized.altText,
        sort_order: normalized.sortOrder,
        crop_focus: normalized.cropFocus,
        variant: normalized.variant,
      })),
      now: this.now(),
    })
  }

  listReferences(command: ListMediaReferencesCommand): Promise<MediaReferencePage> {
    return this.store.listReferences({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      targetType: this.targetType(command.targetType),
      targetId: this.uuid(command.targetId, 'MEDIA_TARGET_ID_INVALID'),
      role: command.role === null ? null : this.role(command.role),
      now: this.now(),
    })
  }

  patchReference(command: PatchMediaReferenceCommand): Promise<MediaReferenceProjection> {
    const expectedVersion = this.version(command.expectedVersion)
    const altText = this.alt(command.altText)
    const sortOrder = this.sortOrder(command.sortOrder)
    const cropFocus = this.cropFocus(command.cropFocus)
    const variant = this.variant(command.variant)
    const operationId = this.operationId(command.operationId)
    return this.store.patchReference({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaReferenceId: this.uuid(command.mediaReferenceId, 'MEDIA_REFERENCE_ID_INVALID'),
      expectedVersion,
      altText,
      sortOrder,
      cropFocus,
      variant,
      operationId,
      requestHash: this.hash(JSON.stringify({
        expected_version: expectedVersion,
        alt_text: altText,
        sort_order: sortOrder,
        crop_focus: cropFocus,
        variant,
      })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  deleteReference(command: DeleteMediaReferenceCommand): Promise<void> {
    const expectedVersion = this.version(command.expectedVersion)
    const operationId = this.operationId(command.operationId)
    return this.store.deleteReference({
      userId: this.uuid(command.userId, 'MEDIA_USER_INVALID'),
      mediaReferenceId: this.uuid(command.mediaReferenceId, 'MEDIA_REFERENCE_ID_INVALID'),
      expectedVersion,
      operationId,
      requestHash: this.hash(JSON.stringify({ expected_version: expectedVersion })),
      requestId: this.requestId(command.requestId),
      now: this.now(),
    })
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw mediaError(code, 422)
    }
    return value.toLowerCase()
  }

  private targetType(value: string): MediaTargetType {
    if (!mediaTargetTypes.includes(value as MediaTargetType)) {
      throw mediaError('MEDIA_TARGET_TYPE_INVALID', 422)
    }
    return value as MediaTargetType
  }

  private role(value: string): string {
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) throw mediaError('MEDIA_ROLE_INVALID', 422)
    return normalized
  }

  private alt(value: string): string {
    const normalized = Array.from(value)
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint < 32 || codePoint === 127 ? ' ' : character
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length < 1 || normalized.length > 200) throw mediaError('MEDIA_ALT_TEXT_INVALID', 422)
    return normalized
  }

  private sortOrder(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999) {
      throw mediaError('MEDIA_SORT_ORDER_INVALID', 422)
    }
    return value
  }

  private cropFocus(value: Readonly<Record<string, unknown>> | null): Readonly<Record<string, unknown>> | null {
    if (value === null) return null
    const encoded = JSON.stringify(value)
    if (encoded.length > 2_048) throw mediaError('MEDIA_CROP_FOCUS_INVALID', 422)
    const x = value.x
    const y = value.y
    if (
      Object.keys(value).some((key) => !['x', 'y'].includes(key)) ||
      typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 ||
      typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1
    ) throw mediaError('MEDIA_CROP_FOCUS_INVALID', 422)
    return Object.freeze({ x, y })
  }

  private variant(value: string | null): string | null {
    if (value === null) return null
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized)) {
      throw mediaError('MEDIA_VARIANT_INVALID', 422)
    }
    return normalized
  }

  private version(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw mediaError('MEDIA_VERSION_INVALID', 422)
    return value
  }

  private operationId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw mediaError('OPERATION_ID_INVALID', 422)
    return value
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw mediaError('REQUEST_ID_INVALID', 422)
    return value
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
