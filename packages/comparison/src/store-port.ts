import type {
  ComparisonLoginMergeProjection,
  ComparisonMergeCancellationProjection,
  ComparisonMergeConflictProjection,
  ComparisonMergeResolutionProjection,
  ComparisonMutationProjection,
  ComparisonProgressProjection,
  ComparisonProjection,
  ComparisonSubject,
} from './types.js'

export interface ComparisonStoreOwner {
  readonly subject: ComparisonSubject
  readonly subjectHash: Buffer
}

export interface ComparisonStore {
  getComparison(input: ComparisonStoreOwner & {
    readonly comparisonId: string
    readonly now: Date
  }): Promise<ComparisonProjection>
  putComparison(input: ComparisonStoreOwner & {
    readonly comparisonId: string
    readonly orderedProjectIds: readonly string[]
    readonly expectedVersion: number
    readonly clientRequestId: string
    readonly requestHash: string
    readonly anonymousExpiresAt: Date
    readonly now: Date
  }): Promise<ComparisonMutationProjection>
  setSaved(input: ComparisonStoreOwner & {
    readonly comparisonId: string
    readonly comparisonVersion: number
    readonly state: boolean
    readonly requestId: string
    readonly now: Date
  }): Promise<ComparisonProjection>
  recordDimensionProgress(input: ComparisonStoreOwner & {
    readonly eventId: string
    readonly comparisonId: string
    readonly comparisonVersion: number
    readonly dimensionGroup: string
    readonly visibleMs: number
    readonly viewSequence: number
    readonly occurredAt: Date
    readonly now: Date
  }): Promise<ComparisonProgressProjection>
  prepareLoginMerge(input: {
    readonly userId: string
    readonly userSubjectHash: Buffer
    readonly anonymousSubjectId: string
    readonly anonymousSubjectHash: Buffer
    readonly identityLinkId: string
    readonly operationId: string
    readonly adoptedComparisonId: string
    readonly conflictId: string
    readonly now: Date
  }): Promise<ComparisonLoginMergeProjection>
  getMergeConflict(input: ComparisonStoreOwner & {
    readonly conflictId: string
    readonly now: Date
  }): Promise<ComparisonMergeConflictProjection>
  resolveMergeConflict(input: ComparisonStoreOwner & {
    readonly conflictId: string
    readonly selectedProjectIds: readonly string[]
    readonly accountVersion: number
    readonly anonymousVersion: number
    readonly expectedConflictVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<ComparisonMergeResolutionProjection>
  cancelMergeConflict(input: ComparisonStoreOwner & {
    readonly conflictId: string
    readonly cancelReason: string
    readonly expectedConflictVersion: number
    readonly operationId: string
    readonly requestHash: string
    readonly now: Date
  }): Promise<ComparisonMergeCancellationProjection>
}
