import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, Input, LoadingState, PageFrame, Tag, useToast } from '../components'
import {
  applyExtraction,
  submissionCompleteness,
  submissionFormStepLabels,
  submissionFormSteps,
  updateDraftField,
  validateSubmissionStep,
  type SubmissionFormStep,
} from '../features'
import { resolveServiceScenario, reusableAssets } from '../mocks'
import { submissionService, type ServiceError } from '../services'
import { useAppState } from '../state'
import { SubmissionReviewPage } from './SubmissionReviewPage'
import {
  accessStatuses,
  aiCodingTools,
  feedbackMethods,
  inputTypes,
  outputTypes,
  practiceFormats,
  targetUsers,
  useScenarios,
  type AssetId,
  type SubmissionDraft,
  type SubmissionProjectFields,
} from '../types'
import {
  accessStatusText,
  aiCodingToolLabels,
  feedbackMethodLabels,
  inputTypeLabels,
  outputTypeLabels,
  practiceFormatLabels,
  scenarioLabels,
  targetUserLabels,
} from '../utils'

function parseStep(value: string | null, fallback: SubmissionDraft['step']): SubmissionFormStep {
  if (submissionFormSteps.includes(value as SubmissionFormStep)) return value as SubmissionFormStep
  return submissionFormSteps.includes(fallback as SubmissionFormStep) ? fallback as SubmissionFormStep : 'prefill'
}

function OriginalValue({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return <p className="original-extraction original-extraction--missing"><strong>{label}原始提取：</strong>未提取到，可手动填写。</p>
  const text = value === null ? '空' : Array.isArray(value) ? value.join('、') : String(value)
  return <p className="original-extraction"><strong>{label}原始提取：</strong>{text}</p>
}

function CheckboxField<T extends string>({
  legend,
  values,
  selected,
  labels,
  error,
  onChange,
  optional = false,
}: {
  legend: string
  values: readonly T[]
  selected: readonly T[]
  labels: Record<T, string>
  error?: string
  onChange: (values: T[]) => void
  optional?: boolean
}) {
  const errorId = useId()
  return (
    <fieldset className="submission-choice-field" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}>
      <legend>{legend}{optional ? '（可跳过）' : '（必填）'}</legend>
      <div className="submission-choice-grid">
        {values.map((value) => (
          <label className="choice-card" key={value}>
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))}
            />
            <span>{labels[value]}</span>
          </label>
        ))}
      </div>
      {error ? <p id={errorId} className="field-error" role="alert">{error}</p> : null}
    </fieldset>
  )
}

function PrefillStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  const fields = draft.fields
  const original = draft.originalExtraction
  return (
    <div className="submission-step-fields stack">
      <section className="submission-guidance"><strong>先确认自动提取</strong><p>任何自动字段都可纠正；下方原始值会保留为提取证据，不随修改覆盖。</p></section>
      <div>
        <Input label="作品名称" value={fields.currentName ?? ''} error={draft.validationErrors.currentName} onChange={(event) => update('currentName', event.target.value)} />
        <OriginalValue label="名称" value={original.currentName} />
      </div>
      <div>
        <label className="field" htmlFor="submission-definition"><span className="field__label">一句话定义</span><textarea id="submission-definition" className="input textarea" value={fields.oneLineDefinition ?? ''} aria-invalid={Boolean(draft.validationErrors.oneLineDefinition)} aria-describedby={draft.validationErrors.oneLineDefinition ? 'submission-definition-error' : undefined} onChange={(event) => update('oneLineDefinition', event.target.value)} /></label>
        {draft.validationErrors.oneLineDefinition ? <p id="submission-definition-error" className="field-error" role="alert">{draft.validationErrors.oneLineDefinition}</p> : null}
        <OriginalValue label="定义" value={original.oneLineDefinition} />
      </div>
      <div>
        <Input label="截图地址（可跳过）" value={fields.screenshotUrl ?? ''} error={draft.validationErrors.screenshotUrl} onChange={(event) => update('screenshotUrl', event.target.value || null)} />
        <OriginalValue label="截图" value={original.screenshotUrl} />
      </div>
      <div>
        <Input label="代码仓库（可跳过）" value={fields.repositoryUrl ?? ''} error={draft.validationErrors.repositoryUrl} onChange={(event) => update('repositoryUrl', event.target.value || null)} />
        <OriginalValue label="仓库" value={original.repositoryUrl} />
      </div>
      <div>
        <label className="field" htmlFor="submission-access-status"><span className="field__label">基础访问状态（必填）</span><select id="submission-access-status" className="input" value={fields.accessStatus ?? ''} aria-invalid={Boolean(draft.validationErrors.accessStatus)} aria-describedby={draft.validationErrors.accessStatus ? 'submission-access-status-error' : undefined} onChange={(event) => update('accessStatus', event.target.value as SubmissionProjectFields['accessStatus'])}><option value="">请选择</option>{accessStatuses.map((status) => <option key={status} value={status}>{accessStatusText[status]}</option>)}</select></label>
        {draft.validationErrors.accessStatus ? <p id="submission-access-status-error" className="field-error" role="alert">{draft.validationErrors.accessStatus}</p> : null}
        <OriginalValue label="状态" value={original.accessStatus ? accessStatusText[original.accessStatus] : undefined} />
      </div>
    </div>
  )
}

function DefinitionStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  return (
    <div className="submission-step-fields stack">
      <CheckboxField legend="目标用户" values={targetUsers} selected={draft.fields.targetUsers ?? []} labels={targetUserLabels} error={draft.validationErrors.targetUsers} onChange={(value) => update('targetUsers', value)} />
      <label className="field" htmlFor="submission-core-problem"><span className="field__label">核心问题（必填）</span><textarea id="submission-core-problem" className="input textarea" value={draft.fields.coreProblem ?? ''} aria-invalid={Boolean(draft.validationErrors.coreProblem)} aria-describedby={draft.validationErrors.coreProblem ? 'submission-core-problem-error' : undefined} onChange={(event) => update('coreProblem', event.target.value)} /></label>
      {draft.validationErrors.coreProblem ? <p id="submission-core-problem-error" className="field-error" role="alert">{draft.validationErrors.coreProblem}</p> : null}
      <CheckboxField legend="使用场景" values={useScenarios} selected={draft.fields.useScenarios ?? []} labels={scenarioLabels} error={draft.validationErrors.useScenarios} onChange={(value) => update('useScenarios', value)} />
    </div>
  )
}

function SolutionStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  const flowText = (draft.fields.coreFlow ?? []).sort((a, b) => a.order - b.order).map((node) => node.label).join('\n')
  return (
    <div className="submission-step-fields stack">
      <CheckboxField legend="主要输入" values={inputTypes} selected={draft.fields.mainInputs ?? []} labels={inputTypeLabels} error={draft.validationErrors.mainInputs} onChange={(value) => update('mainInputs', value)} />
      <CheckboxField legend="主要输出" values={outputTypes} selected={draft.fields.mainOutputs ?? []} labels={outputTypeLabels} error={draft.validationErrors.mainOutputs} onChange={(value) => update('mainOutputs', value)} />
      <label className="field" htmlFor="submission-core-flow"><span className="field__label">核心流程（必填，每行一步）</span><textarea id="submission-core-flow" className="input textarea" value={flowText} aria-invalid={Boolean(draft.validationErrors.coreFlow)} aria-describedby={draft.validationErrors.coreFlow ? 'submission-core-flow-error' : undefined} onChange={(event) => update('coreFlow', event.target.value.split('\n').map((line) => line.trim()).filter(Boolean).map((label, index) => ({ id: `draft-flow-${index + 1}`, order: index + 1, label, description: '' })))} /></label>
      {draft.validationErrors.coreFlow ? <p id="submission-core-flow-error" className="field-error" role="alert">{draft.validationErrors.coreFlow}</p> : null}
      <CheckboxField legend="练习形式" values={practiceFormats} selected={draft.fields.practiceFormats ?? []} labels={practiceFormatLabels} optional onChange={(value) => update('practiceFormats', value)} />
      <CheckboxField legend="反馈方式" values={feedbackMethods} selected={draft.fields.feedbackMethods ?? []} labels={feedbackMethodLabels} optional onChange={(value) => update('feedbackMethods', value)} />
      <label className="field"><span className="field__label">差异化说明（可跳过）</span><textarea className="input textarea" value={draft.fields.differentiation ?? ''} onChange={(event) => update('differentiation', event.target.value)} /></label>
    </div>
  )
}

