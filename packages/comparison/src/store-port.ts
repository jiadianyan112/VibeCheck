import type {
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
}
