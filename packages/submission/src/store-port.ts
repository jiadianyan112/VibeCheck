import type {
  SubmissionCategoryId,
  SubmissionDraftProjection,
  SubmissionDuplicateCandidate,
  SubmissionSchemaVersion,
  SubmissionPreviewProjection,
  SubmissionProjection,
  SubmissionWithdrawalProjection,
  SubmissionUrlCheckProjection,
  UrlCheckAccessResult,
  UrlCheckRiskResult,
} from './types.js'

export interface SubmissionUrlSafetyResult {
  readonly result: 'allowed' | 'uncertain' | 'blocked'
  readonly safeWebUrl: string | null
  readonly redirectChain: readonly string[]
  readonly reasonCode: string | null
  readonly httpStatusCode?: number | null
}

export interface SubmissionUrlSafetyResolver {
  resolve(rawUrl: string): Promise<SubmissionUrlSafetyResult>
}

export interface SubmissionStore {
  getUrlCheckByRequest(input: {
    readonly userId: string
    readonly clientRequestId: string
  }): Promise<{ readonly requestHash: string; readonly projection: SubmissionUrlCheckProjection } | null>
  getReusableUrlCheck(input: {
    readonly userId: string
    readonly inputHash: string
    readonly now: Date
  }): Promise<SubmissionUrlCheckProjection | null>
  bindReusableUrlCheck(input: {
    readonly userId: string
    readonly clientRequestId: string
    readonly requestHash: string
    readonly checkId: string
    readonly now: Date
  }): Promise<SubmissionUrlCheckProjection>
  findDuplicateCandidates(input: {
    readonly canonicalUrlHash: Buffer
    readonly categoryId: SubmissionCategoryId
  }): Promise<readonly SubmissionDuplicateCandidate[]>
  saveUrlCheck(input: {
    readonly userId: string
    readonly categoryId: SubmissionCategoryId
    readonly schemaVersion: SubmissionSchemaVersion
    readonly inputHash: string
    readonly canonicalUrl: string | null
    readonly canonicalUrlHash: Buffer | null
    readonly redirectChain: readonly string[]
    readonly riskResult: UrlCheckRiskResult
    readonly accessResult: UrlCheckAccessResult
    readonly duplicateCandidates: readonly SubmissionDuplicateCandidate[]
    readonly riskReasons: readonly string[]
    readonly clientRequestId: string
    readonly requestHash: string
    readonly requestId: string
    readonly checkedAt: Date
    readonly expiresAt: Date
  }): Promise<SubmissionUrlCheckProjection>
  createDraft(input: {
    readonly userId: string
    readonly checkId: string
    readonly categoryId: SubmissionCategoryId
    readonly schemaVersion: SubmissionSchemaVersion
    readonly payloadSnapshot: Readonly<Record<string, unknown>>
    readonly clientRequestId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
    readonly expiresAt: Date
  }): Promise<SubmissionDraftProjection>
  getDraft(input: {
    readonly userId: string
    readonly draftId: string
    readonly now: Date
  }): Promise<SubmissionDraftProjection>
  patchDraft(input: {
    readonly userId: string
    readonly draftId: string
    readonly expectedVersion: number
    readonly patch: Readonly<Record<string, unknown>>
    readonly operationId: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<SubmissionDraftProjection>
  previewDraft(input: {
    readonly userId: string
    readonly draftId: string
    readonly expectedVersion: number
    readonly checkId: string
    readonly requestId: string
    readonly now: Date
  }): Promise<SubmissionPreviewProjection>
  submitDraft(input: {
    readonly userId: string
    readonly draftId: string
    readonly draftVersion: number
    readonly checkId: string
    readonly previewHash: string
    readonly submissionKey: string
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<SubmissionProjection>
  withdrawSubmission(input: {
    readonly userId: string
    readonly submissionId: string
    readonly expectedVersion: number
    readonly operationId: string
    readonly reasonCode: string | null
    readonly requestHash: string
    readonly requestId: string
    readonly now: Date
  }): Promise<SubmissionWithdrawalProjection>
}