function DevelopmentStep({ draft, update, updateAssets }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void; updateAssets: (ids: AssetId[]) => void }) {
  return (
    <div className="submission-step-fields stack">
      <CheckboxField legend="AI 编程工具" values={aiCodingTools} selected={draft.fields.aiCodingTools ?? []} labels={aiCodingToolLabels} optional onChange={(value) => update('aiCodingTools', value)} />
      <fieldset className="submission-choice-field"><legend>关联可复用资产（可跳过）</legend><div className="submission-asset-grid">{reusableAssets.map((asset) => <label className="choice-card" key={asset.id}><input type="checkbox" checked={draft.assetIds.includes(asset.id)} onChange={(event) => updateAssets(event.target.checked ? [...draft.assetIds, asset.id] : draft.assetIds.filter((id) => id !== asset.id))} /><span><strong>{asset.name}</strong><small>{asset.type} · {asset.license}</small></span></label>)}</div></fieldset>
      <section className="submission-guidance"><strong>可跳过项不会阻止保存</strong><p>截图、仓库、开发工具、练习细节和复用资产可在后续更新；核心定义与流程必须完成。</p></section>
    </div>
  )
}

export function SubmitFormPage() {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const draftId = searchParams.get('draft')
  const scenario = resolveServiceScenario(searchParams, state.serviceScenario)
  const draft = state.submissionDrafts.find((item) => item.id === draftId && item.userId === state.session.user?.id)
  const step = parseStep(searchParams.get('step'), draft?.step ?? 'prefill')
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<ServiceError | null>(null)
  const extractionFieldCount = draft ? Object.keys(draft.originalExtraction).length : 0
  const extractionUrl = draft?.fields.publicUrl ?? ''

  useEffect(() => {
    if (!draft || step !== 'prefill' || extractionFieldCount > 1 || extractionError) return
    let active = true
    setExtracting(true)
    submissionService.extract(extractionUrl, { scenario }).then((result) => {
      if (!active) return
      setExtracting(false)
      if (!result.ok) { setExtractionError(result.error); return }
      setExtractionError(null)
      dispatch({ type: 'DRAFT_UPSERT', draft: applyExtraction(draft, result.data) })
    })
    return () => { active = false }
  }, [dispatch, draft, extractionError, extractionFieldCount, extractionUrl, scenario, step])

  const completion = useMemo(() => draft ? submissionCompleteness(draft) : null, [draft])

  if (!state.session.user) {
    const returnPath = encodeURIComponent(`${location.pathname}${location.search}`)
    return <PageFrame title="发布编辑"><section className="submit-login-callout stack"><h2>请先登录</h2><Link className="button button--primary" to={`/auth?from=${returnPath}`}>登录并返回当前草稿</Link></section></PageFrame>
  }
  if (!draft) return <PageFrame title="未找到发布草稿" description="草稿可能不存在、属于其他测试身份或已被清除。"><Link className="button" to="/submit">返回地址检查</Link></PageFrame>
  const requestedStep = searchParams.get('step')
  const editingRequestedChanges = draft.status === 'changes_requested' && submissionFormSteps.includes(requestedStep as SubmissionFormStep)
  if (requestedStep === 'preview' || (draft.status !== 'draft' && !editingRequestedChanges)) return <SubmissionReviewPage draft={draft} />

  const update = <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => dispatch({ type: 'DRAFT_UPSERT', draft: updateDraftField(draft, field, value) })
  const updateAssets = (assetIds: AssetId[]) => dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, assetIds, updatedAt: '2026-07-31T10:15:00+08:00' } })
  const index = submissionFormSteps.indexOf(step)

  const goNext = () => {
    const errors = validateSubmissionStep(draft, step)
    if (Object.keys(errors).length) {
      dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, validationErrors: { ...draft.validationErrors, ...errors } } })
      pushToast('请先完成当前步骤的必填字段。', 'error')
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.submission-form-panel [aria-invalid="true"]')?.focus())
      return
    }
    if (index === submissionFormSteps.length - 1) {
      dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, step: 'preview', validationErrors: {}, updatedAt: '2026-07-31T10:20:00+08:00' } })
      pushToast('完整发布草稿已保存，请确认预览。', 'success')
      navigate(`/submit/new?${new URLSearchParams({ draft: draft.id, step: 'preview' })}`)
      return
    }
    const next = submissionFormSteps[index + 1]!
    dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, step: next, validationErrors: {}, updatedAt: '2026-07-31T10:20:00+08:00' } })
    navigate(`/submit/new?${new URLSearchParams({ draft: draft.id, step: next })}`)
  }

  const goBack = () => {
    if (index === 0) { navigate(`/submit?resumeUrl=${encodeURIComponent(draft.fields.publicUrl ?? '')}`); return }
    const previous = submissionFormSteps[index - 1]!
    dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, step: previous, updatedAt: '2026-07-31T10:20:00+08:00' } })
    navigate(`/submit/new?${new URLSearchParams({ draft: draft.id, step: previous })}`)
  }

  let body: ReactNode
  if (step === 'prefill') body = extracting ? <LoadingState label="正在自动提取公开页面字段" /> : <PrefillStep draft={draft} update={update} />
  else if (step === 'definition') body = <DefinitionStep draft={draft} update={update} />
  else if (step === 'solution') body = <SolutionStep draft={draft} update={update} />
  else body = <DevelopmentStep draft={draft} update={update} updateAssets={updateAssets} />

  return (
    <PageFrame title="发布新作品" description="按模块完成必要事实；可选开发信息可以跳过，草稿会持续保存在当前浏览器。">
      <div className="submission-form-layout">
        <aside className="submission-progress stack stack--small" aria-label="发布进度">
          <p className="eyebrow">草稿完整度</p>
          <strong className="submission-percent">{completion?.percent ?? 0}%</strong>
          <progress value={completion?.completed ?? 0} max={completion?.total ?? 10}>{completion?.percent ?? 0}%</progress>
          <ol tabIndex={0} aria-label="发布步骤，可横向滚动">{submissionFormSteps.map((item, itemIndex) => <li key={item} aria-current={item === step ? 'step' : undefined} className={itemIndex < index ? 'is-complete' : ''}>{submissionFormStepLabels[item]}</li>)}</ol>
          <p>草稿：<code>{draft.id}</code></p>
        </aside>
        <section className="submission-form-panel stack" aria-labelledby="submission-step-heading">
          <div className="cluster cluster--between"><div><p className="eyebrow">模块 {index + 2} / 5</p><h2 id="submission-step-heading">{submissionFormStepLabels[step].replace(/^\d\s/, '')}</h2></div><Tag tone="dashed">自动保存</Tag></div>
          {extractionError ? <ErrorPanel title="自动提取未完成" message={extractionError.message} onRetry={() => setExtractionError(null)} /> : null}
          {body}
          <footer className="submission-step-actions cluster cluster--between"><Button type="button" onClick={goBack}>上一步</Button><Button type="button" variant="primary" onClick={goNext}>{index === submissionFormSteps.length - 1 ? '保存并预览' : '保存并继续'}</Button></footer>
        </section>
      </div>
    </PageFrame>
  )
}
