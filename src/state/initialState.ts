import {
  anonymousAssets,
  comparisonSessions,
  notifications,
} from '../mocks'
import type { AppState } from './types'

export function createInitialAppState(): AppState {
  const anonymousSession = comparisonSessions.find(
    (session) => session.id === anonymousAssets.comparisonSessionIds[0],
  )
  return {
    schemaVersion: 1,
    session: { user: null, role: 'guest' },
    comparisonProjectIds: anonymousSession?.projectIds ?? [],
    likedProjectIds: [],
    comparisonSessions,
    favoriteProjectIds: [],
    followedProjectIds: [],
    recentProjectIds: anonymousAssets.recentProjectIds,
    decisionRecords: [],
    submissionDrafts: [],
    notifications,
    pendingAction: null,
    lastReplayedActionId: null,
    serviceScenario: 'default',
    eventLog: [],
  }
}
