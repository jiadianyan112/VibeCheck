import type {
  ReviewActor,
  ReviewTargetType,
  ReviewWorkItemProjection,
  ReviewWorkItemStatus,
  ReviewWorkType,
} from './types.js'

export interface ReviewQueueAnchor {
  readonly createdAt: Date
  readonly workItemId: string
}

export interface StoredReviewWorkItemPage {
  readonly items: readonly ReviewWorkItemProjection[]
  readonly totalCount: number
  readonly nextAnchor: ReviewQueueAnchor | null
}

export interface WorkflowStore {
  listWorkItems(input: {
    readonly actorUserId: string
    readonly workType: ReviewWorkType
    readonly targetType: ReviewTargetType | null
    readonly status: ReviewWorkItemStatus
    readonly anchor: ReviewQueueAnchor | null
    readonly limit: number
  }): Promise<StoredReviewWorkItemPage>
  claimWorkItem(input: {
    readonly actor: ReviewActor
    readonly workItemId: string
    readonly expectedVersion: number
    readonly expectedConflictPrincipalVersion: number | null
    readonly claimTokenHash: Buffer
    readonly leaseSeconds: number
    readonly now: Date
    readonly requestId: string
  }): Promise<ReviewWorkItemProjection>
  heartbeatWorkItem(input: {
    readonly actor: ReviewActor
    readonly workItemId: string
    readonly claimTokenHash: Buffer
    readonly leaseSeconds: number
    readonly maximumClaimSeconds: number
    readonly now: Date
    readonly requestId: string
  }): Promise<ReviewWorkItemProjection>
  releaseWorkItem(input: {
    readonly actor: ReviewActor
    readonly workItemId: string
    readonly claimTokenHash: Buffer
    readonly requestHash: string
    readonly reasonCode: string
    readonly allowAdminOverride: boolean
    readonly now: Date
    readonly requestId: string
  }): Promise<ReviewWorkItemProjection>
  requeueExpiredClaims(now: Date, limit: number): Promise<number>
}
