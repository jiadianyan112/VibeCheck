import type {
  MediaReferencePage,
  MediaReferenceProjection,
  MediaResourceProjection,
  MediaTargetType,
} from './types.js'

export interface MediaStore {
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
