import type {
  AdminOperationImpact,
  AdminOperationTarget,
  ConfirmAdminOperationStoreResult,
  StoredAdminOperationPreview,
} from './admin-operation-types.js'
import type { ReviewActor } from './types.js'

export interface AdminOperationSecurityStore {
  createPreview(input: {
    readonly previewId: string
    readonly previewTokenHash: Buffer
    readonly primarySessionIdHash: Buffer
    readonly actor: ReviewActor
    readonly operationType: string
    readonly targets: readonly AdminOperationTarget[]
    readonly expectedVersions: Readonly<Record<string, number>>
    readonly proposedDiff: Readonly<Record<string, unknown>>
    readonly reasonCode: string
    readonly claimTokenHash: Buffer | null
    readonly expectedConflictPrincipalVersion: number | null
    readonly diffHash: string
    readonly impactHash: string
    readonly confirmationSummaryHash: string
    readonly impact: AdminOperationImpact
    readonly createdAt: Date
    readonly expiresAt: Date
    readonly requestId: string
  }): Promise<StoredAdminOperationPreview>
  confirmPreview(input: {
    readonly previewTokenHash: Buffer
    readonly primarySessionIdHash: Buffer
    readonly actor: ReviewActor
    readonly confirmationSummaryHash: string
    readonly confirmRequestId: string
    readonly confirmGrantId: string
    readonly confirmTokenHash: Buffer
    readonly reauthGrantId: string | null
    readonly expectedConflictPrincipalVersion: number | null
    readonly recentAuthWindowSeconds: number
    readonly confirmTtlSeconds: number
    readonly now: Date
    readonly requestId: string
  }): Promise<ConfirmAdminOperationStoreResult>
}
