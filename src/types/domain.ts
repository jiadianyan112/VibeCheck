/** Branded identifiers prevent mixing unrelated domain ids in typed code. */
type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand }

export type ProjectId = Brand<string, 'ProjectId'>
export type CreatorId = Brand<string, 'CreatorId'>
export type VersionId = Brand<string, 'VersionId'>
export type LifecycleEventId = Brand<string, 'LifecycleEventId'>
export type AssetId = Brand<string, 'AssetId'>
export type RelationId = Brand<string, 'RelationId'>
export type EvidenceId = Brand<string, 'EvidenceId'>
export type ComparisonSessionId = Brand<string, 'ComparisonSessionId'>
export type DecisionRecordId = Brand<string, 'DecisionRecordId'>
export type SubmissionDraftId = Brand<string, 'SubmissionDraftId'>
export type VerificationRequestId = Brand<string, 'VerificationRequestId'>
export type NotificationId = Brand<string, 'NotificationId'>
export type UserId = Brand<string, 'UserId'>

export const projectId = (value: string) => value as ProjectId
export const creatorId = (value: string) => value as CreatorId
export const versionId = (value: string) => value as VersionId
export const lifecycleEventId = (value: string) => value as LifecycleEventId
export const assetId = (value: string) => value as AssetId
export const relationId = (value: string) => value as RelationId
export const evidenceId = (value: string) => value as EvidenceId
export const comparisonSessionId = (value: string) => value as ComparisonSessionId
export const decisionRecordId = (value: string) => value as DecisionRecordId
export const submissionDraftId = (value: string) => value as SubmissionDraftId
export const verificationRequestId = (value: string) => value as VerificationRequestId
export const notificationId = (value: string) => value as NotificationId
export const userId = (value: string) => value as UserId

export const accessStatuses = [
  'normal',
  'login_required',
  'pending_recheck',
  'partial_abnormal',
  'link_unavailable',
  'suspected_migration',
  'paused',
  'ended',
  'recovered',
  'unknown',
] as const
export type AccessStatus = (typeof accessStatuses)[number]

export const httpCheckStatuses = [
  'normal',
  'redirect',
  'timeout',
  'dns_error',
  'certificate_error',
  'blocked',
  'unknown',
] as const
export type HttpCheckStatus = (typeof httpCheckStatuses)[number]

export const lifecycleEventTypes = [
  'first_seen',
  'first_published',
  'version_updated',
  'domain_migrated',
  'product_pivoted',
  'link_abnormal',
  'recovered',
  'paused',
  'ended',
  'asset_added',
  'reused_by_project',
] as const
export type LifecycleEventType = (typeof lifecycleEventTypes)[number]

export const reviewStatuses = [
  'draft',
  'pending_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
  'published_platform',
  'published_author',
  'update_pending',
  'restricted',
  'archived',
  'deleted',
] as const
export type ReviewStatus = (typeof reviewStatuses)[number]

export const authorVerificationStatuses = [
  'draft',
  'pending',
  'changes_requested',
  'verified',
  'failed',
  'disputed',
  'withdrawn',
] as const
export type AuthorVerificationStatus = (typeof authorVerificationStatuses)[number]

export const evidenceTypes = [
  'platform_verified_fact',
  'verified_author_statement',
  'trusted_external_source',
  'system_inference',
] as const
export type EvidenceType = (typeof evidenceTypes)[number]

export const freshnessStatuses = ['valid', 'expiring', 'expired'] as const
export type FreshnessStatus = (typeof freshnessStatuses)[number]

export const disputeStatuses = [
  'none',
  'in_review',
  'resolved',
  'insufficient_evidence',
] as const
export type DisputeStatus = (typeof disputeStatuses)[number]

export const confidenceLevels = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof confidenceLevels)[number]

export interface FactMetadata {
  evidenceIds: EvidenceId[]
  freshness: FreshnessStatus
  lastVerifiedAt: string | null
  disputeStatus: DisputeStatus
  confidence: ConfidenceLevel | null
}

/**
 * Unknown is a first-class state. Consumers must render the reason and must not
 * synthesize a replacement value.
 */
export type FieldFact<T> =
  | ({ state: 'known'; value: T } & FactMetadata)
  | ({ state: 'unknown'; reason: string } & FactMetadata)

export const targetUsers = [
  'primary_students',
  'secondary_students',
  'university_students',
  'language_learners',
  'professional_exam_candidates',
  'teachers',
  'enterprise_learners',
  'other',
] as const
export type TargetUser = (typeof targetUsers)[number]

export const useScenarios = [
  'question_generation',
  'daily_practice',
  'mock_exam',
  'vocabulary_memory',
  'speaking_mock_exam',
  'dictation_training',
  'mistake_review',
  'knowledge_reinforcement',
] as const
export type UseScenario = (typeof useScenarios)[number]

