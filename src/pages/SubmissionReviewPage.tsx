import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, ConfirmDialog, ErrorPanel, PageFrame, Tag, useToast } from '../components'
import {
  resumeSubmission,
  reviewFieldSteps,
  submissionReviewStatusLabels,
  withdrawSubmission,
} from '../features'
import { serviceScenarioIds, submissionService, type ServiceError, type ServiceScenarioId } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import type { SubmissionDraft, SubmissionProjectFields } from '../types'
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

const reviewScenarioLabels: Record<string, string> = {
  default: '待审核',
  review_changes_requested: '需修改',
  review_approved: '通过',
  review_rejected: '拒绝',
}

const reviewFieldLabels: Partial<Record<keyof SubmissionProjectFields, string>> = {
  currentName: '作品名称', publicUrl: '公开地址', screenshotUrl: '截图地址', accessStatus: '访问状态', repositoryUrl: '代码仓库', oneLineDefinition: '一句话定义', targetUsers: '目标用户', coreProblem: '核心问题', useScenarios: '使用场景', mainInputs: '主要输入', mainOutputs: '主要输出', coreFlow: '核心流程', practiceFormats: '练习形式', feedbackMethods: '反馈方式', differentiation: '差异化说明', aiCodingTools: 'AI 编程工具',
}

function list(values: readonly string[] | undefined, labels: Record<string, string>) {
  return values?.length ? values.map((value) => labels[value] ?? value).join('、') : '未填写'
}

function SubmittedVersion({ draft }: { draft: SubmissionDraft }) {
  const fields = draft.submittedFields
  if (!fields) return null
  return (
    <details className="wire-panel submission-version">
      <summary>查看提交版本</summary>
      <p>这是送审时冻结的版本；之后在编辑器中的修改不会悄悄覆盖它。</p>
      <dl className="submission-summary-grid">
        <div><dt>作品名称</dt><dd>{fields.currentName ?? '未填写'}</dd></div>
        <div><dt>一句话定义</dt><dd>{fields.oneLineDefinition ?? '未填写'}</dd></div>
        <div><dt>公开地址</dt><dd>{fields.publicUrl ?? '未填写'}</dd></div>
        <div><dt>核心问题</dt><dd>{fields.coreProblem ?? '未填写'}</dd></div>
        <div><dt>目标用户</dt><dd>{list(fields.targetUsers, targetUserLabels)}</dd></div>
        <div><dt>使用场景</dt><dd>{list(fields.useScenarios, scenarioLabels)}</dd></div>
      </dl>
      <p><small>提交时间：{draft.submittedAt ? new Date(draft.submittedAt).toLocaleString('zh-CN') : '未记录'}</small></p>
    </details>
  )
}

