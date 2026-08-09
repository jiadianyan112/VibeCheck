import {
  comparisonSessionId,
  projectId,
  submissionDraftId,
  userId,
} from '../types'
import { prototypeUsers, submissionDrafts } from '../mocks'
import { createLoginAction } from '../features/auth/session'
import { createInitialAppState } from './initialState'
import { appReducer } from './reducer'
import {
  APP_STORAGE_KEY,
  hydrateAppState,
  persistAppState,
} from './storage'
import type { AppState } from './types'

describe('global state and persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists and restores a merged comparison and authenticated draft', () => {
    let state = createInitialAppState()
    state = appReducer(state, {
      type: 'COMPARISON_ADD',
      projectId: projectId('project-papertopractice'),
    })
    state = appReducer(state, {
      type: 'DRAFT_UPSERT',
      draft: submissionDrafts[0]!,
    })
    state = appReducer(state, createLoginAction(prototypeUsers[0]!))
    expect(persistAppState(state)).toBe(true)
    expect(localStorage.getItem(APP_STORAGE_KEY)).toBeTruthy()
    const restored = hydrateAppState(createInitialAppState())
    expect(restored.comparisonProjectIds).toContain(
      projectId('project-papertopractice'),
    )
    expect(restored.session.user?.id).toBe(prototypeUsers[0]!.id)
    expect(restored.comparisonSessions.find(({ id }) => id === restored.activeComparisonSessionId)?.projectIds).toEqual(restored.comparisonProjectIds)
    expect(restored.submissionDrafts[0]?.id).toBe(
      submissionDraftId('draft-mia-study-review'),
    )
  })

  it('keeps the anonymous selection intact and does not merge account history on login', () => {
    const user = prototypeUsers.find(({ id }) => id === userId('user-mia'))!
    const initial = createInitialAppState()
    const guestSelection = initial.comparisonProjectIds
    const state = appReducer(initial, {
      type: 'LOGIN_COMPLETED',
      user,
      userComparisonProjectIds: [
        projectId('project-speakmirror'),
        projectId('project-oralaiexam'),
        projectId('project-echoscore'),
        projectId('project-lexideck'),
      ],
    })
    expect(state.session.user?.id).toBe(user.id)
    expect(state.comparisonProjectIds).toEqual(guestSelection)
    const activeSession = state.comparisonSessions.find(({ id }) => id === state.activeComparisonSessionId)
    expect(activeSession?.projectIds).toEqual(guestSelection)
    expect(activeSession?.ownerUserId).toBe(user.id)
    expect(activeSession?.savedAt).toBeTruthy()
    expect(state.comparisonSessions.find(({ id }) => id === comparisonSessionId('comparison-mia-speaking'))?.projectIds).not.toEqual(guestSelection)
  })

  it('replays a queued login action exactly once', () => {
    const queued = appReducer(createInitialAppState(), {
      type: 'PENDING_ACTION_QUEUE',
      action: {
        id: 'pending-favorite-1',
        kind: 'favorite',
        projectId: projectId('project-quizforge'),
        sourcePath: '/project/project-quizforge',
      },
    })
    const replayed = appReducer(queued, { type: 'PENDING_ACTION_REPLAY' })
    const replayedAgain = appReducer(replayed, { type: 'PENDING_ACTION_REPLAY' })
    expect(replayed.favoriteProjectIds).toEqual([projectId('project-quizforge')])
    expect(replayed.pendingAction).toBeNull()
    expect(replayedAgain.favoriteProjectIds).toEqual(replayed.favoriteProjectIds)
    expect(replayedAgain.eventLog).toEqual(replayed.eventLog)
  })

  it('enforces comparison uniqueness and a five project ceiling', () => {
    let state: AppState = {
      ...createInitialAppState(),
      comparisonProjectIds: [],
    }
    const ids = [
      'project-quizforge',
      'project-pdfquizlab',
      'project-papertopractice',
      'project-speakmirror',
      'project-oralaiexam',
      'project-echoscore',
    ].map(projectId)
    for (const id of ids) state = appReducer(state, { type: 'COMPARISON_ADD', projectId: id })
    state = appReducer(state, { type: 'COMPARISON_ADD', projectId: ids[0]! })
    expect(state.comparisonProjectIds).toHaveLength(5)
    expect(new Set(state.comparisonProjectIds).size).toBe(5)
  })

  it('keeps the current filtered source path with a comparison selection', () => {
    const state = appReducer(createInitialAppState(), {
      type: 'COMPARISON_ADD',
      projectId: projectId('project-papertopractice'),
      sourcePath: '/discover/result?idea=PDF&status=normal',
    })
    const session = state.comparisonSessions.find(({ id }) => id === state.activeComparisonSessionId)
    expect(session?.sourcePath).toBe('/discover/result?idea=PDF&status=normal')
  })

  it('keeps shareable comparison routes while hiding private account records from guests', () => {
    const restored = hydrateAppState(createInitialAppState())
    expect(restored.comparisonSessions.some(
      ({ id }) => id === comparisonSessionId('comparison-mia-speaking'),
    )).toBe(true)
    expect(restored.decisionRecords).toEqual([])
  })

  it('reorders, saves and restores the same active comparison session', () => {
    const initial = appReducer(createInitialAppState(), createLoginAction(prototypeUsers[0]!))
    const firstId = initial.comparisonProjectIds[0]!
    let state = appReducer(initial, { type: 'COMPARISON_REORDER', projectId: firstId, direction: 1 })
    expect(state.comparisonProjectIds[1]).toBe(firstId)
    state = appReducer(state, { type: 'COMPARISON_SESSION_SAVE' })
    expect(state.comparisonSessions.find(({ id }) => id === state.activeComparisonSessionId)?.savedAt).toBeTruthy()
    state = appReducer(state, { type: 'COMPARISON_SESSION_RESTORE', sessionId: comparisonSessionId('comparison-mia-speaking') })
    expect(state.activeComparisonSessionId).toBe(comparisonSessionId('comparison-mia-speaking'))
    expect(state.comparisonProjectIds).toEqual(state.comparisonSessions.find(({ id }) => id === state.activeComparisonSessionId)?.projectIds)
    expect(state.comparisonProjectIds.length).toBeLessThanOrEqual(5)
  })

  it('persists the lightweight like signal without changing fixture metrics', () => {
    const id = projectId('project-quizforge')
    const liked = appReducer(createInitialAppState(), { type: 'LIKE_TOGGLE', projectId: id })
    expect(liked.likedProjectIds).toEqual([id])
    expect(liked.eventLog.at(-1)?.name).toBe('project_liked')
    persistAppState(liked)
    expect(hydrateAppState(createInitialAppState()).likedProjectIds).toEqual([id])
  })

  it('treats update following as a setting of a saved project', () => {
    const id = projectId('project-quizforge')
    const followed = appReducer(createInitialAppState(), { type: 'FOLLOW_TOGGLE', projectId: id })
    expect(followed.favoriteProjectIds).toEqual([id])
    expect(followed.followedProjectIds).toEqual([id])

    const unfavorited = appReducer(followed, { type: 'FAVORITE_TOGGLE', projectId: id })
    expect(unfavorited.favoriteProjectIds).toEqual([])
    expect(unfavorited.followedProjectIds).toEqual([])
  })

  it('loads user assets on login and clears private state on logout', () => {
    const user = prototypeUsers[0]!
    const loggedIn = appReducer(createInitialAppState(), createLoginAction(user))
    expect(loggedIn.favoriteProjectIds).toHaveLength(4)
    expect(loggedIn.followedProjectIds.every((id) => loggedIn.favoriteProjectIds.includes(id))).toBe(true)
    expect(loggedIn.submissionDrafts).toHaveLength(1)
    expect(loggedIn.notifications.every((notification) => notification.userId === user.id)).toBe(true)
    expect(loggedIn.comparisonSessions.some((session) => session.ownerUserId === user.id)).toBe(true)

    const loggedOut = appReducer(loggedIn, { type: 'LOGOUT' })
    expect(loggedOut.session.role).toBe('guest')
    expect(loggedOut.favoriteProjectIds).toEqual([])
    expect(loggedOut.submissionDrafts).toEqual([])
    expect(loggedOut.notifications).toEqual([])
    expect(loggedOut.comparisonSessions.some((session) => session.ownerUserId === user.id)).toBe(true)
    expect(loggedOut.comparisonProjectIds).toEqual([])
  })
})