export const inputTypes = [
  'pdf',
  'word',
  'ppt',
  'image',
  'webpage',
  'plain_text',
  'audio',
  'video',
  'preset_question_bank',
  'manual_entry',
] as const
export type InputType = (typeof inputTypes)[number]

export const outputTypes = [
  'questions',
  'practice_set',
  'exam',
  'score',
  'answer_explanation',
  'learning_report',
  'mistake_set',
  'flashcards',
] as const
export type OutputType = (typeof outputTypes)[number]

export const contentProcessingTypes = [
  'text_parsing',
  'ocr',
  'knowledge_extraction',
  'question_generation',
  'difficulty_grading',
  'answer_generation',
  'explanation_generation',
  'content_summarization',
] as const
export type ContentProcessingType = (typeof contentProcessingTypes)[number]

export const practiceFormats = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'fill_blank',
  'short_answer',
  'flashcard',
  'dictation',
  'spoken_response',
  'full_mock_exam',
] as const
export type PracticeFormat = (typeof practiceFormats)[number]

export const feedbackMethods = [
  'correctness',
  'answer_explanation',
  'knowledge_explanation',
  'ai_follow_up',
  'scoring',
  'mistake_book',
  'learning_suggestion',
] as const
export type FeedbackMethod = (typeof feedbackMethods)[number]

export const learningRecordTypes = [
  'practice_history',
  'accuracy',
  'progress',
  'mistakes',
  'spaced_repetition',
  'ability_analysis',
  'learning_report',
] as const
export type LearningRecordType = (typeof learningRecordTypes)[number]

export const aiCodingTools = [
  'cursor',
  'lovable',
  'bolt',
  'v0',
  'replit',
  'claude_code',
  'codex',
  'other',
  'unknown',
] as const
export type AiCodingTool = (typeof aiCodingTools)[number]

export const loginRequirements = [
  'none',
  'partial',
  'required',
  'unknown',
] as const
export type LoginRequirement = (typeof loginRequirements)[number]

export const sharingCapabilities = [
  'none',
  'link',
  'result',
  'question_bank',
  'collaboration',
  'unknown',
] as const
export type SharingCapability = (typeof sharingCapabilities)[number]

export const maintenanceSignals = [
  'repository_updated',
  'page_updated',
  'author_updated',
  'no_public_change',
  'unknown',
] as const
export type MaintenanceSignal = (typeof maintenanceSignals)[number]

export const assetTypes = [
  'source_code',
  'template',
  'component',
  'prompt',
  'parsing_solution',
  'open_api',
  'deployment_solution',
  'other',
] as const
export type AssetType = (typeof assetTypes)[number]

export const assetAvailabilityStatuses = [
  'available',
  'login_required',
  'link_abnormal',
  'removed',
  'unknown',
] as const
export type AssetAvailabilityStatus =
  (typeof assetAvailabilityStatuses)[number]

export const priceTypes = ['free', 'paid', 'contact', 'unknown'] as const
export type PriceType = (typeof priceTypes)[number]

export const relationTypes = [
  'similar',
  'alternative',
  'inspired_by',
  'fork',
  'remix',
  'migration',
  'derivative',
  'uses_asset',
] as const
export type RelationType = (typeof relationTypes)[number]

export const relationDirections = ['one_way', 'two_way'] as const
export type RelationDirection = (typeof relationDirections)[number]

export const relationConfirmationStatuses = [
  'pending',
  'one_party_confirmed',
  'both_parties_confirmed',
  'platform_confirmed',
  'disputed',
] as const
export type RelationConfirmationStatus =
  (typeof relationConfirmationStatuses)[number]

export const recordSources = [
  'platform_editor',
  'public_discovery',
  'author_submission',
  'user_submission',
] as const
export type RecordSource = (typeof recordSources)[number]

export const authorLinkStatuses = [
  'unlinked',
  'pending',
  'linked',
  'failed',
  'disputed',
] as const
export type AuthorLinkStatus = (typeof authorLinkStatuses)[number]

export const verificationMethods = [
  'domain_control',
  'repository',
  'original_account',
  'public_profile',
  'manual_material',
] as const
export type VerificationMethod = (typeof verificationMethods)[number]

export const completenessLevels = [
  'complete',
  'partial',
  'limited',
  'pending_verification',
  'disputed',
] as const
export type CompletenessLevel = (typeof completenessLevels)[number]

export interface MediaItem {
  id: string
  kind: 'image' | 'video' | 'placeholder'
  url: string | null
  alt: string
}

export interface FlowNode {
  id: string
  order: number
  label: string
  description: string
}

