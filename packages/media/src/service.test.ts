import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MediaError } from './errors.js'
import { MediaService } from './service.js'
import type { MediaStore } from './store-port.js'
import type { MediaReferenceProjection } from './types.js'

const reference: MediaReferenceProjection = Object.freeze({
  media_reference_id: '91000000-0000-4000-8000-000000000001',
  media_resource_id: '91000000-0000-4000-8000-000000000002',
  target_type: 'submission_draft',
  target_id: '91000000-0000-4000-8000-000000000003',
  role: 'cover',
  alt_text: 'Cover',
  sort_order: 0,
  crop_focus: null,
  variant: null,
  source_media_reference_id: null,
  version: 1,
  created_at: '2026-08-13T12:00:00.000Z',
  updated_at: '2026-08-13T12:00:00.000Z',
})

class FakeStore implements MediaStore {
  createInput: Parameters<MediaStore['createReference']>[0] | null = null
  getResource(): never { throw new Error('not used') }
  async createReference(input: Parameters<MediaStore['createReference']>[0]) {
    this.createInput = input
    return reference
  }
  async listReferences() { return Object.freeze({ items: Object.freeze([]), total_count: 0 }) }
  async patchReference() { return reference }
  async deleteReference() {}
}

describe('MediaService', () => {
  it('normalizes editable draft reference metadata and hashes the idempotent payload', async () => {
    const store = new FakeStore()
    const service = new MediaService(store, () => new Date('2026-08-13T12:00:00.000Z'))
    await service.createReference({
      userId: '91000000-0000-4000-8000-000000000004',
      mediaResourceId: reference.media_resource_id,
      targetType: 'submission_draft',
      targetId: reference.target_id,
      role: ' Cover ',
      altText: '  Main\ncover  ',
      sortOrder: 0,
      cropFocus: Object.freeze({ x: 0.25, y: 0.75 }),
      variant: ' Hero.V1 ',
      clientRequestId: 'media-reference-request-0001',
      requestId: 'media-request-0001',
    })
    assert.equal(store.createInput?.role, 'cover')
    assert.equal(store.createInput?.altText, 'Main cover')
    assert.equal(store.createInput?.variant, 'hero.v1')
    assert.match(store.createInput?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('rejects formal targets and malformed crop focus before persistence', async () => {
    const service = new MediaService(new FakeStore())
    assert.throws(
      () => service.createReference({
        userId: '91000000-0000-4000-8000-000000000004',
        mediaResourceId: reference.media_resource_id,
        targetType: 'project_version',
        targetId: reference.target_id,
        role: 'cover', altText: 'Cover', sortOrder: 0, cropFocus: null, variant: null,
        clientRequestId: 'media-reference-request-0002', requestId: 'media-request-0002',
      }),
      (error: unknown) => error instanceof MediaError && error.code === 'MEDIA_REFERENCE_TARGET_READ_ONLY',
    )
    assert.throws(
      () => service.createReference({
        userId: '91000000-0000-4000-8000-000000000004',
        mediaResourceId: reference.media_resource_id,
        targetType: 'submission_draft',
        targetId: reference.target_id,
        role: 'cover', altText: 'Cover', sortOrder: 0,
        cropFocus: Object.freeze({ x: 2, y: 0 }), variant: null,
        clientRequestId: 'media-reference-request-0003', requestId: 'media-request-0003',
      }),
      (error: unknown) => error instanceof MediaError && error.code === 'MEDIA_CROP_FOCUS_INVALID',
    )
  })
})
