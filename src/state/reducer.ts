import { createPrototypeEvent } from './eventLogger'
import type { AppAction, AppState, PrototypeEvent } from './types'

function toggle<T>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function uniqueLimit<T>(values: T[], limit: number) {
  return [...new Set(values)].slice(0, limit)
}

function appendEvent(state: AppState, event: PrototypeEvent) {
  return [...state.eventLog, event].slice(-200)
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'COMPARISON_ADD': {
      if (
        state.comparisonProjectIds.includes(action.projectId) ||
        state.comparisonProjectIds.length >= 5
      ) {
        return state
      }
      return {
        ...state,
        comparisonProjectIds: [...state.comparisonProjectIds, action.projectId],
        eventLog: appendEvent(
          state,
          createPrototypeEvent('comparison_added', { projectId: action.projectId }),
        ),
      }
    }
    case 'COMPARISON_REMOVE':
      return {
        ...state,
        comparisonProjectIds: state.comparisonProjectIds.filter(
          (id) => id !== action.projectId,
        ),
      }
    case 'COMPARISON_REPLACE':
      return {
        ...state,
        comparisonProjectIds: uniqueLimit(
          state.comparisonProjectIds.map((id) =>
            id === action.removeId ? action.addId : id,
          ),
          5,
        ),
      }
    case 'COMPARISON_CLEAR':
      return { ...state, comparisonProjectIds: [] }
    case 'FAVORITE_TOGGLE': {
      const willAdd = !state.favoriteProjectIds.includes(action.projectId)
      return {
        ...state,
        favoriteProjectIds: toggle(state.favoriteProjectIds, action.projectId),
        eventLog: willAdd
          ? appendEvent(
              state,
              createPrototypeEvent('project_favorited', {
                projectId: action.projectId,
              }),
            )
          : state.eventLog,
      }
    }
    case 'FOLLOW_TOGGLE': {
      const willAdd = !state.followedProjectIds.includes(action.projectId)
      return {
        ...state,
        followedProjectIds: toggle(state.followedProjectIds, action.projectId),
        eventLog: willAdd
          ? appendEvent(
              state,
              createPrototypeEvent('project_followed', {
                projectId: action.projectId,
              }),
            )
          : state.eventLog,
      }
    }
    case 'RECENT_PROJECT_ADD':
      return {
        ...state,
        recentProjectIds: uniqueLimit(
          [action.projectId, ...state.recentProjectIds],
          20,
        ),
      }
    case 'LOGIN_COMPLETED':
      return {
        ...state,
        session: { user: action.user, role: action.user.role },
        comparisonProjectIds: uniqueLimit(
          [...state.comparisonProjectIds, ...(action.userComparisonProjectIds ?? [])],
          5,
        ),
        eventLog: appendEvent(
          state,
          createPrototypeEvent('auth_completed', {
            userId: action.user.id,
            role: action.user.role,
          }),
        ),
      }
    case 'LOGOUT':
      return {
        ...state,
        session: { user: null, role: 'guest' },
        favoriteProjectIds: [],
        followedProjectIds: [],
        decisionRecords: [],
        submissionDrafts: [],
        notifications: [],
        pendingAction: null,
      }
    case 'PENDING_ACTION_QUEUE':
      return { ...state, pendingAction: action.action }
    case 'PENDING_ACTION_CLEAR':
      return { ...state, pendingAction: null }
    case 'PENDING_ACTION_REPLAY': {
      const pending = state.pendingAction
      if (!pending || pending.id === state.lastReplayedActionId) {
        return state
      }
      let nextState = state
      if (pending.kind === 'favorite') {
        nextState = state.favoriteProjectIds.includes(pending.projectId)
          ? state
          : appReducer(state, {
              type: 'FAVORITE_TOGGLE',
              projectId: pending.projectId,
            })
      }
      if (pending.kind === 'follow') {
        nextState = state.followedProjectIds.includes(pending.projectId)
          ? state
          : appReducer(state, {
              type: 'FOLLOW_TOGGLE',
              projectId: pending.projectId,
            })
      }
      return {
        ...nextState,
        pendingAction: null,
        lastReplayedActionId: pending.id,
      }
    }
    case 'DECISION_SAVE': {
      const exists = state.decisionRecords.some(
        (decision) => decision.id === action.decision.id,
      )
      return {
        ...state,
        decisionRecords: exists
          ? state.decisionRecords.map((decision) =>
              decision.id === action.decision.id ? action.decision : decision,
            )
          : [...state.decisionRecords, action.decision],
        eventLog: appendEvent(
          state,
          createPrototypeEvent('decision_submitted', {
            decisionId: action.decision.id,
            action: action.decision.action,
          }),
        ),
      }
    }
    case 'DRAFT_UPSERT': {
      const exists = state.submissionDrafts.some(
        (draft) => draft.id === action.draft.id,
      )
      return {
        ...state,
        submissionDrafts: exists
          ? state.submissionDrafts.map((draft) =>
              draft.id === action.draft.id ? action.draft : draft,
            )
          : [...state.submissionDrafts, action.draft],
      }
    }
    case 'NOTIFICATION_MARK_READ':
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.notificationId
            ? { ...notification, isRead: true }
            : notification,
        ),
      }
    case 'SCENARIO_SET':
      return { ...state, serviceScenario: action.scenario }
    case 'EVENT_LOGGED':
      return { ...state, eventLog: appendEvent(state, action.event) }
    case 'RESET':
      return {
        ...action.state,
        eventLog: [createPrototypeEvent('prototype_reset')],
      }
  }
}