export interface HistoricalName {
  name: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface HistoricalUrl {
  url: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface Evidence {
  id: EvidenceId
  type: EvidenceType
  sourceUrl: string | null
  sourceSummary: string
  capturedAt: string
  verifiedAt: string
  confidence: ConfidenceLevel
  disputeStatus: DisputeStatus
  supports: {
    projectId: ProjectId
    fieldKey?: keyof Project
    eventId?: LifecycleEventId
    relationId?: RelationId
  }
}

export interface ProjectVersion {
  id: VersionId
  projectId: ProjectId
  name: string
  releasedAt: string
  summary: string
  evidenceIds: EvidenceId[]
}

export interface FieldChange {
  fieldKey: string
  before: unknown
  after: unknown
}

/** Historical events are append-only facts; they never replace current state. */
export interface LifecycleEvent {
  id: LifecycleEventId
  projectId: ProjectId
  type: LifecycleEventType
  happenedAt: string
  isEstimatedDate: boolean
  summary: string
  sourceType: EvidenceType
  evidenceIds: EvidenceId[]
  changes: FieldChange[]
  disputeStatus: DisputeStatus
}

export interface AssetPrice {
  type: PriceType
  amount?: number
  currency?: string
}

export interface ReusableAsset {
  id: AssetId
  projectId: ProjectId
  type: AssetType
  name: string
  description: string
  url: string
  license: string | null
  price: AssetPrice
  availabilityStatus: AssetAvailabilityStatus
  lastVerifiedAt: string | null
  evidenceIds: EvidenceId[]
}

export interface ProjectRelation {
  id: RelationId
  type: RelationType
  sourceProjectId: ProjectId
  targetProjectId: ProjectId
  direction: RelationDirection
  confirmationStatus: RelationConfirmationStatus
  summary: string
  evidenceIds: EvidenceId[]
}

export interface InteractionSummary {
  favoriteCount: number
  likeCount: number
  commentCount: number
  followerCount: number
}

export interface Project {
  id: ProjectId
  currentName: FieldFact<string>
  historicalNames: HistoricalName[]
  publicUrl: FieldFact<string>
  historicalUrls: HistoricalUrl[]
  repositoryUrl: FieldFact<string | null>
  originalPlatform: FieldFact<string | null>
  firstSeenAt: string
  createdAt: string
  coverMedia: MediaItem[]
  oneLineDefinition: FieldFact<string>
  targetUsers: FieldFact<TargetUser[]>
  coreProblem: FieldFact<string>
  useScenarios: FieldFact<UseScenario[]>
  mainInputs: FieldFact<InputType[]>
  mainOutputs: FieldFact<OutputType[]>
  coreFlow: FieldFact<FlowNode[]>
  contentProcessing: FieldFact<ContentProcessingType[]>
  practiceFormats: FieldFact<PracticeFormat[]>
  feedbackMethods: FieldFact<FeedbackMethod[]>
  learningRecords: FieldFact<LearningRecordType[]>
  differentiation: FieldFact<string>
  coreFeatures: FieldFact<string[]>
  secondaryFeatures: FieldFact<string[]>
  loginRequirement: FieldFact<LoginRequirement>
  sharingCapability: FieldFact<SharingCapability>
  aiCodingTools: FieldFact<AiCodingTool[]>
  modelsUsed: FieldFact<string[]>
  techStack: FieldFact<string[]>
  deploymentPlatform: FieldFact<string | null>
  developmentCycle: FieldFact<string | null>
  keyDependencies: FieldFact<string[]>
  /** Current public state. This is not the technical HTTP check result. */
  accessStatus: FieldFact<AccessStatus>
  /** Technical observation only; it cannot express paused, ended, or failure. */
  httpCheckStatus: HttpCheckStatus
  lastVerifiedAt: string
  maintenanceSignal: MaintenanceSignal
  statusNote: FieldFact<string | null>
  versionIds: VersionId[]
  eventIds: LifecycleEventId[]
  assetIds: AssetId[]
  relationIds: RelationId[]
  creatorIds: CreatorId[]
  recordSource: RecordSource
  authorLinkStatus: AuthorLinkStatus
  completenessLevel: CompletenessLevel
  freshnessStatus: FreshnessStatus
  interactionSummary: InteractionSummary
  reviewStatus: ReviewStatus
}

export interface CreatorContact {
  type: 'website' | 'email' | 'github' | 'social'
  label: string
  url: string
}

export interface Creator {
  id: CreatorId
  displayName: string
  avatarUrl: string | null
  bio: string
  contacts: CreatorContact[]
  verificationStatus: 'unverified' | 'verified' | 'disputed'
  publishedProjectIds: ProjectId[]
  linkedProjectIds: ProjectId[]
}

export const decisionActions = [
  'continue',
  'adjust',
  'reuse',
  'pause',
] as const
export type DecisionAction = (typeof decisionActions)[number]

export const affectedFields = [
  'target_users',
  'positioning',
  'features',
  'core_flow',
  'technical_path',
  'assets',
] as const
export type AffectedField = (typeof affectedFields)[number]

export interface DecisionRecord {
  id: DecisionRecordId
  sessionId: ComparisonSessionId
  userId: UserId
  projectIds: ProjectId[]
  action: DecisionAction
  affectedFields: AffectedField[]
  reason: string
  assetIds: AssetId[]
  createdAt: string
  visibility: 'private'
}

export interface ComparisonIntent {
  originalQuery: string
  targetUsers: TargetUser[]
  useScenarios: UseScenario[]
  inputs: InputType[]
  practiceFormats: PracticeFormat[]
  outputs: OutputType[]
}

export interface ComparisonSession {
  id: ComparisonSessionId
  ownerUserId: UserId | null
  intent: ComparisonIntent | null
  projectIds: ProjectId[]
  sourcePath: string
  decisionId: DecisionRecordId | null
  createdAt: string
  updatedAt: string
  savedAt: string | null
}

export interface SubmissionProjectFields {
  currentName: string
  publicUrl: string
  screenshotUrl: string | null
  accessStatus: AccessStatus
  repositoryUrl: string | null
  oneLineDefinition: string
  targetUsers: TargetUser[]
  coreProblem: string
  useScenarios: UseScenario[]
  mainInputs: InputType[]
  mainOutputs: OutputType[]
  coreFlow: FlowNode[]
  practiceFormats: PracticeFormat[]
  feedbackMethods: FeedbackMethod[]
  differentiation: string
  aiCodingTools: AiCodingTool[]
}

export interface SubmissionDraft {
  id: SubmissionDraftId
  userId: UserId
  status: ReviewStatus
  step: 'url' | 'prefill' | 'definition' | 'solution' | 'development' | 'preview'
  fields: Partial<SubmissionProjectFields>
  originalExtraction: Partial<SubmissionProjectFields>
  assetIds: AssetId[]
  duplicateProjectId: ProjectId | null
  validationErrors: Record<string, string>
  reviewMessages: Record<string, string>
  createdAt: string
  updatedAt: string
  submittedAt: string | null
}

export interface AuthorVerificationRequest {
  id: VerificationRequestId
  projectId: ProjectId
  userId: UserId
  method: VerificationMethod
  status: AuthorVerificationStatus
  materialSummary: string
  privateMaterialReference: string
  reviewMessage: string | null
  createdAt: string
  updatedAt: string
}

export const notificationTypes = [
  'project_updated',
  'comment_replied',
  'submission_reviewed',
  'verification_reviewed',
  'status_abnormal',
] as const
export type NotificationType = (typeof notificationTypes)[number]

export interface Notification {
  id: NotificationId
  userId: UserId
  type: NotificationType
  title: string
  body: string
  targetPath: string
  projectId: ProjectId | null
  eventId: LifecycleEventId | null
  isRead: boolean
  createdAt: string
}

export const userRoles = [
  'guest',
  'user',
  'verified_author',
  'editor',
  'admin',
] as const
export type UserRole = (typeof userRoles)[number]

export interface PrototypeUser {
  id: UserId
  displayName: string
  role: Exclude<UserRole, 'guest'>
  creatorId: CreatorId | null
}

export interface PrototypeSession {
  user: PrototypeUser | null
  role: UserRole
}

export const commentCategories = [
  'usage_feedback',
  'development_question',
  'reuse_feedback',
  'status_update',
] as const
export type CommentCategory = (typeof commentCategories)[number]

export const moderationStatuses = [
  'visible',
  'collapsed',
  'under_review',
  'hidden',
] as const
export type ModerationStatus = (typeof moderationStatuses)[number]

export interface ProjectComment {
  id: string
  projectId: ProjectId
  authorUserId: UserId
  category: CommentCategory
  body: string
  parentId: string | null
  moderationStatus: ModerationStatus
  reportCount: number
  createdAt: string
}

export interface UserAssets {
  userId: UserId
  favoriteProjectIds: ProjectId[]
  followedProjectIds: ProjectId[]
  recentProjectIds: ProjectId[]
  comparisonSessionIds: ComparisonSessionId[]
  decisionRecordIds: DecisionRecordId[]
  submissionDraftIds: SubmissionDraftId[]
  verificationRequestIds: VerificationRequestId[]
  notificationIds: NotificationId[]
}

export function isTerminalAccessStatus(status: AccessStatus) {
  return status === 'paused' || status === 'ended'
}

export function canBeProducedByTechnicalCheck(status: AccessStatus) {
  return (
    status === 'normal' ||
    status === 'pending_recheck' ||
    status === 'partial_abnormal' ||
    status === 'link_unavailable' ||
    status === 'suspected_migration' ||
    status === 'recovered' ||
    status === 'unknown'
  )
}
