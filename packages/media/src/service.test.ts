import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MediaError } from './errors.js'
import { MediaService } from './service.js'
import type { MediaStore } from './store-port.js'
import type { MediaReferenceProjection } from './types.js'
import type { MediaResourceProjection, MediaStorage } from './types.js'

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

const uploading: MediaResourceProjection = Object.freeze({
  media_resource_id: '91000000-0000-4000-8000-000000000005',
  declared_mime: 'image/png', detected_mime: null, byte_size: 1024,
  width: null, height: null, duration_ms: null, checksum_sha256: 'a'.repeat(64),
  source: 'upload', status: 'uploading', scan_result: 'not_scanned',
  rejection_reason_code: null, scan_attempt_count: 0, next_scan_at: null,
  exif_removed: false, deletion_guard_active: false, version: 1,
  created_at: '2026-08-13T12:00:00.000Z', updated_at: '2026-08-13T12:00:00.000Z',
})

class FakeStore implements MediaStore {
  createInput: Parameters<MediaStore['createReference']>[0] | null = null
  async prepareResource(input: Parameters<MediaStore['prepareResource']>[0]): ReturnType<MediaStore['prepareResource']> { void input; throw new Error('not used') }
  async getUploadResource(input: Parameters<MediaStore['getUploadResource']>[0]): ReturnType<MediaStore['getUploadResource']> { void input; throw new Error('not used') }
  async getContentResource(input: Parameters<MediaStore['getContentResource']>[0]): ReturnType<MediaStore['getContentResource']> { void input; throw new Error('not used') }
  getCompletionReceipt(input: Parameters<MediaStore['getCompletionReceipt']>[0]): Promise<null> { void input; return Promise.resolve(null) }
  async completeResource(input: Parameters<MediaStore['completeResource']>[0]): ReturnType<MediaStore['completeResource']> { void input; throw new Error('not used') }
  getResource(): never { throw new Error('not used') }
  async createReference(input: Parameters<MediaStore['createReference']>[0]) {
    this.createInput = input
    return reference
  }
  async listReferences() { return Object.freeze({ items: Object.freeze([]), total_count: 0 }) }
  async patchReference() { return reference }
  async deleteReference() {}
}

class UploadStore extends FakeStore {
  preparedInput: Parameters<MediaStore['prepareResource']>[0] | null = null
  completedInput: Parameters<MediaStore['completeResource']>[0] | null = null
  async prepareResource(input: Parameters<MediaStore['prepareResource']>[0]) {
    this.preparedInput = input
    return Object.freeze({
      projection: Object.freeze({ ...uploading, media_resource_id: input.mediaResourceId }),
      storageKey: input.storageKey, uploadExpiresAt: input.uploadExpiresAt,
    })
  }
  async getUploadResource() {
    return Object.freeze({
      projection: uploading,
      storageKey: `quarantine/91000000-0000-4000-8000-000000000004/${uploading.media_resource_id}`,
      uploadExpiresAt: new Date('2026-08-13T12:15:00.000Z'),
    })
  }
  async getContentResource() {
    return Object.freeze({
      projection: Object.freeze({
        ...uploading, status: 'ready' as const, scan_result: 'clean' as const,
        detected_mime: 'image/png', width: 1200, height: 800, exif_removed: true, version: 3,
      }),
      storageKey: `ready/91000000-0000-4000-8000-000000000004/${uploading.media_resource_id}`,
    })
  }
  async completeResource(input: Parameters<MediaStore['completeResource']>[0]) {
    this.completedInput = input
    return Object.freeze({
      projection: Object.freeze({ ...uploading, status: 'uploaded' as const, detected_mime: 'image/png', version: 2 }),
      errorCode: null,
    })
  }
}

const uploadStorage: MediaStorage = Object.freeze({
  async issueUpload(input: Parameters<MediaStorage['issueUpload']>[0]) {
    return Object.freeze({
      uploadUrl: 'https://storage.example/upload',
      uploadHeaders: Object.freeze({
        'content-type': input.declaredMime, 'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from(input.checksumSha256, 'hex').toString('base64'),
        'x-amz-server-side-encryption': 'AES256', 'x-amz-tagging': 'VibeCheckAccess=quarantined',
      }),
    })
  },
  async inspectUpload() {
    return Object.freeze({ detectedMime: 'image/png', byteSize: 1024, checksumSha256: 'a'.repeat(64) })
  },
  async issueRead() { return Object.freeze({ readUrl: 'https://storage.example/read' }) },
})

describe('MediaService', () => {
  it('prepares and completes a quarantined cover without exposing storage keys', async () => {
    const store = new UploadStore()
    const service = new MediaService(store, uploadStorage, () => new Date('2026-08-13T12:00:00.000Z'))
    const prepared = await service.prepareResource({
      userId: '91000000-0000-4000-8000-000000000004', purpose: 'project_cover',
      declaredMime: 'image/png', byteSize: 1024, checksumSha256: 'A'.repeat(64),
      idempotencyKey: 'media-upload-prepare-0001', requestId: 'media-request-upload-0001',
    })
    assert.equal(prepared.media.status, 'uploading')
    assert.equal('storage_key' in prepared.media, false)
    assert.match(store.preparedInput?.storageKey ?? '', /^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/)

    const completed = await service.completeResource({
      userId: '91000000-0000-4000-8000-000000000004',
      mediaResourceId: uploading.media_resource_id, checksumSha256: 'a'.repeat(64),
      uploadReceipt: 'fixture-etag', operationId: 'media-upload-complete-0001',
      requestId: 'media-request-upload-0002',
    })
    assert.equal(completed.scan_queued, true)
    assert.equal(completed.media.status, 'uploaded')
    assert.equal(store.completedInput?.accepted, true)
    const content = await service.readResourceContent({
      userId: '91000000-0000-4000-8000-000000000004',
      mediaResourceId: uploading.media_resource_id, requestId: 'media-request-upload-0005',
    })
    assert.equal(content.redirect_url, 'https://storage.example/read')
  })

  it('rejects oversized or unsupported public cover inputs before storage', async () => {
    const service = new MediaService(new UploadStore(), uploadStorage)
    await assert.rejects(
      service.prepareResource({
        userId: '91000000-0000-4000-8000-000000000004', purpose: 'project_cover',
        declaredMime: 'image/gif', byteSize: 1, checksumSha256: 'a'.repeat(64),
        idempotencyKey: 'media-upload-prepare-0002', requestId: 'media-request-upload-0003',
      }),
      (error: unknown) => error instanceof MediaError && error.code === 'MEDIA_MIME_UNSUPPORTED',
    )
    await assert.rejects(
      service.prepareResource({
        userId: '91000000-0000-4000-8000-000000000004', purpose: 'project_cover',
        declaredMime: 'image/png', byteSize: 5_242_881, checksumSha256: 'a'.repeat(64),
        idempotencyKey: 'media-upload-prepare-0003', requestId: 'media-request-upload-0004',
      }),
      (error: unknown) => error instanceof MediaError && error.code === 'MEDIA_SIZE_INVALID',
    )
  })
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
