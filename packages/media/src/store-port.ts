import type {
  MediaReferencePage,
  MediaReferenceProjection,
  MediaResourceProjection,
  MediaTargetType,
  PublicMediaMime,
} from './types.js'

export interface StoredUploadResource {
  readonly projection: MediaResourceProjection
  readonly storageKey: string
  readonly uploadExpiresAt: Date
}

export interface StoredContentResource {
  readonly projection: MediaResourceProjection
  readonly storageKey: string
}

export interface MediaCompletionReceipt {
  readonly requestHash: string
  readonly response: unknown
}

export interface MediaCompletionResult {
  readonly projection: MediaResourceProjection
  readonly errorCode: 'MIME_MISMATCH' | 'CHECKSUM_MISMATCH' | null
}

export interface MediaStore {
  prepareResource(input: {
    readonly mediaResourceId: string
    readonly userId: string
    readonly purpose: 'project_cover'
    readonly storageKey: string
    readonly declaredMime: PublicMediaMime
    readonly byteSize: number
    readonly checksumSha256: string
    readonly idempotencyKey: string
    readonly requestHash: string
    readonly requestId: string
    readonly uploadExpiresAt: Date
    readonly now: Date
  }): Promise<StoredUploadResource>
  getUploadResource(input: {
    readonly userId: string
    readonly mediaResourceId: string
  }): Promise<StoredUploadResource>
  getContentResource(input: {
    readonly userId: string
    readonly mediaResourceId: string
  }): Promise<StoredContentResource>
  getCompletionReceipt(input: {
    readonly userId: string
    readonly mediaResourceId: string
    readonly operationId: string
  }): Promise<MediaCompletionReceipt | null>
  completeResource(input: {
    readonly userId: string
    readonly mediaResourceId: string
    readonly operationId: string
    readonly requestHash: string
    readonly uploadReceiptHash: string
    readonly detectedMime: string
    readonly detectedByteSize: number
    readonly detectedChecksumSha256: string | null
    readonly accepted: boolean
    readonly rejectionReason: 'MIME_MISMATCH' | 'CHECKSUM_MISMATCH' | null
    readonly processingDeadlineAt: Date
    readonly requestId: string
    readonly now: Date
  }): Promise<MediaCompletionResult>
  getResource(input: {
    readonly userId: string
    readonly mediaResourceId: string
  }): Promise<MediaResourceProjection>
  createReference(input: {
    readonly userId: string
    readonly mediaResourceId: string
    readonly targetType: MediaTargetType
    readonly targetId: string
    readonly role: string
    readonly altText: string
    readonly sortOrder: number
    readonly cropFocus: Readonly<Record<string, unknown>> | null
    readonly variant: string | null
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<MediaReferenceProjection>
  listReferences(input: {
    readonly userId: string
    readonly targetType: MediaTargetType
    readonly targetId: string
    readonly role: string | null
    readonly now: Date
  }): Promise<MediaReferencePage>
  patchReference(input: {
    readonly userId: string
    readonly mediaReferenceId: string
    readonly expectedVersion: number
    readonly altText: string
    readonly sortOrder: number
    readonly cropFocus: Readonly<Record<string, unknown>> | null
    readonly variant: string | null
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<MediaReferenceProjection>
  deleteReference(input: {
    readonly userId: string
    readonly mediaReferenceId: string
    readonly expectedVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<void>
}
