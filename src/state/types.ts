import type { ServiceScenarioId } from '../services'
import type {
  ComparisonSession,
  DecisionRecord,
  Notification,
  ProjectId,
  PrototypeSession,
  PrototypeUser,
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
  likedProjectIds: ProjectId[]
  comparisonSessions: ComparisonSession[]
  favoriteProjectIds: ProjectId[]
  followedProjectIds: ProjectId[]
  recentProjectIds: ProjectId[]
  decisionRecords: DecisionRecord[]
  submissionDrafts: SubmissionDraft[]
  notifications: Notification[]
  pendingAction: PendingAction | null
  lastReplayedActionId: string | null
  serviceScenario: ServiceScenarioId
  eventLog: PrototypeEvent[]
}

export type AppAction =
  | { type: 'COMPARISON_ADD'; projectId: ProjectId }
  | { type: 'COMPARISON_REMOVE'; projectId: ProjectId }
  | { type: 'COMPARISON_REPLACE'; removeId: ProjectId; addId: ProjectId }
  | { type: 'COMPARISON_CLEAR' }
  | { type: 'FAVORITE_TOGGLE'; projectId: ProjectId }
  | { type: 'LIKE_TOGGLE'; projectId: ProjectId }
  | { type: 'FOLLOW_TOGGLE'; projectId: ProjectId }
  | { type: 'RECENT_PROJECT_ADD'; projectId: ProjectId }
  | { type: 'LOGIN_COMPLETED'; user: PrototypeUser; userComparisonProjectIds?: ProjectId[] }
  | { type: 'LOGOUT' }
  | { type: 'PENDING_ACTION_QUEUE'; action: PendingAction }
  | { type: 'PENDING_ACTION_REPLAY' }
  | { type: 'PENDING_ACTION_CLEAR' }
  | { type: 'DECISION_SAVE'; decision: DecisionRecord }
  | { type: 'DRAFT_UPSERT'; draft: SubmissionDraft }
  | { type: 'NOTIFICATION_MARK_READ'; notificationId: Notification['id'] }
  | { type: 'SCENARIO_SET'; scenario: ServiceScenarioId }
  | { type: 'EVENT_LOGGED'; event: PrototypeEvent }
  | { type: 'RESET'; state: AppState }
