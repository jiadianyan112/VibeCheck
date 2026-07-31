import { prototypeUsers } from '../../mocks'
import { appReducer, createInitialAppState, hydrateAppState, persistAppState } from '../../state'
import { assetId, comparisonSessionId, projectId, userId } from '../../types'
import { completeDecisionDraft, createDecisionDraft, deserializeDecisionDraft, serializeDecisionDraft } from './decision'

describe('comparison decision record', () => {
  beforeEach(() => localStorage.clear())

  const draft = createDecisionDraft({
    sessionId: comparisonSessionId('comparison-anonymous-pdf'),
    projectIds: [projectId('project-quizforge'), projectId('project-pdfquizlab')],
    action: 'reuse',
    affectedFields: ['core_flow', 'assets'],
    reason: '  复用解析流程，并调整反馈结构。  ',
    assetIds: [assetId('asset-test')],
    now: '2026-07-31T10:00:00+08:00',
  })

  it('serializes an anonymous draft and completes every private record field after login', () => {
    const restored = deserializeDecisionDraft(serializeDecisionDraft(draft))!
    const completed = completeDecisionDraft(restored, userId('user-test'))
    expect(completed).toEqual({
      ...draft,
      userId: userId('user-test'),
      visibility: 'private',
    })
    expect(completed.reason).toBe('复用解析流程，并调整反馈结构。')
  })

  it('replays a queued guest decision after login and saves it only once', () => {
    const user = prototypeUsers[0]!
    let state = appReducer(createInitialAppState(), {
      type: 'PENDING_ACTION_QUEUE',
      action: { id: `pending-${draft.id}`, kind: 'decision', sourcePath: `/compare/${draft.sessionId}`, payload: serializeDecisionDraft(draft) },
    })
    state = appReducer(state, { type: 'LOGIN_COMPLETED', user })
    state = appReducer(state, { type: 'PENDING_ACTION_REPLAY' })
    const replayedAgain = appReducer(state, { type: 'PENDING_ACTION_REPLAY' })
    const duplicateSave = appReducer(state, { type: 'DECISION_SAVE', decision: state.decisionRecords[0]! })
    expect(state.decisionRecords).toHaveLength(1)
    expect(state.decisionRecords[0]?.userId).toBe(user.id)
    expect(state.decisionRecords[0]?.visibility).toBe('private')
    expect(state.comparisonSessions.find(({ id }) => id === draft.sessionId)?.decisionId).toBe(draft.id)
    expect(state.comparisonSessions.find(({ id }) => id === draft.sessionId)?.savedAt).toBe(draft.createdAt)
    expect(replayedAgain.decisionRecords).toEqual(state.decisionRecords)
    expect(duplicateSave).toBe(state)
    expect(state.eventLog.filter(({ name }) => name === 'decision_submitted')).toHaveLength(1)
    expect(state.eventLog.filter(({ name }) => name === 'comparison_completed')).toHaveLength(1)
    persistAppState(state)
    expect(hydrateAppState(createInitialAppState()).decisionRecords).toEqual(state.decisionRecords)
  })

  it('does not deserialize malformed queued payloads', () => {
    expect(deserializeDecisionDraft({ action: 'continue' })).toBeNull()
    expect(deserializeDecisionDraft({ ...serializeDecisionDraft(draft), projectIds: 'not-json' })).toBeNull()
  })
})
