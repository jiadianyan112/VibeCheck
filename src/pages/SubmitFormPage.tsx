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
import { projects, resolveServiceScenario, reusableAssets } from '../mocks'
import { submissionService, type ServiceError } from '../services'
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

const portfolioLabels: Record<string, string> = {
  personal_homepage: '个人主页', portfolio: '作品集', online_resume: '在线简历', academic_homepage: '学术主页', hybrid: '混合站点', developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者/学者', multidisciplinary: '跨领域创作者', other: '其他', showcase_projects: '展示项目', professional_presence: '职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽', single_page: '单页', multi_page: '多页', top_nav: '顶部导航', side_nav: '侧边导航', section_anchor: '章节锚点', minimal_overlay: '极简浮层', no_persistent_nav: '无常驻导航', hero: '首屏', about: '关于', projects: '项目', experience: '经历', skills: '技能', services: '服务', testimonials: '客户评价', contact: '联系', blog: '博客', resume: '简历', publications: '论文', speaking: '演讲', now_page: '近况', card_grid: '卡片网格', gallery: '画廊', timeline: '时间线', case_study_list: 'Case Study 列表', repository_list: '仓库列表', full_bleed: '通栏展示', mixed: '混合展示', none: '无', summary: '摘要', overview: '概览', deep: '深度 Case Study', minimal: '极简', editorial: '编辑感', brutalist: '粗野主义', playful: '趣味', retro: '复古', corporate: '专业商务', experimental: '实验性', illustrative: '插画主导', photographic: '摄影主导', typographic: '字体主导', editorial_grid: '编辑网格', bento: 'Bento', split_screen: '分屏', immersive: '沉浸式', freeform: '自由布局', monochrome: '单色', neutral: '中性色', brand_led: '品牌色主导', vivid: '高饱和', gradient_dominant: '渐变主导', light_only: '仅浅色', dark_only: '仅深色', switchable: '可切换', system_adaptive: '跟随系统', static: '静态', light: '轻量', moderate: '中等', high: '高交互', microinteraction: '微交互', scroll_reveal: '滚动出现', scroll_driven: '滚动驱动', page_transition: '页面转场', cursor_effect: '光标效果', '3d_webgl': '3D/WebGL', motion_graphics: '动态图形', confirmed: '已确认响应式', partial: '部分响应式', not_supported: '不支持响应式', unknown: '未知', content_managed: 'CMS 管理',
}