function PreviewSummary({ draft }: { draft: SubmissionDraft }) {
  const fields = draft.fields
  return (
    <div className="submission-preview-grid">
      <article className="submission-card-preview stack stack--small" aria-label="社区卡片预览">
        <div className="media-placeholder submission-card-preview__media">{fields.screenshotUrl ? '已提供截图地址' : '16:9 作品截图占位'}</div>
        <div className="cluster"><Tag>{fields.accessStatus ? accessStatusText[fields.accessStatus] : '状态未填写'}</Tag><Tag tone="dashed">用户提交</Tag></div>
        <h2>{fields.currentName ?? '未命名作品'}</h2>
        <p>{fields.oneLineDefinition ?? '尚未填写一句话定义'}</p>
        <small>卡片预览仅用于确认展示结构，不代表已通过平台审核。</small>
      </article>
      <section className="wire-panel stack" aria-labelledby="submission-detail-summary">
        <div><p className="eyebrow">Detail summary</p><h2 id="submission-detail-summary">详情摘要</h2></div>
        <dl className="submission-summary-grid">
          <div><dt>目标用户</dt><dd>{list(fields.targetUsers, targetUserLabels)}</dd></div>
          <div><dt>核心问题</dt><dd>{fields.coreProblem ?? '未填写'}</dd></div>
          <div><dt>使用场景</dt><dd>{list(fields.useScenarios, scenarioLabels)}</dd></div>
          <div><dt>主要输入</dt><dd>{list(fields.mainInputs, inputTypeLabels)}</dd></div>
          <div><dt>主要输出</dt><dd>{list(fields.mainOutputs, outputTypeLabels)}</dd></div>
          <div><dt>核心流程</dt><dd>{fields.coreFlow?.map((item) => item.label).join(' → ') || '未填写'}</dd></div>
          <div><dt>练习形式</dt><dd>{list(fields.practiceFormats, practiceFormatLabels)}</dd></div>
          <div><dt>反馈方式</dt><dd>{list(fields.feedbackMethods, feedbackMethodLabels)}</dd></div>
          <div><dt>AI 编程工具</dt><dd>{list(fields.aiCodingTools, aiCodingToolLabels)}</dd></div>
          <div><dt>复用资产</dt><dd>{draft.assetIds.length ? `${draft.assetIds.length} 项` : '未关联'}</dd></div>
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
  const requested = params.get('scenario') as ServiceScenarioId | null
  const scenario = requested && serviceScenarioIds.includes(requested) ? requested : state.serviceScenario
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
          <aside className="submission-guidance stack stack--small"><strong>来源说明</strong><p>当前内容来自用户提交与公开页面自动提取。原始提取值已保留；平台审核只确认是否可收录，不自动证明提交者是作者。</p></aside>
          {error ? <ErrorPanel title="提交未完成" message={error.message} detail={error.code} onRetry={error.retryable ? submit : undefined} /> : null}
          <div className="cluster cluster--between"><Link className="button" to={`/submit/new?draft=${draft.id}&step=development`}>返回修改</Link><Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>{busy ? '提交中…' : '确认并提交审核'}</Button></div>
        </div>
        <ConfirmDialog open={confirming} title="提交当前版本？" description="提交后会冻结一个可回看的版本，并创建一份审核记录；不会虚构审核完成时间。" confirmLabel="确认提交" onConfirm={submit} onCancel={() => setConfirming(false)} />
      </PageFrame>
    )
  }

  const statusLabel = submissionReviewStatusLabels[draft.status] ?? draft.status
  return (
    <PageFrame title={`审核状态：${statusLabel}`} description="状态来自固定原型场景。平台不会显示没有依据的预计审核时间。">
      <div className="stack">
        <section className={`submission-review-state submission-review-state--${draft.status} stack stack--small`} aria-live="polite">
          <div className="cluster cluster--between"><Tag tone={draft.status === 'approved' ? 'strong' : 'dashed'}>{statusLabel}</Tag><span>审核单：{draft.id}</span></div>
          {draft.status === 'pending_review' ? <><h2>提交版本正在等待审核</h2><p>没有可靠的预计完成时间，因此此处不展示倒计时或承诺日期。</p></> : null}
          {draft.status === 'changes_requested' ? <><h2>请按字段补充后重新提交</h2><p>审核意见只定位到相关字段，未被指出的内容不会被清空。</p></> : null}
          {draft.status === 'rejected' ? <><h2>当前提交未通过</h2><p>{draft.reviewMessages.submission ?? '审核方未提供拒绝原因。'}</p></> : null}
          {draft.status === 'approved' ? <><h2>作品已通过并发布</h2><p>稳定作品 ID 与首次发布事件已生成，刷新或返回不会创建重复记录。</p><div className="cluster"><Link className="button button--primary" to={`/project/${draft.publishedProjectId}`}>进入作品详情</Link><Link className="button" to={`/activity#${draft.publishedEventId}`}>查看首次发布动态</Link></div></> : null}
          {draft.status === 'withdrawn' ? <><h2>审核已撤回</h2><p>提交历史没有删除；你可以继续修改后重新提交。</p><Button onClick={() => dispatch({ type: 'DRAFT_UPSERT', draft: resumeSubmission(draft) })}>恢复为可编辑草稿</Button></> : null}
        </section>

        {draft.status === 'changes_requested' ? <section className="wire-panel stack"><h2>按字段修改</h2><ul className="review-message-list">{Object.entries(draft.reviewMessages).map(([field, message]) => { const step = reviewFieldSteps[field as keyof SubmissionProjectFields]; return <li key={field}><div><strong>{reviewFieldLabels[field as keyof SubmissionProjectFields] ?? field}</strong><p>{message}</p></div>{step ? <Link className="button" to={`/submit/new?draft=${draft.id}&step=${step}`}>定位并修改</Link> : null}</li> })}</ul><Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>补充后重新提交</Button></section> : null}

        {(draft.status === 'pending_review' || draft.status === 'changes_requested') ? <section className="wire-panel stack"><h2>补充材料</h2><p>材料只附在审核单上，不会覆盖已冻结的提交字段。</p><label className="field"><span className="field__label">补充说明或公开材料地址</span><textarea className="input textarea" rows={4} value={material} onChange={(event) => setMaterial(event.target.value)} /></label><div className="cluster"><Button onClick={saveMaterial}>保存补充材料</Button><Button disabled={busy} onClick={refreshStatus}>刷新审核状态</Button><Button variant="danger" onClick={() => setWithdrawing(true)}>撤回审核</Button></div></section> : null}

        <SubmittedVersion draft={draft} />
        <aside className="submission-guidance"><strong>固定场景</strong><p>当前：{reviewScenarioLabels[scenario] ?? scenario}。可通过调试面板或 URL 的 scenario 参数切换 pending、changes_requested、approved、rejected。</p></aside>
        {error ? <ErrorPanel title="审核状态操作未完成" message={error.message} detail={error.code} onRetry={error.retryable ? refreshStatus : undefined} /> : null}
      </div>
      <ConfirmDialog open={confirming} title="重新提交当前修改？" description="这会将当前字段冻结为新的提交版本，保留同一份审核单标识。" confirmLabel="重新提交" onConfirm={submit} onCancel={() => setConfirming(false)} />
      <ConfirmDialog open={withdrawing} title="撤回当前审核？" description="审核会停止，已提交版本仍保留并可查看。" confirmLabel="确认撤回" danger onConfirm={withdraw} onCancel={() => setWithdrawing(false)} />
    </PageFrame>
  )
}
