import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorPanel, Input, LoadingState, PageFrame, Tag, useToast } from '../components'
import { useOptionalAuthSession } from '../features/auth/AuthSessionContext'
import {
  mapSubmissionFieldErrors,
  submissionCompleteness,
  submissionFormStepLabels,
  submissionFormSteps,
  updateDraftField,
  validateSubmissionStep,
  type SubmissionFormStep,
} from '../features/submission/form'
import {
  makeSubmissionClientRequestId,
  remoteDraftToLocalDraft,
  submissionApi,
  SubmissionApiError,
} from '../services/submissionApi'
import { useAppState } from '../state'
import { SubmissionReviewPage } from './SubmissionReviewPage'
import {
  accessStatuses,
  aiCodingTools,
  coreModules,
  creatorRoles,
  feedbackMethods,
  inputTypes,
  outputTypes,
  practiceFormats,
  primaryGoals,
  targetUsers,
  useScenarios,
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

const portfolioLabels: Record<string, string> = {
  personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点', developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者/学者', multidisciplinary: '跨领域创作者', other: '其他', showcase_projects: '展示项目', professional_presence: '职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽', single_page: '单页', multi_page: '多页', top_nav: '顶部导航', side_nav: '侧边导航', section_anchor: '章节锚点', minimal_overlay: '极简浮层', no_persistent_nav: '无常驻导航', hero: '首屏', about: '关于', projects: '项目', experience: '经历', skills: '技能', services: '服务', testimonials: '客户评价', contact: '联系', blog: '博客', resume: '简历', publications: '论文', speaking: '演讲', now_page: '近况', card_grid: '卡片网格', gallery: '画廊', timeline: '时间线', case_study_list: 'Case Study 列表', repository_list: '仓库列表', full_bleed: '通栏展示', mixed: '混合展示', none: '无', summary: '摘要', overview: '概览', deep: '深度 Case Study', minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导', editorial_grid: '编辑网格', bento: 'Bento', split_screen: '分屏', immersive: '沉浸式', freeform: '自由布局', monochrome: '单色', neutral: '中性色', brand_led: '品牌色主导', vivid: '高饱和', gradient_dominant: '渐变主导', light_only: '仅浅色', dark_only: '仅深色', switchable: '可切换', system_adaptive: '跟随系统', static: '静态', light: '轻量', moderate: '中等', high: '高交互', microinteraction: '微交互', scroll_reveal: '滚动出现', scroll_driven: '滚动驱动', page_transition: '页面转场', cursor_effect: '光标效果', '3d_webgl': '3D/WebGL', motion_graphics: '动态图形', confirmed: '已确认响应式', partial: '部分响应式', not_supported: '不支持响应式', unknown: '未知', content_managed: 'CMS 管理',
}

function parseStep(value: string | null, fallback: SubmissionDraft['step']): SubmissionFormStep {
  if (submissionFormSteps.includes(value as SubmissionFormStep)) return value as SubmissionFormStep
  return submissionFormSteps.includes(fallback as SubmissionFormStep) ? fallback as SubmissionFormStep : 'prefill'
}

function isRemoteDraftId(value: string | null): boolean {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function OriginalValue({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return <p className="original-extraction original-extraction--missing"><strong>页面中未找到{label}：</strong>请手动填写。</p>
  const text = value === null ? '空' : Array.isArray(value) ? value.join('、') : String(value)
  return <p className="original-extraction"><strong>页面中识别到的{label}：</strong>{text}</p>
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

function PortfolioDefinitionStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  return <div className="submission-step-fields stack"><section className="submission-guidance"><strong>只确认最重要的定位</strong><p>选择你的身份和建站目的。网站类型、视觉与交互等信息会在公开页面核验后补充，也可以发布后再维护。</p></section><CheckboxField legend="作者身份" values={creatorRoles} selected={draft.fields.creatorRoles ?? []} labels={portfolioLabels} error={draft.validationErrors.creatorRoles} onChange={(value) => update('creatorRoles', value)} /><CheckboxField legend="建站目的" values={primaryGoals} selected={draft.fields.primaryGoals ?? []} labels={portfolioLabels} error={draft.validationErrors.primaryGoals} onChange={(value) => update('primaryGoals', value)} /></div>
}

function PortfolioStructureStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  return <div className="submission-step-fields stack"><section className="submission-guidance"><strong>确认页面里已经存在的核心内容</strong><p>只选择访客可以实际看到的模块。结构、视觉、主题和响应式状态不要求你自行分类。</p></section><CheckboxField legend="核心内容模块" values={coreModules} selected={draft.fields.coreModules ?? []} labels={portfolioLabels} error={draft.validationErrors.coreModules} onChange={(value) => update('coreModules', value)} /></div>
}

function PrefillStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  const fields = draft.fields
  const original = draft.originalExtraction
  return (
    <div className="submission-step-fields stack">
      <section className="submission-guidance"><strong>先核对页面信息</strong><p>我们从公开页面整理了部分内容，你可以直接修改或补充。</p></section>
      <div>
        <Input label="作品名称" value={fields.currentName ?? ''} error={draft.validationErrors.currentName} onChange={(event) => update('currentName', event.target.value)} />
        <OriginalValue label="名称" value={original.currentName} />
      </div>
      <div>
        <label className="field" htmlFor="submission-definition"><span className="field__label">{fields.categoryId === 'personal_site_portfolio' ? '一句话简介' : '一句话定义'}</span><textarea id="submission-definition" className="input textarea" value={fields.oneLineDefinition ?? ''} aria-invalid={Boolean(draft.validationErrors.oneLineDefinition)} aria-describedby={draft.validationErrors.oneLineDefinition ? 'submission-definition-error' : undefined} onChange={(event) => update('oneLineDefinition', event.target.value)} /></label>
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
        {fields.categoryId === 'personal_site_portfolio' ? <section className="submission-guidance" aria-label="公开访问检查结果"><strong>公开访问状态由地址检查确认</strong><p>{fields.accessStatus ? accessStatusText[fields.accessStatus] : '当前状态将在审核时核验，你不需要自行判断。'}</p></section> : <><label className="field" htmlFor="submission-access-status"><span className="field__label">基础访问状态（必填）</span><select id="submission-access-status" className="input" value={fields.accessStatus ?? ''} aria-invalid={Boolean(draft.validationErrors.accessStatus)} aria-describedby={draft.validationErrors.accessStatus ? 'submission-access-status-error' : undefined} onChange={(event) => update('accessStatus', event.target.value as SubmissionProjectFields['accessStatus'])}><option value="">请选择</option>{accessStatuses.map((status) => <option key={status} value={status}>{accessStatusText[status]}</option>)}</select></label>{draft.validationErrors.accessStatus ? <p id="submission-access-status-error" className="field-error" role="alert">{draft.validationErrors.accessStatus}</p> : null}</>}
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

function DevelopmentStep({ draft, update }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void }) {
  return (
    <div className="submission-step-fields stack">
      <CheckboxField legend="AI 编程工具" values={aiCodingTools} selected={draft.fields.aiCodingTools ?? []} labels={aiCodingToolLabels} optional onChange={(value) => update('aiCodingTools', value)} />
      <section className="submission-guidance"><strong>截图、资产与证据稍后补充</strong><p>本轮只保存草稿的可编辑字段，不读取或展示本地示例资产。</p></section>
    </div>
  )
}

function readableApiError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function SubmitFormPage() {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const auth = useOptionalAuthSession()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const draftId = searchParams.get('draft')
  const requestedStep = searchParams.get('step')
  const user = state.session.user
  const remoteDraft = isRemoteDraftId(draftId)
  const legacyPreview = import.meta.env.MODE === 'test' && requestedStep === 'preview' && !remoteDraft
  const draftsRef = useRef(state.submissionDrafts)
  draftsRef.current = state.submissionDrafts
  const localDraft = state.submissionDrafts.find((item) => item.userId === user?.id && (item.id === draftId || item.draftId === draftId))
  const step = parseStep(requestedStep, localDraft?.step ?? 'prefill')
  const [loadingRemote, setLoadingRemote] = useState(Boolean(draftId))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<SubmissionApiError | null>(null)
  const [expired, setExpired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)
  const saveOperationRef = useRef<{ key: string; id: string } | null>(null)
  const retryStepRef = useRef<SubmissionFormStep | undefined>(undefined)

  useEffect(() => {
    if (!draftId || !user || !remoteDraft) {
      setLoadingRemote(false)
      return
    }
    const controller = new AbortController()
    setLoadingRemote(true)
    setLoadError(null)
    setExpired(false)
    void submissionApi.get({ draftId, session: auth?.session ?? null, signal: controller.signal })
      .then((remote) => {
        if (controller.signal.aborted) return
        const previous = draftsRef.current.find((item) => item.userId === user.id && (item.id === draftId || item.draftId === draftId))
        const next = remoteDraftToLocalDraft(remote, user.id, previous, step)
        dispatch({ type: 'DRAFT_UPSERT', draft: next })
        setSaveError(null)
        setLoadError(null)
        if (next.remoteStatus === 'expired') setExpired(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof SubmissionApiError && error.kind === 'aborted') return
        if (error instanceof SubmissionApiError && error.status === 410) setExpired(true)
        setLoadError(readableApiError(error, '远端草稿未加载，当前输入已保留。'))
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingRemote(false) })
    return () => controller.abort()
  }, [auth?.session, dispatch, draftId, loadNonce, remoteDraft, step, user])

  const draft = state.submissionDrafts.find((item) => item.userId === user?.id && (item.id === draftId || item.draftId === draftId))
  const completion = useMemo(() => draft ? submissionCompleteness(draft) : null, [draft])

  if (!user) {
    const returnPath = encodeURIComponent(`${location.pathname}${location.search}`)
    return <PageFrame title="发布编辑"><section className="submit-login-callout stack"><h2>请先登录</h2><Link className="button button--primary" to={`/auth?return_to=${returnPath}`}>登录并返回当前草稿</Link></section></PageFrame>
  }
  if (legacyPreview && draft) return <SubmissionReviewPage draft={draft} />
  if (loadingRemote && !draft) return <PageFrame title="发布编辑"><LoadingState label="正在恢复远端草稿" /></PageFrame>
  if (!draft) return <PageFrame title="未找到发布草稿" description={loadError ?? '草稿可能不存在、属于其他身份或已经删除。'}><Link className="button" to="/submit">返回地址检查</Link></PageFrame>
  if (expired) return <PageFrame title="草稿已过期" description="该远端草稿已停止编辑，请重新检查公开地址后创建新的草稿。"><Link className="button button--primary" to={`/submit?resumeUrl=${encodeURIComponent(draft.fields.publicUrl ?? '')}`}>重新检查地址</Link></PageFrame>

  const update = <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => {
    setSaved(false)
    setSaveError(null)
    dispatch({ type: 'DRAFT_UPSERT', draft: updateDraftField(draft, field, value) })
  }
  const index = submissionFormSteps.indexOf(step)

  const patchDraft = async (nextStep?: SubmissionFormStep) => {
    retryStepRef.current = nextStep
    if (!draft.draftId || draft.version === undefined) {
      setSaveError(null)
      pushToast('远端草稿版本尚未加载，请稍后重试。', 'error')
      return
    }
    const key = `${draft.draftId}:${draft.version}:${nextStep ?? step}:${JSON.stringify(draft.fields)}`
    const operationId = saveOperationRef.current?.key === key
      ? saveOperationRef.current.id
      : makeSubmissionClientRequestId()
    saveOperationRef.current = { key, id: operationId }
    setSaving(true)
    setSaveError(null)
    try {
      const remote = await submissionApi.patch({
        draftId: draft.draftId,
        expectedVersion: draft.version,
        fields: draft.fields,
        session: auth?.session ?? null,
        operationId,
      })
      const next = remoteDraftToLocalDraft(remote, user.id, undefined, nextStep ?? step)
      dispatch({ type: 'DRAFT_UPSERT', draft: { ...next, validationErrors: {} } })
      saveOperationRef.current = null
      setSaveError(null)
      if (nextStep) {
        navigate(`/submit/new?${new URLSearchParams({ draft: next.id, step: nextStep })}`)
      } else {
        setSaved(true)
        pushToast('草稿已保存。', 'success')
      }
    } catch (error) {
      if (error instanceof SubmissionApiError) {
        setSaveError(error)
        if (error.status === 410) setExpired(true)
        if (error.status === 422) {
          const fieldErrors = mapSubmissionFieldErrors(error.fieldErrors)
          if (Object.keys(fieldErrors).length) {
            dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, validationErrors: { ...draft.validationErrors, ...fieldErrors } } })
            requestAnimationFrame(() => document.querySelector<HTMLElement>('.submission-form-panel [aria-invalid="true"]')?.focus())
          }
        }
      } else {
        setSaveError(null)
        pushToast(readableApiError(error, '草稿未保存，当前输入已保留。'), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const reloadServerVersion = () => {
    setLoadNonce((value) => value + 1)
    setSaveError(null)
  }

  const goNext = () => {
    const errors = validateSubmissionStep(draft, step)
    if (Object.keys(errors).length) {
      dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, validationErrors: { ...draft.validationErrors, ...errors } } })
      pushToast('请先完成当前步骤的必填字段。', 'error')
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.submission-form-panel [aria-invalid="true"]')?.focus())
      return
    }
    const next = index === submissionFormSteps.length - 1 ? undefined : submissionFormSteps[index + 1]
    void patchDraft(next)
  }

  const retrySave = () => { void patchDraft(retryStepRef.current) }
  const goBack = () => {
    if (index === 0) { navigate(`/submit?resumeUrl=${encodeURIComponent(draft.fields.publicUrl ?? '')}`); return }
    const previous = submissionFormSteps[index - 1]!
    dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, step: previous, updatedAt: new Date().toISOString() } })
    navigate(`/submit/new?${new URLSearchParams({ draft: draft.id, step: previous })}`)
  }

  let body: ReactNode
  if (step === 'prefill') body = <PrefillStep draft={draft} update={update} />
  else if (step === 'definition') body = draft.fields.categoryId === 'personal_site_portfolio' ? <PortfolioDefinitionStep draft={draft} update={update} /> : <DefinitionStep draft={draft} update={update} />
  else if (step === 'solution') body = draft.fields.categoryId === 'personal_site_portfolio' ? <PortfolioStructureStep draft={draft} update={update} /> : <SolutionStep draft={draft} update={update} />
  else body = <DevelopmentStep draft={draft} update={update} />

  return (
    <PageFrame title="发布新作品" description={draft.fields.categoryId === 'personal_site_portfolio' ? '确认作品名称、介绍、公开地址、创作者身份、建站目的和核心内容；其他信息可以发布后补充。' : '分步补充作品介绍、解决方案和开发信息，未完成的内容会自动保存。'}>
      <div className="submission-form-layout">
        <aside className="submission-progress stack stack--small" aria-label="发布进度">
          <p className="eyebrow">填写进度</p>
          <strong className="submission-percent">{completion?.percent ?? 0}%</strong>
          <progress value={completion?.completed ?? 0} max={completion?.total ?? 10}>{completion?.percent ?? 0}%</progress>
          <ol tabIndex={0} aria-label="发布步骤，可横向滚动">{submissionFormSteps.map((item, itemIndex) => <li key={item} aria-current={item === step ? 'step' : undefined} className={itemIndex < index ? 'is-complete' : ''}>{draft.fields.categoryId === 'personal_site_portfolio' ? ({ prefill: '1 基础信息', definition: '2 定位与用途', solution: '3 核心内容', development: '4 开发与资产' } as const)[item] : submissionFormStepLabels[item]}</li>)}</ol>
          <p>内容先缓存在本机，保存时同步远端</p>
        </aside>
        <section className="submission-form-panel stack" aria-labelledby="submission-step-heading">
          <div className="cluster cluster--between"><div><p className="eyebrow">步骤 {index + 1} / 4</p><h2 id="submission-step-heading">{draft.fields.categoryId === 'personal_site_portfolio' ? ({ prefill: '基础信息', definition: '定位与用途', solution: '核心内容', development: '开发与资产' } as const)[step] : submissionFormStepLabels[step].replace(/^\d\s/, '')}</h2></div><div className="cluster"><Tag tone="dashed">{draft.fields.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库'}</Tag><Tag tone="dashed">远端草稿</Tag></div></div>
          {loadError ? <ErrorPanel title="远端草稿未加载" message={loadError} onRetry={() => setLoadNonce((value) => value + 1)} /> : null}
          {saveError ? <ErrorPanel title={saveError.status === 409 ? '草稿版本冲突' : '草稿未保存'} message={saveError.status === 409 ? '服务端已有更新，未覆盖你的输入。请先加载服务端版本，再合并后保存。' : saveError.message} onRetry={saveError.status === 409 || saveError.status === 410 || saveError.status === 422 ? undefined : retrySave} /> : null}
          {saveError?.status === 409 ? <Button type="button" onClick={reloadServerVersion}>加载服务端版本</Button> : null}
          {saved ? <div className="feedback" role="status"><strong>草稿已保存</strong><p>当前版本已同步到服务端。</p></div> : null}
          {body}
          <footer className="submission-step-actions cluster cluster--between"><Button type="button" onClick={goBack}>上一步</Button><Button type="button" variant="primary" loading={saving} disabled={saved} onClick={goNext}>{index === submissionFormSteps.length - 1 ? (saved ? '草稿已保存' : '保存草稿') : '保存并继续'}</Button></footer>
        </section>
      </div>
    </PageFrame>
  )
}
