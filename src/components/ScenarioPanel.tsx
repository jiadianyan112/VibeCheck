import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createLoginAction } from '../features/auth/session'
import { prototypeScenarios, prototypeUsers, scenarioExtractionDraftId } from '../mocks'
import { clearAppStorage, createInitialAppState, useAppState } from '../state'
import { projectId, submissionDraftId, type SubmissionDraft } from '../types'

const scenarioGroups = ['发现', '可信状态', '比较', '发布', '身份与登录', '服务异常'] as const

function extractionScenarioDraft(userId: NonNullable<ReturnType<typeof createInitialAppState>['session']['user']>['id']): SubmissionDraft {
  const timestamp = '2026-07-31T10:00:00+08:00'
  const publicUrl = 'https://example.test/scenario-partial-extraction'
  return {
    id: submissionDraftId(scenarioExtractionDraftId),
    userId,
    status: 'draft',
    step: 'prefill',
    fields: { publicUrl },
    originalExtraction: { publicUrl },
    assetIds: [],
    duplicateProjectId: null,
    validationErrors: {},
    reviewMessages: {},
    submittedFields: null,
    submittedAssetIds: [],
    supplementalMaterial: '',
    publishedProjectId: null,
    publishedEventId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    submittedAt: null,
    withdrawnAt: null,
  }
}

export function ScenarioPanel() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const location = useLocation()
  const groupedScenarios = useMemo(() => scenarioGroups.map((group) => [group, prototypeScenarios.filter((scenario) => scenario.group === group)] as const), [])
  const currentScenario = new URLSearchParams(location.search).get('prototypeScenario') ?? 'default'

  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('debug') !== '1') return null

  function resetScenario() {
    clearAppStorage()
    dispatch({ type: 'RESET', state: createInitialAppState() })
    navigate('/projects')
  }

  function openScenario(id: (typeof prototypeScenarios)[number]['id']) {
    const scenario = prototypeScenarios.find((item) => item.id === id)
    if (!scenario) return
    clearAppStorage()
    dispatch({ type: 'RESET', state: createInitialAppState() })

    if (scenario.requiresUser) {
      const user = prototypeUsers[0]!
      dispatch(createLoginAction(user))
      if (id === 'extraction_partial') dispatch({ type: 'DRAFT_UPSERT', draft: extractionScenarioDraft(user.id) })
    }
    if (id === 'comparison_insufficient') {
      dispatch({ type: 'COMPARISON_CLEAR' })
      dispatch({ type: 'COMPARISON_ADD', projectId: projectId('project-quizforge'), sourcePath: '/projects' })
    }
    navigate(`${scenario.path}${scenario.path.includes('?') ? '&' : '?'}debug=1`)
  }

  return (
    <details className="prototype-debug scenario-panel">
      <summary>原型场景{currentScenario === 'default' ? '' : ` · ${currentScenario}`}</summary>
      <div className="prototype-debug__body stack">
        <dl className="definition-list">
          <div><dt>隔离方式</dt><dd>切换前重置固定数据</dd></div>
          <div><dt>当前角色</dt><dd>{state.session.role}</dd></div>
          <div><dt>事件日志</dt><dd>{state.eventLog.length} 条</dd></div>
        </dl>
        {[...groupedScenarios].map(([group, scenarios]) => (
          <section className="scenario-panel__group stack stack--small" key={group} aria-labelledby={`scenario-group-${group}`}>
            <strong id={`scenario-group-${group}`}>{group}</strong>
            <div className="scenario-panel__grid">
              {scenarios.map((scenario) => (
                <button
                  className="button button--secondary scenario-panel__button"
                  type="button"
                  aria-pressed={currentScenario === scenario.id}
                  onClick={() => openScenario(scenario.id)}
                  key={scenario.id}
                >
                  <span>{scenario.label}</span>
                  <small>{scenario.description}</small>
                </button>
              ))}
            </div>
          </section>
        ))}
        <button className="button button--secondary" type="button" onClick={resetScenario}>重置场景与原型数据</button>
      </div>
    </details>
  )
}
