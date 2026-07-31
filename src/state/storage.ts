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
    return {
      ...fallback,
      ...persisted,
      eventLog: [],
      comparisonSessions: persisted.comparisonSessions ?? fallback.comparisonSessions,
      activeComparisonSessionId: persisted.activeComparisonSessionId ?? fallback.activeComparisonSessionId,
      notifications: fallback.notifications,
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
