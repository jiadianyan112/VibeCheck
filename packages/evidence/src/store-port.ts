import type {
  EvidenceActor,
  EvidenceAttachmentDraftProjection,
  EvidenceAttachmentRole,
  EvidenceBindingProjection,
  EvidenceCollectorActorType,
  EvidenceDraftPatch,
  EvidenceDraftProjection,
  EvidenceFinalTargetKind,
  EvidenceParentType,
  EvidenceSourceChannel,
  EvidenceType,
  EvidenceVisibility,
} from './types.js'

export interface EvidenceUrlSafetyResolver {
  resolve(url: string): Promise<{
    readonly result: 'allowed' | 'uncertain' | 'blocked'
    readonly safeWebUrl: string | null
    readonly reasonCode: string | null
  }>
}

export interface EvidenceStore {
  createDraft(input: {
    readonly actor: EvidenceActor
    readonly collectorActorType: EvidenceCollectorActorType
    readonly parentType: EvidenceParentType
    readonly parentId: string
    readonly finalTargetKind: EvidenceFinalTargetKind
    readonly targetAssetDraftKey: string | null
    readonly fieldPath: string | null
    readonly requestedVisibility: EvidenceVisibility
    readonly evidenceType: EvidenceType
    readonly sourceChannel: EvidenceSourceChannel
    readonly clientRequestId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceDraftProjection>
  getDraft(input: {
    readonly actor: EvidenceActor
    readonly evidenceDraftId: string
    readonly now: Date
  }): Promise<EvidenceDraftProjection>
  patchDraft(input: {
    readonly actor: EvidenceActor
    readonly evidenceDraftId: string
    readonly expectedVersion: number
    readonly patch: EvidenceDraftPatch
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceDraftProjection>
  bindDraft(input: {
    readonly actor: EvidenceActor
    readonly evidenceDraftId: string
    readonly parentType: EvidenceParentType
    readonly parentId: string
    readonly expectedParentVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceBindingProjection>
  completeDraft(input: {
    readonly actor: EvidenceActor
    readonly evidenceDraftId: string
    readonly expectedVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceDraftProjection>
  createAttachment(input: {
    readonly actor: EvidenceActor
    readonly evidenceDraftId: string
    readonly mediaResourceId: string
    readonly role: EvidenceAttachmentRole
    readonly requestedVisibility: EvidenceVisibility
    readonly expectedDraftVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceAttachmentDraftProjection>
  deleteAttachment(input: {
    readonly actor: EvidenceActor
    readonly attachmentDraftId: string
    readonly expectedVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceAttachmentDraftProjection>
  withdrawDraft(input: {
    readonly actor: EvidenceActor
    readonly evidenceDraftId: string
    readonly expectedVersion: number
    readonly reasonCode: string
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<EvidenceDraftProjection>
}
