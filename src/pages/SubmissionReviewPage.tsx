import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, ConfirmDialog, ErrorPanel, PageFrame, Tag, useToast } from '../components'
import {
  resumeSubmission,
  reviewFieldSteps,
  submissionReviewStatusLabels,
  withdrawSubmission,
} from '../features'
import { resolveServiceScenario } from '../mocks'
import { submissionService, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { CoreModule, CreatorRole, PrimaryGoal, SubmissionDraft, SubmissionProjectFields } from '../types'
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

const reviewFieldLabels: Partial<Record<keyof SubmissionProjectFields, string>> = {
  currentName: '作品名称', publicUrl: '公开地址', screenshotUrl: '截图地址', accessStatus: '访问状态', repositoryUrl: '代码仓库', oneLineDefinition: '一句话介绍', targetUsers: '目标用户', coreProblem: '核心问题', useScenarios: '使用场景', mainInputs: '主要输入', mainOutputs: '主要输出', coreFlow: '核心流程', practiceFormats: '练习形式', feedbackMethods: '反馈方式', differentiation: '差异化说明', aiCodingTools: 'AI 编程工具', creatorRoles: '创作者身份', primaryGoals: '建站目的', coreModules: '核心内容',
}

const creatorRoleLabels: Record<CreatorRole, string> = { developer: '开发者', designer: '设计师', product_manager: '产品经理', creator: '创作者', freelancer: '自由职业者', student_recruit: '学生/应届生', researcher_academic: '研究者/学者', multidisciplinary: '跨领域创作者', other: '其他' }
const primaryGoalLabels: Record<PrimaryGoal, string> = { showcase_projects: '展示项目', professional_presence: '职业形象', job_search: '求职', client_acquisition: '获取客户', personal_brand: '个人品牌', academic_profile: '学术档案', content_hub: '内容枢纽', other: '其他' }
const coreModuleLabels: Record<CoreModule, string> = { hero: '首屏', about: '关于', projects: '项目', experience: '经历', skills: '技能', services: '服务', testimonials: '客户评价', contact: '联系', blog: '博客', resume: '简历', publications: '论文', speaking: '演讲', now_page: '近况', other: '其他' }

function list(values: readonly string[] | undefined, labels: Record<string, string>) {
  return values?.length ? values.map((value) => labels[value] ?? value).join('、') : '未填写'
}

function SubmittedVersion({ draft }: { draft: SubmissionDraft }) {
  const fields = draft.submittedFields
  if (!fields) return null
  const portfolio = fields.categoryId === 'personal_site_portfolio'
  return (
    <details className="wire-panel submission-version">
      <summary>查看提交版本</summary>
      <p>这是你提交审核时的内容，之后继续编辑草稿不会改变这份记录。</p>
      <dl className="submission-summary-grid">
        <div><dt>作品名称</dt><dd>{fields.currentName ?? '未填写'}</dd></div>
        <div><dt>一句话介绍</dt><dd>{fields.oneLineDefinition ?? '未填写'}</dd></div>
        <div><dt>公开地址</dt><dd>{fields.publicUrl ?? '未填写'}</dd></div>
        {portfolio ? <>
          <div><dt>创作者身份</dt><dd>{list(fields.creatorRoles, creatorRoleLabels)}</dd></div>
          <div><dt>建站目的</dt><dd>{list(fields.primaryGoals, primaryGoalLabels)}</dd></div>
          <div><dt>核心内容</dt><dd>{list(fields.coreModules, coreModuleLabels)}</dd></div>
          <div><dt>AI 编程工具</dt><dd>{list(fields.aiCodingTools, aiCodingToolLabels)}</dd></div>
        </> : <>
          <div><dt>核心问题</dt><dd>{fields.coreProblem ?? '未填写'}</dd></div>
          <div><dt>目标用户</dt><dd>{list(fields.targetUsers, targetUserLabels)}</dd></div>
          <div><dt>使用场景</dt><dd>{list(fields.useScenarios, scenarioLabels)}</dd></div>
        </>}
      </dl>
      <p><small>提交时间：{draft.submittedAt ? new Date(draft.submittedAt).toLocaleString('zh-CN') : '未记录'}</small></p>
    </details>
  )
}

function PreviewSummary({ draft }: { draft: SubmissionDraft }) {
  const fields = draft.fields
  const portfolio = fields.categoryId === 'personal_site_portfolio'
  return (
    <div className="submission-preview-grid">
      <article className="submission-card-preview stack stack--small" aria-label="社区卡片预览">
        <div className="media-placeholder submission-card-preview__media">{fields.screenshotUrl ? '已提供截图地址' : '16:9 作品截图占位'}</div>
        <div className="cluster"><Tag>{fields.accessStatus ? accessStatusText[fields.accessStatus] : '状态未填写'}</Tag><Tag tone="dashed">{portfolio ? '个人主页与作品集' : 'AI 学习与题库'}</Tag></div>
        <h2>{fields.currentName ?? '未命名作品'}</h2>
        <p>{fields.oneLineDefinition ?? '尚未填写一句话定义'}</p>
        <small>请确认作品卡片中的名称、介绍和状态是否准确。</small>
      </article>
      <section className="wire-panel stack" aria-labelledby="submission-detail-summary">
        <div><h2 id="submission-detail-summary">作品预览</h2></div>
        <dl className="submission-summary-grid">
          {portfolio ? <>
            <div><dt>公开地址</dt><dd>{fields.publicUrl ?? '未填写'}</dd></div>
            <div><dt>创作者身份</dt><dd>{list(fields.creatorRoles, creatorRoleLabels)}</dd></div>
            <div><dt>建站目的</dt><dd>{list(fields.primaryGoals, primaryGoalLabels)}</dd></div>
            <div><dt>核心内容</dt><dd>{list(fields.coreModules, coreModuleLabels)}</dd></div>
          </> : <>
            <div><dt>目标用户</dt><dd>{list(fields.targetUsers, targetUserLabels)}</dd></div>
            <div><dt>核心问题</dt><dd>{fields.coreProblem ?? '未填写'}</dd></div>
            <div><dt>使用场景</dt><dd>{list(fields.useScenarios, scenarioLabels)}</dd></div>
            <div><dt>主要输入</dt><dd>{list(fields.mainInputs, inputTypeLabels)}</dd></div>
            <div><dt>主要输出</dt><dd>{list(fields.mainOutputs, outputTypeLabels)}</dd></div>
            <div><dt>核心流程</dt><dd>{fields.coreFlow?.map((item) => item.label).join(' → ') || '未填写'}</dd></div>
            <div><dt>练习形式</dt><dd>{list(fields.practiceFormats, practiceFormatLabels)}</dd></div>
            <div><dt>反馈方式</dt><dd>{list(fields.feedbackMethods, feedbackMethodLabels)}</dd></div>
          </>}
          <div><dt>AI 编程工具</dt><dd>{list(fields.aiCodingTools, aiCodingToolLabels)}</dd></div>
          {portfolio ? <div><dt>作者公开资产</dt><dd>发布后可在“管理作品”中添加；不会把其他作品的资产记到这里。</dd></div> : <div><dt>复用资产</dt><dd>{draft.assetIds.length ? `${draft.assetIds.length} 项` : '未关联'}</dd></div>}
        </dl>
      </section>
    </div>
  )
}

export function SubmissionReviewPage({ draft }: { draft: SubmissionDraft }) {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [params] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ServiceError | null>(null)
  const [material, setMaterial] = useState(draft.supplementalMaterial)
  const scenario = resolveServiceScenario(params, state.serviceScenario)
  const isEditableSubmission = draft.status === 'draft' || draft.status === 'changes_requested'

  async function submit() {
    if (!isEditableSubmission || busy) return
    setConfirming(false)
    setBusy(true)
    const result = await submissionService.submit(draft, { scenario })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setError(null)
    dispatch({ type: 'DRAFT_UPSERT', draft: result.data })
    if (!draft.submittedAt) dispatch({ type: 'EVENT_LOGGED', event: createPrototypeEvent('project_submitted', { draftId: draft.id }) })
    pushToast(result.data.status === 'approved' ? '审核通过，作品与首次发布动态已生成。' : '提交版本已保存。', 'success')
  }

  async function refreshStatus() {
    if (busy || draft.status === 'approved' || draft.status === 'rejected' || draft.status === 'withdrawn') return
    setBusy(true)
    const result = await submissionService.submit(draft, { scenario })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setError(null)
    dispatch({ type: 'DRAFT_UPSERT', draft: result.data })
  }

  function saveMaterial() {
    dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, supplementalMaterial: material.trim(), updatedAt: '2026-07-31T10:35:00+08:00' } })
    pushToast('补充材料已保存，不会改写提交版本。', 'success')
  }

  function withdraw() {
    dispatch({ type: 'DRAFT_UPSERT', draft: withdrawSubmission(draft) })
    setWithdrawing(false)
    pushToast('审核单已撤回，已提交版本仍可查看。')
  }

  if (draft.status === 'draft') {
    return (
      <PageFrame title="发布预览" description="确认社区卡片、详情摘要与来源说明；只有点击确认提交后才会创建审核状态。">
        <div className="stack">
          <PreviewSummary draft={draft} />
          <aside className="submission-guidance stack stack--small"><strong>提交前请确认</strong><p>请核对从公开页面整理的内容。作品通过收录审核后，如需管理档案，还需要单独完成作者身份验证。</p></aside>
          {error ? <ErrorPanel title="提交未完成" message={error.message} onRetry={error.retryable ? submit : undefined} /> : null}
          <div className="cluster cluster--between"><Link className="button" to={`/submit/new?draft=${draft.id}&step=development`}>返回修改</Link><Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>{busy ? '提交中…' : '确认并提交审核'}</Button></div>
        </div>
        <ConfirmDialog open={confirming} title="提交当前内容？" description="提交后会进入审核，你可以在个人中心查看进度。" confirmLabel="确认提交" onConfirm={submit} onCancel={() => setConfirming(false)} />
      </PageFrame>
    )
  }

  const statusLabel = submissionReviewStatusLabels[draft.status] ?? draft.status
  return (
    <PageFrame title={`审核状态：${statusLabel}`} description="在这里查看审核结果、修改意见和补充材料。预计完成时间无法确认时不会显示倒计时。">
      <div className="stack">
        <section className={`submission-review-state submission-review-state--${draft.status} stack stack--small`} aria-live="polite">
          <div className="cluster cluster--between"><Tag tone={draft.status === 'approved' ? 'strong' : 'dashed'}>{statusLabel}</Tag><span>审核单：{draft.id}</span></div>
          {draft.status === 'pending_review' ? <><h2>提交版本正在等待审核</h2><p>没有可靠的预计完成时间，因此此处不展示倒计时或承诺日期。</p></> : null}
          {draft.status === 'changes_requested' ? <><h2>请根据意见修改后重新提交</h2><p>只需修改审核中指出的内容，其他信息会继续保留。</p></> : null}
          {draft.status === 'rejected' ? <><h2>当前提交未通过</h2><p>{draft.reviewMessages.submission ?? '审核方未提供拒绝原因。'}</p></> : null}
          {draft.status === 'approved' ? <><h2>作品已通过并发布</h2><p>作品已经进入社区，你可以查看详情或分享首次发布动态。</p><div className="cluster"><Link className="button button--primary" to={`/project/${draft.publishedProjectId}`}>进入作品详情</Link><Link className="button" to={`/activity#${draft.publishedEventId}`}>查看首次发布动态</Link></div></> : null}
          {draft.status === 'withdrawn' ? <><h2>审核已撤回</h2><p>提交历史没有删除；你可以继续修改后重新提交。</p><Button onClick={() => dispatch({ type: 'DRAFT_UPSERT', draft: resumeSubmission(draft) })}>恢复为可编辑草稿</Button></> : null}
        </section>

        {draft.status === 'changes_requested' ? <section className="wire-panel stack"><h2>修改意见</h2><ul className="review-message-list">{Object.entries(draft.reviewMessages).map(([field, message]) => { const step = reviewFieldSteps[field as keyof SubmissionProjectFields]; return <li key={field}><div><strong>{reviewFieldLabels[field as keyof SubmissionProjectFields] ?? '需要修改'}</strong><p>{message}</p></div>{step ? <Link className="button" to={`/submit/new?draft=${draft.id}&step=${step}`}>前往修改</Link> : null}</li> })}</ul><Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>修改后重新提交</Button></section> : null}

        {(draft.status === 'pending_review' || draft.status === 'changes_requested') ? <section className="wire-panel stack"><h2>补充材料</h2><p>补充内容只提供给审核人员，不会修改已经提交的作品介绍。</p><label className="field"><span className="field__label">补充说明或公开材料地址</span><textarea className="input textarea" rows={4} value={material} onChange={(event) => setMaterial(event.target.value)} /></label><div className="cluster"><Button onClick={saveMaterial}>保存补充材料</Button><Button disabled={busy} onClick={refreshStatus}>刷新审核状态</Button><Button variant="danger" onClick={() => setWithdrawing(true)}>撤回审核</Button></div></section> : null}

        <SubmittedVersion draft={draft} />
        {error ? <ErrorPanel title="审核状态操作未完成" message={error.message} onRetry={error.retryable ? refreshStatus : undefined} /> : null}
      </div>
      <ConfirmDialog open={confirming} title="重新提交当前修改？" description="审核会以这次修改后的内容为准，之前的提交记录仍会保留。" confirmLabel="重新提交" onConfirm={submit} onCancel={() => setConfirming(false)} />
      <ConfirmDialog open={withdrawing} title="撤回当前审核？" description="审核会停止，已提交版本仍保留并可查看。" confirmLabel="确认撤回" danger onConfirm={withdraw} onCancel={() => setWithdrawing(false)} />
    </PageFrame>
  )
}