function parseStep(value: string | null, fallback: SubmissionDraft['step']): SubmissionFormStep {
  if (submissionFormSteps.includes(value as SubmissionFormStep)) return value as SubmissionFormStep
  return submissionFormSteps.includes(fallback as SubmissionFormStep) ? fallback as SubmissionFormStep : 'prefill'
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

function DevelopmentStep({ draft, update, updateAssets }: { draft: SubmissionDraft; update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void; updateAssets: (ids: AssetId[]) => void }) {
  const relevantAssets = reusableAssets.filter((asset) => projects.find((project) => project.id === asset.projectId)?.categoryId === (draft.fields.categoryId ?? 'ai_learning_quiz'))
  return (
    <div className="submission-step-fields stack">
      <CheckboxField legend="AI 编程工具" values={aiCodingTools} selected={draft.fields.aiCodingTools ?? []} labels={aiCodingToolLabels} optional onChange={(value) => update('aiCodingTools', value)} />
      {draft.fields.categoryId === 'personal_site_portfolio' ? <section className="submission-guidance"><strong>资产归属会单独确认</strong><p>发布后可在“管理作品”中添加你公开提供的源码、模板或组件。复用其他作品的资产应在比较行动中记录，不会显示成你的作品资产。</p></section> : <fieldset className="submission-choice-field"><legend>关联可复用资产（可跳过）</legend><div className="submission-asset-grid">{relevantAssets.map((asset) => <label className="choice-card" key={asset.id}><input type="checkbox" checked={draft.assetIds.includes(asset.id)} onChange={(event) => updateAssets(event.target.checked ? [...draft.assetIds, asset.id] : draft.assetIds.filter((id) => id !== asset.id))} /><span><strong>{asset.name}</strong><small>{asset.type} · {asset.license}</small></span></label>)}</div></fieldset>}
      <section className="submission-guidance"><strong>这些内容可以稍后补充</strong><p>截图、代码仓库、开发工具和公开资产都可以在发布后继续更新。</p></section>
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
  const extractionFieldCount = draft
    ? Object.keys(draft.originalExtraction).filter(
        (field) => field !== 'publicUrl' && field !== 'categoryId',
      ).length
    : 0
  const extractionUrl = draft?.fields.publicUrl ?? ''

  useEffect(() => {
    if (!draft || step !== 'prefill' || extractionFieldCount > 0 || extractionError) return
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
  if (!draft) return <PageFrame title="未找到发布草稿" description="草稿可能不存在、属于其他身份或已经删除。"><Link className="button" to="/submit">返回地址检查</Link></PageFrame>
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
  if (step === 'prefill') body = extracting ? <LoadingState label="正在读取公开页面信息" /> : <PrefillStep draft={draft} update={update} />
  else if (step === 'definition') body = draft.fields.categoryId === 'personal_site_portfolio' ? <PortfolioDefinitionStep draft={draft} update={update} /> : <DefinitionStep draft={draft} update={update} />
  else if (step === 'solution') body = draft.fields.categoryId === 'personal_site_portfolio' ? <PortfolioStructureStep draft={draft} update={update} /> : <SolutionStep draft={draft} update={update} />
  else body = <DevelopmentStep draft={draft} update={update} updateAssets={updateAssets} />

  return (
    <PageFrame title="发布新作品" description={draft.fields.categoryId === 'personal_site_portfolio' ? '确认作品名称、介绍、公开地址、创作者身份、建站目的和核心内容；其他信息可以发布后补充。' : '分步补充作品介绍、解决方案和开发信息，未完成的内容会自动保存。'}>
      <div className="submission-form-layout">
        <aside className="submission-progress stack stack--small" aria-label="发布进度">
          <p className="eyebrow">填写进度</p>
          <strong className="submission-percent">{completion?.percent ?? 0}%</strong>
          <progress value={completion?.completed ?? 0} max={completion?.total ?? 10}>{completion?.percent ?? 0}%</progress>
          <ol tabIndex={0} aria-label="发布步骤，可横向滚动">{submissionFormSteps.map((item, itemIndex) => <li key={item} aria-current={item === step ? 'step' : undefined} className={itemIndex < index ? 'is-complete' : ''}>{draft.fields.categoryId === 'personal_site_portfolio' ? ({ prefill: '1 基础信息', definition: '2 定位与用途', solution: '3 核心内容', development: '4 开发与资产' } as const)[item] : submissionFormStepLabels[item]}</li>)}</ol>
          <p>内容会自动保存</p>
        </aside>
        <section className="submission-form-panel stack" aria-labelledby="submission-step-heading">
          <div className="cluster cluster--between"><div><p className="eyebrow">步骤 {index + 1} / 4</p><h2 id="submission-step-heading">{draft.fields.categoryId === 'personal_site_portfolio' ? ({ prefill: '基础信息', definition: '定位与用途', solution: '核心内容', development: '开发与资产' } as const)[step] : submissionFormStepLabels[step].replace(/^\d\s/, '')}</h2></div><div className="cluster"><Tag tone="dashed">{draft.fields.categoryId === 'personal_site_portfolio' ? '个人主页与作品集' : 'AI 学习与题库'}</Tag><Tag tone="dashed">自动保存</Tag></div></div>
          {extractionError ? <ErrorPanel title="自动提取未完成" message={extractionError.message} onRetry={() => setExtractionError(null)} /> : null}
          {body}
          <footer className="submission-step-actions cluster cluster--between"><Button type="button" onClick={goBack}>上一步</Button><Button type="button" variant="primary" onClick={goNext}>{index === submissionFormSteps.length - 1 ? '保存并预览' : '保存并继续'}</Button></footer>
        </section>
      </div>
    </PageFrame>
  )
}
