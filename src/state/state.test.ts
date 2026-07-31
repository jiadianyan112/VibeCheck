import {
  comparisonSessionId,
  projectId,
  submissionDraftId,
  userId,
} from '../types'
import { prototypeUsers, submissionDrafts } from '../mocks'
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

  it('persists and restores anonymous comparison and drafts', () => {
    let state = createInitialAppState()
    state = appReducer(state, {
      type: 'COMPARISON_ADD',
      projectId: projectId('project-papertopractice'),
    })
    state = appReducer(state, {
      type: 'DRAFT_UPSERT',
      draft: submissionDrafts[0]!,
    })
    expect(persistAppState(state)).toBe(true)
    expect(localStorage.getItem(APP_STORAGE_KEY)).toBeTruthy()
    const restored = hydrateAppState(createInitialAppState())
    expect(restored.comparisonProjectIds).toContain(
      projectId('project-papertopractice'),
    )
    expect(restored.activeComparisonSessionId).toBe(comparisonSessionId('comparison-anonymous-pdf'))
    expect(restored.comparisonSessions.find(({ id }) => id === restored.activeComparisonSessionId)?.projectIds).toEqual(restored.comparisonProjectIds)
    expect(restored.submissionDrafts[0]?.id).toBe(
      submissionDraftId('draft-mia-study-review'),
    )
  })

  it('merges anonymous and account comparison without exceeding five', () => {
    const user = prototypeUsers.find(({ id }) => id === userId('user-mia'))!
    const state = appReducer(createInitialAppState(), {
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
    expect(state.comparisonProjectIds.length).toBeLessThanOrEqual(5)
    expect(new Set(state.comparisonProjectIds).size).toBe(
      state.comparisonProjectIds.length,
    )
    expect(state.comparisonSessions.find(({ id }) => id === state.activeComparisonSessionId)?.ownerUserId).toBe(user.id)
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

  it('keeps fixture comparison sessions available after hydration', () => {
    const restored = hydrateAppState(createInitialAppState())
    expect(restored.comparisonSessions.some(
      ({ id }) => id === comparisonSessionId('comparison-mia-speaking'),
    )).toBe(true)
  })

  it('reorders, saves and restores the same active comparison session', () => {
    const initial = createInitialAppState()
    const firstId = initial.comparisonProjectIds[0]!
    let state = appReducer(initial, { type: 'COMPARISON_REORDER', projectId: firstId, direction: 1 })
    expect(state.comparisonProjectIds[1]).toBe(firstId)
    state = appReducer(state, { type: 'COMPARISON_SESSION_SAVE' })
    expect(state.comparisonSessions.find(({ id }) => id === state.activeComparisonSessionId)?.savedAt).toBeTruthy()
    state = appReducer(state, { type: 'COMPARISON_SESSION_RESTORE', sessionId: comparisonSessionId('comparison-mia-speaking') })
    expect(state.activeComparisonSessionId).toBe(comparisonSessionId('comparison-mia-speaking'))
    expect(state.comparisonProjectIds).toHaveLength(3)
  })

  it('persists the lightweight like signal without changing fixture metrics', () => {
    const id = projectId('project-quizforge')
    const liked = appReducer(createInitialAppState(), { type: 'LIKE_TOGGLE', projectId: id })
    expect(liked.likedProjectIds).toEqual([id])
    expect(liked.eventLog.at(-1)?.name).toBe('project_liked')
    persistAppState(liked)
    expect(hydrateAppState(createInitialAppState()).likedProjectIds).toEqual([id])
  })
})
