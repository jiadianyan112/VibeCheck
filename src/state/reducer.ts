import { createPrototypeEvent } from './eventLogger'
import { addComparisonProject, createComparisonSession, removeComparisonProject, reorderComparisonProject, replaceComparisonProject, saveComparisonSession, updateComparisonProjects } from '../features/comparison/session'
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

function upsertRecords<T extends { id: string }>(current: T[], incoming: readonly T[]) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]))
  const currentIds = new Set(current.map((item) => item.id))
  return [
    ...current.map((item) => incomingById.get(item.id) ?? item),
    ...incoming.filter((item) => !currentIds.has(item.id)),
  ]
}

function replaceProjectId<T>(values: T[], from: T, to: T) {
  return [...new Set(values.map((value) => value === from ? to : value))]
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
    case 'SESSION_SYNCED':
      return appReducer(state, { type: 'LOGIN_COMPLETED', user: action.user })
    case 'COMPARISON_ADD': {
      if (
        state.comparisonProjectIds.includes(action.projectId) ||
        state.comparisonProjectIds.length >= 5
      ) {
        return state
      }
      return {
        ...updateActiveComparison(state, (session) => ({
          ...addComparisonProject(session, action.projectId),
          sourcePath: action.sourcePath ?? session.sourcePath,
        })),
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
        followedProjectIds: willAdd
          ? state.followedProjectIds
          : state.followedProjectIds.filter((projectId) => projectId !== action.projectId),
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
        favoriteProjectIds: willAdd && !state.favoriteProjectIds.includes(action.projectId)
          ? [...state.favoriteProjectIds, action.projectId]
          : state.favoriteProjectIds,
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
      const sessionsWithAccountHistory = upsertRecords(state.comparisonSessions, loginSessions)
      const activeSession = state.comparisonSessions.find((session) => session.id === state.activeComparisonSessionId)
      const currentSessionId = activeSession?.ownerUserId && activeSession.ownerUserId !== action.user.id
        ? comparisonSessionId(`comparison-${action.user.id}-current`)
        : activeSession?.id ?? comparisonSessionId(`comparison-${action.user.id}-current`)
      const currentSessionBase = activeSession
        ? {
            ...updateComparisonProjects(activeSession, state.comparisonProjectIds),
            id: currentSessionId,
            ownerUserId: action.user.id,
            decisionId: null,
          }
        : createComparisonSession({
            id: currentSessionId,
            projectIds: state.comparisonProjectIds,
            sourcePath: '/projects',
            ownerUserId: action.user.id,
          })
      const currentSession = state.comparisonProjectIds.length >= 2
        ? saveComparisonSession(currentSessionBase, action.user.id)
        : currentSessionBase
      const accountFollowedProjectIds = action.assets?.followedProjectIds ?? state.followedProjectIds
      const accountFavoriteProjectIds = [...new Set([
        ...(action.assets?.favoriteProjectIds ?? state.favoriteProjectIds),
        ...accountFollowedProjectIds,
      ])]
      return {
        ...state,
        session: { user: action.user, role: action.user.role },
        comparisonProjectIds: currentSession.projectIds,
        activeComparisonSessionId: currentSession.id,
        comparisonSessions: upsertRecords(sessionsWithAccountHistory, [currentSession]),
        favoriteProjectIds: accountFavoriteProjectIds,
        followedProjectIds: accountFollowedProjectIds,
        recentProjectIds: action.assets?.recentProjectIds ?? state.recentProjectIds,
        decisionRecords: action.assets?.decisionRecords ?? state.decisionRecords,
        submissionDrafts: upsertRecords(action.assets?.submissionDrafts ?? [], state.submissionDrafts),
        verificationRequests: upsertRecords(action.assets?.verificationRequests ?? [], state.verificationRequests),
        notifications: upsertRecords(action.assets?.notifications ?? [], state.notifications),
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
        submissionEntryCategoryId: 'ai_learning_quiz',
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
        projectUpdateDrafts: state.projectUpdateDrafts.filter((draft) => draft.projectId !== action.record.projectId || draft.userId !== action.record.userId),
        notifications: [...state.notifications, ...action.notifications.filter((notification) => !state.notifications.some((item) => item.id === notification.id))],
        eventLog: appendEvent(state, createPrototypeEvent('project_updated', { projectId: action.project.id, eventId: action.event.id, updateType: action.record.type })),
      }
    }
    case 'ADMIN_PROJECT_SAVE': {
      const exists = state.projectOverrides.some((project) => project.id === action.project.id)
      const newLogs = action.logs.filter((log) => !state.adminAuditLogs.some((item) => item.id === log.id))
      return {
        ...state,
        projectOverrides: exists
          ? state.projectOverrides.map((project) => project.id === action.project.id ? action.project : project)
          : [...state.projectOverrides, action.project],
        adminAuditLogs: [...state.adminAuditLogs, ...newLogs],
      }
    }
    case 'ADMIN_EVIDENCE_REVIEW': {
      const exists = state.evidenceOverrides.some((evidence) => evidence.id === action.evidence.id)
      const logExists = state.adminAuditLogs.some((log) => log.id === action.log.id)
      return {
        ...state,
        evidenceOverrides: exists
          ? state.evidenceOverrides.map((evidence) => evidence.id === action.evidence.id ? action.evidence : evidence)
          : [...state.evidenceOverrides, action.evidence],
        adminAuditLogs: logExists ? state.adminAuditLogs : [...state.adminAuditLogs, action.log],
      }
    }
    case 'ADMIN_WORKFLOW_APPLY': {
      const mutation = action.mutation
      const alias = mutation.alias
      const projects = upsertRecords(state.projectOverrides, mutation.projects ?? [])
      const submissionDrafts = mutation.submissionDraft
        ? upsertRecords(state.submissionDrafts, [mutation.submissionDraft])
        : state.submissionDrafts
      const verificationRequests = mutation.verificationRequest
        ? upsertRecords(state.verificationRequests, [mutation.verificationRequest])
        : state.verificationRequests
      const notifications = upsertRecords(state.notifications, mutation.notifications ?? [])
      const lifecycleEventAdditions = upsertRecords(state.lifecycleEventAdditions, mutation.lifecycleEvents ?? [])
      const adminWorkflowLogs = state.adminWorkflowLogs.some((log) => log.id === mutation.log.id)
        ? state.adminWorkflowLogs
        : [...state.adminWorkflowLogs, mutation.log]
      return {
        ...state,
        projectOverrides: projects,
        submissionDrafts,
        verificationRequests: alias ? verificationRequests.map((request) => request.projectId === alias.from ? { ...request, projectId: alias.to } : request) : verificationRequests,
        notifications: alias ? notifications.map((notification) => notification.projectId === alias.from ? { ...notification, projectId: alias.to } : notification) : notifications,
        lifecycleEventAdditions,
        adminWorkflowLogs,
        projectAliases: alias ? { ...state.projectAliases, [alias.from]: alias.to } : state.projectAliases,
        statusReviewCounts: mutation.statusReview
          ? { ...state.statusReviewCounts, [mutation.statusReview.projectId]: mutation.statusReview.count }
          : state.statusReviewCounts,
        favoriteProjectIds: alias ? replaceProjectId(state.favoriteProjectIds, alias.from, alias.to) : state.favoriteProjectIds,
        followedProjectIds: alias ? replaceProjectId(state.followedProjectIds, alias.from, alias.to) : state.followedProjectIds,
        recentProjectIds: alias ? replaceProjectId(state.recentProjectIds, alias.from, alias.to) : state.recentProjectIds,
        comparisonProjectIds: alias ? replaceProjectId(state.comparisonProjectIds, alias.from, alias.to) : state.comparisonProjectIds,
        comparisonSessions: alias
          ? state.comparisonSessions.map((session) => ({ ...session, projectIds: replaceProjectId(session.projectIds, alias.from, alias.to).slice(0, 5) }))
          : state.comparisonSessions,
        projectUpdateDrafts: alias ? state.projectUpdateDrafts.map((draft) => draft.projectId === alias.from ? { ...draft, projectId: alias.to } : draft) : state.projectUpdateDrafts,
      }
    }
    case 'PROJECT_UPDATE_DRAFT_UPSERT': {
      const exists = state.projectUpdateDrafts.some((draft) => draft.id === action.draft.id)
      return { ...state, projectUpdateDrafts: exists ? state.projectUpdateDrafts.map((draft) => draft.id === action.draft.id ? action.draft : draft) : [...state.projectUpdateDrafts, action.draft] }
    }
    case 'SUBMISSION_ENTRY_VALUE_SET':
      return { ...state, submissionEntryValue: action.value }
    case 'SUBMISSION_ENTRY_CATEGORY_SET':
      return { ...state, submissionEntryCategoryId: action.categoryId }
    case 'NOTIFICATION_MARK_READ':
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.notificationId
            ? { ...notification, isRead: true }
            : notification,
        ),
      }
    case 'NOTIFICATIONS_MARK_ALL_READ':
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.userId === action.userId ? { ...notification, isRead: true } : notification,
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
