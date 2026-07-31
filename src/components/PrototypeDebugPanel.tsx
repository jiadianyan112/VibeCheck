import { clearAppStorage, createInitialAppState, useAppState } from '../state'
import { serviceScenarioIds } from '../services'

export function PrototypeDebugPanel() {
  const { state, dispatch } = useAppState()

  return (
    <details className="prototype-debug">
      <summary>原型调试</summary>
      <div className="prototype-debug__body stack">
        <dl className="definition-list">
          <div>
            <dt>角色</dt>
            <dd>{state.session.role}</dd>
          </div>
          <div>
            <dt>当前比较</dt>
            <dd>{state.comparisonProjectIds.length} 个作品</dd>
          </div>
          <div>
            <dt>事件日志</dt>
            <dd>{state.eventLog.length} 条</dd>
          </div>
        </dl>
        <label className="field">
          <span className="field__label">模拟场景</span>
          <select
            className="input"
            value={state.serviceScenario}
            onChange={(event) =>
              dispatch({
                type: 'SCENARIO_SET',
                scenario: event.target.value as (typeof serviceScenarioIds)[number],
              })
            }
          >
            {serviceScenarioIds.map((scenario) => (
              <option value={scenario} key={scenario}>
                {scenario}
              </option>
            ))}
          </select>
        </label>
        <div className="prototype-debug__events" aria-label="最近原型事件">
          {state.eventLog.slice(-5).reverse().map((event) => (
            <code key={event.id}>{event.name}</code>
          ))}
          {state.eventLog.length === 0 ? <span>暂无事件</span> : null}
        </div>
        <button
          className="button button--secondary"
          onClick={() => {
            clearAppStorage()
            dispatch({ type: 'RESET', state: createInitialAppState() })
          }}
        >
          清除并重置原型数据
        </button>
      </div>
    </details>
  )
}
