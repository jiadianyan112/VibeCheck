import type { AppState } from './types'

export const APP_STORAGE_KEY = 'vibecheck-prototype-state-v1'

type PersistedState = Pick<
  AppState,
  | 'schemaVersion'
  | 'session'
  | 'comparisonProjectIds'
  | 'activeComparisonSessionId'
  | 'comparisonSessions'
  | 'likedProjectIds'
  | 'favoriteProjectIds'
  | 'followedProjectIds'
  | 'recentProjectIds'
  | 'decisionRecords'
  | 'submissionDrafts'
  | 'verificationRequests'
  | 'projectOverrides'
  | 'evidenceOverrides'
  | 'adminAuditLogs'
  | 'adminWorkflowLogs'
  | 'projectAliases'
  | 'statusReviewCounts'
  | 'lifecycleEventAdditions'
  | 'reusableAssetAdditions'
  | 'projectUpdateRecords'
  | 'projectUpdateDrafts'
  | 'submissionEntryValue'
  | 'notifications'
  | 'pendingAction'
  | 'lastReplayedActionId'
  | 'serviceScenario'
>

export function selectPersistedState(state: AppState): PersistedState {
  return {
    schemaVersion: state.schemaVersion,
    session: state.session,
    comparisonProjectIds: state.comparisonProjectIds,
    activeComparisonSessionId: state.activeComparisonSessionId,
    comparisonSessions: state.comparisonSessions,
    likedProjectIds: state.likedProjectIds,
    favoriteProjectIds: state.favoriteProjectIds,
    followedProjectIds: state.followedProjectIds,
    recentProjectIds: state.recentProjectIds,
    decisionRecords: state.decisionRecords,
    submissionDrafts: state.submissionDrafts,
    verificationRequests: state.verificationRequests,
    projectOverrides: state.projectOverrides,
    evidenceOverrides: state.evidenceOverrides,
    adminAuditLogs: state.adminAuditLogs,
    adminWorkflowLogs: state.adminWorkflowLogs,
    projectAliases: state.projectAliases,
    statusReviewCounts: state.statusReviewCounts,
    lifecycleEventAdditions: state.lifecycleEventAdditions,
    reusableAssetAdditions: state.reusableAssetAdditions,
    projectUpdateRecords: state.projectUpdateRecords,
    projectUpdateDrafts: state.projectUpdateDrafts,
    submissionEntryValue: state.submissionEntryValue,
    notifications: state.notifications,
    pendingAction: state.pendingAction,
    lastReplayedActionId: state.lastReplayedActionId,
    serviceScenario: state.serviceScenario,
  }
}

export function persistAppState(state: AppState, storage: Storage = localStorage) {
  try {
    storage.setItem(APP_STORAGE_KEY, JSON.stringify(selectPersistedState(state)))
    return true
  } catch {
    return false
  }
}

export function hydrateAppState(
  fallback: AppState,
  storage: Storage = localStorage,
): AppState {
  try {
    const raw = storage.getItem(APP_STORAGE_KEY)
    if (!raw) return fallback
    const persisted = JSON.parse(raw) as Partial<PersistedState>
    if (persisted.schemaVersion !== 1) return fallback
    const submissionDrafts = (persisted.submissionDrafts ?? fallback.submissionDrafts).map((draft) => ({
      ...draft,
      submittedFields: draft.submittedFields ?? null,
      submittedAssetIds: draft.submittedAssetIds ?? [],
      supplementalMaterial: draft.supplementalMaterial ?? '',
      publishedProjectId: draft.publishedProjectId ?? null,
      publishedEventId: draft.publishedEventId ?? null,
      withdrawnAt: draft.withdrawnAt ?? null,
    }))
    const hydrated: AppState = {
      ...fallback,
      ...persisted,
      submissionDrafts,
      verificationRequests: (persisted.verificationRequests ?? fallback.verificationRequests).map((request) => ({
        ...request,
        statusHistory: request.statusHistory ?? [{ status: request.status, happenedAt: request.updatedAt, message: request.reviewMessage }],
        submittedAt: request.submittedAt ?? request.createdAt,
        resolvedAt: request.resolvedAt ?? null,
      })),
      projectOverrides: persisted.projectOverrides ?? fallback.projectOverrides,
      evidenceOverrides: persisted.evidenceOverrides ?? fallback.evidenceOverrides,
      adminAuditLogs: persisted.adminAuditLogs ?? fallback.adminAuditLogs,
      adminWorkflowLogs: persisted.adminWorkflowLogs ?? fallback.adminWorkflowLogs,
      projectAliases: persisted.projectAliases ?? fallback.projectAliases,
      statusReviewCounts: persisted.statusReviewCounts ?? fallback.statusReviewCounts,
      lifecycleEventAdditions: persisted.lifecycleEventAdditions ?? fallback.lifecycleEventAdditions,
      reusableAssetAdditions: persisted.reusableAssetAdditions ?? fallback.reusableAssetAdditions,
      projectUpdateRecords: persisted.projectUpdateRecords ?? fallback.projectUpdateRecords,
      projectUpdateDrafts: persisted.projectUpdateDrafts ?? fallback.projectUpdateDrafts,
      submissionEntryValue: persisted.submissionEntryValue ?? fallback.submissionEntryValue,
      eventLog: [],
      comparisonSessions: persisted.comparisonSessions ?? fallback.comparisonSessions,
      activeComparisonSessionId: persisted.activeComparisonSessionId ?? fallback.activeComparisonSessionId,
      notifications: persisted.notifications ?? fallback.notifications,
    }
    if (hydrated.session.role !== 'guest') return hydrated
    return {
      ...hydrated,
      favoriteProjectIds: [],
      followedProjectIds: [],
      decisionRecords: [],
      submissionDrafts: [],
      verificationRequests: [],
      projectUpdateDrafts: [],
      submissionEntryValue: '',
      notifications: [],
    }
  } catch {
    return fallback
  }
}

export function clearAppStorage(storage: Storage = localStorage) {
  try {
    storage.removeItem(APP_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
