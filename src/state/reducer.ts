import { createPrototypeEvent } from './eventLogger'
import { addComparisonProject, createComparisonSession, mergeComparisonProjects, removeComparisonProject, reorderComparisonProject, replaceComparisonProject, saveComparisonSession, updateComparisonProjects } from '../features/comparison/session'
import { completeDecisionDraft, deserializeDecisionDraft } from '../features/comparison/decision'
import { comparisonSessionId } from '../types'
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

function updateActiveComparison(state: AppState, update: (session: AppState['comparisonSessions'][number]) => AppState['comparisonSessions'][number]) {
  const activeId = state.activeComparisonSessionId ?? comparisonSessionId('comparison-local-current')
  const existing = state.comparisonSessions.find((session) => session.id === activeId)
  const current = existing
    ? updateComparisonProjects(existing, state.comparisonProjectIds)
    : createComparisonSession({ id: activeId, projectIds: state.comparisonProjectIds, sourcePath: '/compare/current' })
  const next = update(current)
  return {
    ...state,
    activeComparisonSessionId: activeId,
    comparisonProjectIds: next.projectIds,
    comparisonSessions: existing ? state.comparisonSessions.map((session) => session.id === activeId ? next : session) : [...state.comparisonSessions, next],
  }
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
        ...updateActiveComparison(state, (session) => addComparisonProject(session, action.projectId)),
        eventLog: appendEvent(
          state,
          createPrototypeEvent('comparison_added', { projectId: action.projectId }),
        ),
      }
    }
    case 'COMPARISON_REMOVE':
      return updateActiveComparison(state, (session) => removeComparisonProject(session, action.projectId))
    case 'COMPARISON_REPLACE':
      return updateActiveComparison(state, (session) => replaceComparisonProject(session, action.removeId, action.addId))
    case 'COMPARISON_CLEAR':
      return updateActiveComparison(state, (session) => updateComparisonProjects(session, []))
    case 'COMPARISON_REORDER':
      return updateActiveComparison(state, (session) => reorderComparisonProject(session, action.projectId, action.direction))
    case 'COMPARISON_SESSION_SAVE':
      return updateActiveComparison(state, (session) => saveComparisonSession(session, state.session.user?.id ?? null))
    case 'COMPARISON_SESSION_RESTORE': {
      const session = state.comparisonSessions.find(({ id }) => id === action.sessionId)
      return session ? { ...state, activeComparisonSessionId: session.id, comparisonProjectIds: session.projectIds } : state
    }
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
    case 'LIKE_TOGGLE': {
      const willAdd = !state.likedProjectIds.includes(action.projectId)
      return {
        ...state,
        likedProjectIds: toggle(state.likedProjectIds, action.projectId),
        eventLog: willAdd
          ? appendEvent(state, createPrototypeEvent('project_liked', { projectId: action.projectId }))
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
    case 'LOGIN_COMPLETED': {
      const loginSessions = action.assets?.comparisonSessions ?? []
      const comparisonSessions = [
        ...state.comparisonSessions.filter((session) => !loginSessions.some(({ id }) => id === session.id)),
        ...loginSessions,
      ]
      const preferredSessionId = loginSessions[0]?.id ?? comparisonSessionId(`comparison-${action.user.id}-current`)
      const loginBase = {
        ...state,
        comparisonSessions,
        activeComparisonSessionId: preferredSessionId,
      }
      const userProjectIds = action.userComparisonProjectIds ?? loginSessions.flatMap((session) => session.projectIds)
      return {
        ...updateActiveComparison(loginBase, (session) => mergeComparisonProjects(session, userProjectIds, action.user.id)),
        session: { user: action.user, role: action.user.role },
        favoriteProjectIds: action.assets?.favoriteProjectIds ?? state.favoriteProjectIds,
        followedProjectIds: action.assets?.followedProjectIds ?? state.followedProjectIds,
        recentProjectIds: action.assets?.recentProjectIds ?? state.recentProjectIds,
        decisionRecords: action.assets?.decisionRecords ?? state.decisionRecords,
        submissionDrafts: action.assets?.submissionDrafts ?? state.submissionDrafts,
        verificationRequests: action.assets?.verificationRequests ?? state.verificationRequests,
        notifications: action.assets?.notifications ?? state.notifications,
        eventLog: appendEvent(
          state,
          createPrototypeEvent('auth_completed', {
            userId: action.user.id,
            role: action.user.role,
          }),
        ),
      }
    }
    case 'LOGOUT': {
      const anonymousSessions = state.comparisonSessions.filter((session) => session.ownerUserId === null)
      const activeAnonymousSession = anonymousSessions[0]
      return {
        ...state,
        session: { user: null, role: 'guest' },
        comparisonProjectIds: activeAnonymousSession?.projectIds ?? [],
        activeComparisonSessionId: activeAnonymousSession?.id ?? null,
        comparisonSessions: state.comparisonSessions,
        favoriteProjectIds: [],
        followedProjectIds: [],
        recentProjectIds: [],
        decisionRecords: [],
        submissionDrafts: [],
        verificationRequests: [],
        projectUpdateDrafts: [],
        submissionEntryValue: '',
        notifications: [],
        pendingAction: null,
      }
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
      if (pending.kind === 'decision' && state.session.user) {
        const draft = deserializeDecisionDraft(pending.payload)
        if (draft) nextState = appReducer(state, { type: 'DECISION_SAVE', decision: completeDecisionDraft(draft, state.session.user.id) })
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
      if (exists) return state
      const comparisonSessions = state.comparisonSessions.map((session) => session.id === action.decision.sessionId
        ? { ...saveComparisonSession(session, action.decision.userId, action.decision.createdAt), decisionId: action.decision.id }
        : session)
      return {
        ...state,
        comparisonSessions,
        decisionRecords: [...state.decisionRecords, action.decision],
        eventLog: appendEvent({ ...state, eventLog: appendEvent(state, createPrototypeEvent('decision_submitted', {
            decisionId: action.decision.id,
            action: action.decision.action,
          })) }, createPrototypeEvent('comparison_completed', {
            sessionId: action.decision.sessionId,
            decisionId: action.decision.id,
          })),
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
    case 'VERIFICATION_UPSERT': {
      const exists = state.verificationRequests.some((request) => request.id === action.request.id)
      return {
        ...state,
        verificationRequests: exists
          ? state.verificationRequests.map((request) => request.id === action.request.id ? action.request : request)
          : [...state.verificationRequests, action.request],
      }
    }
    case 'PROJECT_UPDATE_APPLY': {
      if (state.projectUpdateRecords.some((record) => record.id === action.record.id)) return state
      const hasProject = state.projectOverrides.some((project) => project.id === action.project.id)
      return {
        ...state,
        projectOverrides: hasProject
          ? state.projectOverrides.map((project) => project.id === action.project.id ? action.project : project)
          : [...state.projectOverrides, action.project],
        lifecycleEventAdditions: [...state.lifecycleEventAdditions, action.event],
        reusableAssetAdditions: action.asset ? [...state.reusableAssetAdditions, action.asset] : state.reusableAssetAdditions,
        projectUpdateRecords: [...state.projectUpdateRecords, action.record],
        notifications: [...state.notifications, ...action.notifications.filter((notification) => !state.notifications.some((item) => item.id === notification.id))],
        eventLog: appendEvent(state, createPrototypeEvent('project_updated', { projectId: action.project.id, eventId: action.event.id, updateType: action.record.type })),
      }
    }
    case 'PROJECT_UPDATE_DRAFT_UPSERT': {
      const exists = state.projectUpdateDrafts.some((draft) => draft.id === action.draft.id)
      return { ...state, projectUpdateDrafts: exists ? state.projectUpdateDrafts.map((draft) => draft.id === action.draft.id ? action.draft : draft) : [...state.projectUpdateDrafts, action.draft] }
    }
    case 'SUBMISSION_ENTRY_VALUE_SET':
      return { ...state, submissionEntryValue: action.value }
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
