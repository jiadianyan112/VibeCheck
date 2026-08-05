import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Tag, useToast } from '../../components'
import { useAppState } from '../../state'
import type { AffectedField, AssetId, ComparisonSession, DecisionAction, ReusableAsset } from '../../types'
import { useAuthGate } from '../auth'
import { completeDecisionDraft, createDecisionDraft, serializeDecisionDraft } from './decision'

const actionLabels: Record<DecisionAction, string> = { continue: '继续', adjust: '调整', reuse: '复用', pause: '暂停' }
const fieldLabels: Record<AffectedField, string> = { target_users: '目标用户', positioning: '定位', features: '功能', core_flow: '核心流程', technical_path: '技术路径', assets: '资产' }

export function DecisionForm({ session, assets }: { session: ComparisonSession; assets: readonly ReusableAsset[] }) {
  const { state, dispatch } = useAppState()
  const { requireLogin } = useAuthGate()
  const { pushToast } = useToast()
  const [action, setAction] = useState<DecisionAction | ''>('')
  const [affectedFields, setAffectedFields] = useState<AffectedField[]>([])
  const [reason, setReason] = useState('')
  const [assetIds, setAssetIds] = useState<AssetId[]>([])
  const [error, setError] = useState('')
  const existing = state.decisionRecords
    .filter(({ sessionId, userId }) => sessionId === session.id && userId === state.session.user?.id)
    .at(-1)

  function toggleField(field: AffectedField) {
    setAffectedFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])
  }

  function toggleAsset(assetId: AssetId) {
    setAssetIds((current) => current.includes(assetId) ? current.filter((item) => item !== assetId) : [...current, assetId])
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!action || affectedFields.length === 0 || !reason.trim()) {
      setError('请选择行动和至少一个受影响字段，并填写判断理由。')
      requestAnimationFrame(() => {
        const selector = !action ? 'input[name="decision-action"]' : affectedFields.length === 0 ? 'input[name="affected-field"]' : '#decision-reason'
        document.querySelector<HTMLElement>(`#comparison-decision ${selector}`)?.focus()
      })
      return
    }
    setError('')
    const draft = createDecisionDraft({ sessionId: session.id, projectIds: session.projectIds, action, affectedFields, reason, assetIds })
    requireLogin(
      { id: `pending-${draft.id}`, kind: 'decision', sourcePath: `/compare/${session.id}#comparison-decision`, payload: serializeDecisionDraft(draft) },
      () => {
        const userId = state.session.user?.id
        if (!userId) return
        dispatch({ type: 'DECISION_SAVE', decision: completeDecisionDraft(draft, userId) })
        pushToast('决策记录已私密保存。', 'success')
      },
    )
  }

  if (existing) {
    return (
      <section id="comparison-decision" className="decision-complete wire-card stack" aria-labelledby="decision-complete-heading">
        <div className="cluster cluster--between"><div><p className="eyebrow">Private decision</p><h3 id="decision-complete-heading">决策记录已保存</h3></div><Tag tone="strong">仅自己可见</Tag></div>
        <dl className="decision-summary">
          <div><dt>行动</dt><dd>{actionLabels[existing.action]}</dd></div>
          <div><dt>受影响字段</dt><dd>{existing.affectedFields.map((field) => fieldLabels[field]).join('、')}</dd></div>
          <div><dt>理由</dt><dd>{existing.reason}</dd></div>
          <div><dt>关联资产</dt><dd>{existing.assetIds.length ? assets.filter(({ id }) => existing.assetIds.includes(id)).map(({ name }) => name).join('、') : '未关联资产'}</dd></div>
          <div><dt>关联作品</dt><dd>{existing.projectIds.length} 个比较作品；新项目关联将在后续版本开放。</dd></div>
        </dl>
        <div className="cluster"><a className="button button--primary" href="#structured-comparison-heading">返回比较</a><Link className="button" to="/me#decisions">在个人中心查看</Link></div>
      </section>
    )
  }

  return (
    <section id="comparison-decision" className="decision-form-section stack" aria-labelledby="decision-form-heading">
      <div className="section-heading"><p className="eyebrow">Decision record</p><h3 id="decision-form-heading">记录比较后的行动</h3><p>完成后将私密保存到个人中心，并固定关联本次比较中的作品。</p></div>
      <form className="decision-form stack" onSubmit={submit}>
        <fieldset aria-invalid={Boolean(error && !action)} aria-describedby={error ? 'decision-error' : undefined}><legend>下一步行动</legend><div className="decision-option-grid">{(Object.keys(actionLabels) as DecisionAction[]).map((value) => <label key={value} className="choice-card"><input type="radio" name="decision-action" value={value} checked={action === value} onChange={() => { setAction(value); setError('') }} /><strong>{actionLabels[value]}</strong></label>)}</div></fieldset>
        <fieldset aria-invalid={Boolean(error && affectedFields.length === 0)} aria-describedby={error ? 'decision-error' : undefined}><legend>受影响字段（可多选）</legend><div className="decision-option-grid">{(Object.keys(fieldLabels) as AffectedField[]).map((value) => <label key={value} className="choice-card"><input type="checkbox" name="affected-field" checked={affectedFields.includes(value)} onChange={() => { toggleField(value); setError('') }} /><span>{fieldLabels[value]}</span></label>)}</div></fieldset>
        <label className="field" htmlFor="decision-reason"><span className="field__label">判断理由</span><textarea id="decision-reason" className="input" rows={5} value={reason} aria-invalid={Boolean(error && !reason.trim())} aria-describedby={error ? 'decision-error' : undefined} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="说明比较结果如何影响你的下一步。" /></label>
        <fieldset><legend>关联可复用资产（可选）</legend>{assets.length ? <div className="decision-asset-list">{assets.map((asset) => <label key={asset.id} className="choice-card"><input type="checkbox" checked={assetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} /><span><strong>{asset.name}</strong><small>{asset.description}</small></span></label>)}</div> : <p className="page-description">所选作品暂无公开资产，可以不关联。</p>}</fieldset>
        <label className="field" htmlFor="future-project-link"><span className="field__label">关联到我的新项目（后续开放）</span><input id="future-project-link" className="input" disabled placeholder="创建新项目后可在这里关联" /></label>
        <label className="choice-card choice-card--fixed"><input type="checkbox" checked readOnly /><span><strong>同时保存本次比较</strong><small>会话、作品顺序和决策记录会一起进入个人中心。</small></span></label>
        {error ? <p id="decision-error" className="field-error" role="alert">{error}</p> : null}
        <div className="cluster cluster--between"><span className="page-description">隐私：此决策记录仅当前登录用户可见。</span><Button variant="primary" type="submit">完成并私密保存</Button></div>
      </form>
    </section>
  )
}

export { actionLabels as decisionActionLabels, fieldLabels as affectedFieldLabels }
