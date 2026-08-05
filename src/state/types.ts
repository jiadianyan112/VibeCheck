import type { ServiceScenarioId } from '../services'
import type {
  ComparisonSession,
  DecisionRecord,
  AuthorVerificationRequest,
  LifecycleEvent,
  Project,
  ProjectUpdateRecord,
  ProjectUpdateDraft,
  ReusableAsset,
  Notification,
  ProjectId,
  PrototypeSession,
  PrototypeUser,
  UserId,
  SubmissionDraft,
} from '../types'

export const prototypeEventNames = [
  'home_viewed',
  'feed_item_clicked',
  'project_viewed',
  'project_favorited',
  'project_liked',
  'project_followed',
  'comment_created',
  'search_submitted',
  'intent_confirmed',
  'comparison_added',
  'comparison_started',
  'comparison_completed',
  'asset_clicked',
  'decision_submitted',
  'project_submitted',
  'author_verification_started',
  'author_verification_completed',
  'project_updated',
  'auth_completed',
  'prototype_reset',
] as const
export type PrototypeEventName = (typeof prototypeEventNames)[number]

export interface PrototypeEvent {
  id: string
  name: PrototypeEventName
  happenedAt: string
  payload: Record<string, string | number | boolean | null>
}

export type PendingAction =
  | {
      id: string
      kind: 'favorite' | 'follow'
      projectId: ProjectId
      sourcePath: string
    }
  | {
      id: string
      kind: 'comment' | 'decision'
      sourcePath: string
      payload: Record<string, string>
    }

export interface AppState {
  schemaVersion: 1
  session: PrototypeSession
  comparisonProjectIds: ProjectId[]
  activeComparisonSessionId: ComparisonSession['id'] | null
  likedProjectIds: ProjectId[]
  comparisonSessions: ComparisonSession[]
  favoriteProjectIds: ProjectId[]
  followedProjectIds: ProjectId[]
  recentProjectIds: ProjectId[]
  decisionRecords: DecisionRecord[]
  submissionDrafts: SubmissionDraft[]
  verificationRequests: AuthorVerificationRequest[]
  projectOverrides: Project[]
  lifecycleEventAdditions: LifecycleEvent[]
  reusableAssetAdditions: ReusableAsset[]
  projectUpdateRecords: ProjectUpdateRecord[]
  projectUpdateDrafts: ProjectUpdateDraft[]
  submissionEntryValue: string
  notifications: Notification[]
  pendingAction: PendingAction | null
  lastReplayedActionId: string | null
  serviceScenario: ServiceScenarioId
  eventLog: PrototypeEvent[]
}

export type LoginAssets = Pick<
  AppState,
  | 'comparisonSessions'
  | 'favoriteProjectIds'
  | 'followedProjectIds'
  | 'recentProjectIds'
  | 'decisionRecords'
  | 'submissionDrafts'
  | 'verificationRequests'
  | 'notifications'
>

export type AppAction =
  | { type: 'COMPARISON_ADD'; projectId: ProjectId }
  | { type: 'COMPARISON_REMOVE'; projectId: ProjectId }
  | { type: 'COMPARISON_REPLACE'; removeId: ProjectId; addId: ProjectId }
  | { type: 'COMPARISON_CLEAR' }
  | { type: 'COMPARISON_REORDER'; projectId: ProjectId; direction: -1 | 1 }
  | { type: 'COMPARISON_SESSION_SAVE' }
  | { type: 'COMPARISON_SESSION_RESTORE'; sessionId: ComparisonSession['id'] }
  | { type: 'FAVORITE_TOGGLE'; projectId: ProjectId }
  | { type: 'LIKE_TOGGLE'; projectId: ProjectId }
  | { type: 'FOLLOW_TOGGLE'; projectId: ProjectId }
  | { type: 'RECENT_PROJECT_ADD'; projectId: ProjectId }
  | { type: 'LOGIN_COMPLETED'; user: PrototypeUser; userComparisonProjectIds?: ProjectId[]; assets?: LoginAssets }
  | { type: 'LOGOUT' }
  | { type: 'PENDING_ACTION_QUEUE'; action: PendingAction }
  | { type: 'PENDING_ACTION_REPLAY' }
  | { type: 'PENDING_ACTION_CLEAR' }
  | { type: 'DECISION_SAVE'; decision: DecisionRecord }
  | { type: 'DRAFT_UPSERT'; draft: SubmissionDraft }
  | { type: 'VERIFICATION_UPSERT'; request: AuthorVerificationRequest }
  | { type: 'PROJECT_UPDATE_APPLY'; project: Project; event: LifecycleEvent; record: ProjectUpdateRecord; asset?: ReusableAsset; notifications: Notification[] }
  | { type: 'PROJECT_UPDATE_DRAFT_UPSERT'; draft: ProjectUpdateDraft }
  | { type: 'SUBMISSION_ENTRY_VALUE_SET'; value: string }
  | { type: 'NOTIFICATION_MARK_READ'; notificationId: Notification['id'] }
  | { type: 'NOTIFICATIONS_MARK_ALL_READ'; userId: UserId }
  | { type: 'SCENARIO_SET'; scenario: ServiceScenarioId }
  | { type: 'EVENT_LOGGED'; event: PrototypeEvent }
  | { type: 'RESET'; state: AppState }
