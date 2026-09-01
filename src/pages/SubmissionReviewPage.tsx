import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, ConfirmDialog, ErrorPanel, LivePreview, StatusBeacon, StepRail, Tag, TaskShell, useToast, type StatusTone, type TaskStepItem } from '../components'
import { useOptionalAuthSession } from '../features/auth/AuthSessionContext'
import {
  resumeSubmission,
  reviewFieldSteps,
  submissionCopy,
  submissionReviewStatusLabels,
  withdrawSubmission,
} from '../features'
import { resolveServiceScenario } from '../mocks'
import { makeSubmissionClientRequestId, remoteDraftToLocalDraft, submissionApi, SubmissionApiError, submissionService, type ServiceError } from '../services'
import { createPrototypeEvent, useAppState } from '../state'
import { submissionDraftPreviewFingerprint, type CoreModule, type CreatorRole, type PrimaryGoal, type SubmissionDraft, type SubmissionDraftPreview, type SubmissionProjectFields } from '../types'
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

function reviewFieldLabel(field: string, categoryId: SubmissionProjectFields['categoryId']): string {
  if (field === 'oneLineDefinition') return submissionCopy(categoryId).oneLineLabel
  return reviewFieldLabels[field as keyof SubmissionProjectFields] ?? '需要修改'
}

function isRemoteDraft(draft: SubmissionDraft): boolean {
  return draft.draftId !== undefined || draft.remoteStatus !== undefined
}

function isRemoteSubmissionDraft(draft: SubmissionDraft): boolean {
  return isRemoteDraft(draft)
}

function previewMatchesDraft(draft: SubmissionDraft): draft is SubmissionDraft & { preview: SubmissionDraftPreview } {
  const preview = draft.preview
  if (!preview || draft.version === undefined || draft.checkId === undefined) return false
  return preview.draftVersion === draft.version &&
    preview.checkId === draft.checkId &&
    preview.inputFingerprint === submissionDraftPreviewFingerprint(draft) &&
    preview.mediaReferenceIds.length > 0 &&
    preview.evidenceDraftIds.length > 0
}

function withoutRemotePreview(draft: SubmissionDraft): SubmissionDraft {
  const { preview: _preview, submissionKey: _submissionKey, ...rest } = draft
  void _preview
  void _submissionKey
  return rest
}

function withoutRemotePreviewAndReferences(draft: SubmissionDraft): SubmissionDraft {
  const {
    preview: _preview,
    submissionKey: _submissionKey,
    mediaReferenceIds: _mediaReferenceIds,
    evidenceDraftIds: _evidenceDraftIds,
    ...rest
  } = draft
  void _preview
  void _submissionKey
  void _mediaReferenceIds
  void _evidenceDraftIds
  return { ...rest, mediaReferenceIds: [], evidenceDraftIds: [] }
}

const materialReadinessCodes = new Set([
  'SUBMISSION_MEDIA_REQUIRED',
  'SUBMISSION_COVER_MEDIA_REQUIRED',
  'SUBMISSION_COVER_MEDIA_MISMATCH',
  'SUBMISSION_EVIDENCE_REQUIRED',
  'SUBMISSION_MEDIA_NOT_READY',
  'SUBMISSION_EVIDENCE_NOT_READY',
  'SUBMISSION_EVIDENCE_ATTACHMENT_NOT_READY',
])

function isMaterialReadinessError(error: SubmissionApiError): boolean {
  return materialReadinessCodes.has(error.code)
}

function remotePreviewErrorMessage(error: SubmissionApiError): string {
  if (isMaterialReadinessError(error)) return '尚未确认封面或公开地址证据已准备就绪，请返回“开发与资产”完成材料后重试。'
  if (error.status === 422) return '当前作品信息未通过校验，请返回表单修正内容后重新准备提交材料。'
  if (error.status === 409) return '最新草稿已更新，旧内容未生成预览。请返回最终步骤加载最新草稿后重试。'
  return error.message || '提交预览未生成，当前输入已保留，请重试。'
}

function remoteSubmitErrorMessage(error: SubmissionApiError): string {
  if (error.status === 422) return '当前内容未通过校验，提交尚未创建，请返回“开发与资产”检查封面和公开地址证据。'
  if (error.status === 409) return '最新草稿已更新，提交尚未创建。请返回最终步骤加载最新草稿后重试。'
  return error.message || '提交未完成，当前内容已保留，请重试。'
}

function formatPreviewGeneratedAt(value: string): { label: string; dateTime?: string } {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { label: '时间暂不可用' }
  return {
    label: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date),
    dateTime: value,
  }
}

function reviewTaskSteps(): readonly TaskStepItem[] {
  return [
    { id: 'address', label: '检查地址', state: 'complete' },
    { id: 'prefill', label: '基础信息', state: 'complete' },
    { id: 'definition', label: '定位与用途', state: 'complete' },
    { id: 'solution', label: '核心内容', state: 'complete' },
    { id: 'development', label: '开发与资产', state: 'complete' },
    { id: 'preview', label: '预览与提交', state: 'current' },
  ]
}

function reviewBeacon(status: SubmissionDraft['status'], previewLoading = false): { tone: StatusTone; label: string; detail: string } {
  if (status === 'draft') {
    return previewLoading
      ? { tone: 'progress', label: '正在准备预览', detail: '正在根据最新草稿确认提交内容。' }
      : { tone: 'idle', label: '尚未提交审核', detail: '确认预览后才会创建审核。' }
  }
  if (status === 'pending_review') return { tone: 'progress', label: '正在审核', detail: '提交已接收；这里不提供不可靠的预计时间。' }
  if (status === 'changes_requested') return { tone: 'warning', label: '需要修改', detail: '根据审核意见调整后可以重新提交。' }
  if (status === 'rejected') return { tone: 'error', label: '未通过审核', detail: '你可以查看原因并重新整理内容。' }
  if (status === 'approved') return { tone: 'success', label: '审核已通过', detail: '作品已发布到社区。' }
  if (status === 'withdrawn') return { tone: 'idle', label: '审核已撤回', detail: '已提交版本仍会保留。' }
  return { tone: 'idle', label: '审核状态待确认', detail: '当前状态正在确认，暂时没有可执行的审核操作。' }
}

function ReviewWorkspace({
  title,
  description,
  status,
  previewLoading = false,
  children,
  dialogs,
}: {
  title: string
  description: string
  status: SubmissionDraft['status']
  previewLoading?: boolean
  children: ReactNode
  dialogs?: ReactNode
}) {
  const beacon = reviewBeacon(status, previewLoading)
  return (
    <div className="highfi-scope submission-review-scope">
      <TaskShell
        eyebrow="发布作品"
        title={title}
        description={description}
        rail={<StepRail steps={reviewTaskSteps()} ariaLabel="发布步骤" />}
        aside={<div className="submission-review-aside stack stack--small"><StatusBeacon tone={beacon.tone} label={beacon.label} detail={beacon.detail} /><p className="submission-review-aside__note">第 6 步 / 6：预览与提交</p></div>}
      >
        <div className="submission-review-workspace stack">{children}</div>
      </TaskShell>
      {dialogs}
    </div>
  )
}

function RemotePreviewSummary({ preview }: { preview: SubmissionDraftPreview }) {
  const generatedAt = formatPreviewGeneratedAt(preview.generatedAt)
  return (
    <section className="review-section review-section--remote-preview stack" aria-label="提交预览">
      <div className="stack stack--small">
        <p className="eyebrow">提交预览</p>
        <h2>已准备好的提交内容</h2>
        <p>以下内容根据最新草稿生成，提交时会使用这份预览。</p>
      </div>
      <dl className="submission-summary-grid">
        <div><dt>草稿版本</dt><dd>{preview.draftVersion}</dd></div>
        <div><dt>生成时间</dt><dd><time dateTime={generatedAt.dateTime}>{generatedAt.label}</time></dd></div>
      </dl>
    </section>
  )
}

function SubmittedVersion({ draft }: { draft: SubmissionDraft }) {
  const fields = draft.submittedFields
  if (!fields) return null
  const portfolio = fields.categoryId === 'personal_site_portfolio'
  const copy = submissionCopy(fields.categoryId)
  return (
    <details className="review-section review-section--submitted-version submission-version">
      <summary>查看提交版本</summary>
      <p>这是你提交审核时的内容，之后继续编辑草稿不会改变这份记录。</p>
      <dl className="submission-summary-grid">
        <div><dt>作品名称</dt><dd>{fields.currentName ?? '未填写'}</dd></div>
        <div><dt>{copy.oneLinePreviewLabel}</dt><dd>{fields.oneLineDefinition ?? '未填写'}</dd></div>
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
  const copy = submissionCopy(fields.categoryId)
  return (
    <div className="submission-preview-grid">
      <LivePreview
        ariaLabel="社区卡片预览"
        eyebrow="发布后呈现"
        title="社区卡片预览"
        description="请确认名称、介绍和访问状态是否准确。"
        media={<div className="media-placeholder submission-card-preview__media">{fields.screenshotUrl ? '已提供截图地址' : '暂无作品截图'}</div>}
      >
        <article className="submission-card-preview stack stack--small">
          <div className="cluster"><Tag>{fields.accessStatus ? accessStatusText[fields.accessStatus] : '状态未填写'}</Tag><Tag tone="dashed">{portfolio ? '个人主页与作品集' : 'AI 学习与题库'}</Tag></div>
          <h3>{fields.currentName ?? '未命名作品'}</h3>
          <p>{fields.oneLineDefinition ?? copy.emptyOneLinePreview}</p>
        </article>
      </LivePreview>
      <section className="review-section review-section--summary stack" aria-labelledby="submission-detail-summary">
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
  const auth = useOptionalAuthSession()
  const [params] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ServiceError | null>(null)
  const [remotePreviewError, setRemotePreviewError] = useState<SubmissionApiError | null>(null)
  const [remoteSubmitError, setRemoteSubmitError] = useState<SubmissionApiError | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [remoteRefreshing, setRemoteRefreshing] = useState(false)
  const [remoteRefreshRequired, setRemoteRefreshRequired] = useState(false)
  const [material, setMaterial] = useState(draft.supplementalMaterial)
  const submissionKeyRef = useRef<string | null>(draft.submissionKey ?? null)
  const scenario = resolveServiceScenario(params, state.serviceScenario)
  const remoteSubmission = isRemoteSubmissionDraft(draft)
  const currentRemotePreview = remoteSubmission && previewMatchesDraft(draft) ? draft.preview : null
  const isEditableSubmission = draft.status === 'draft' || draft.status === 'changes_requested'

  useEffect(() => {
    if (!remoteSubmission || remoteRefreshRequired) return
    const preview = draft.preview
    if (preview !== undefined && !previewMatchesDraft(draft)) {
      dispatch({ type: 'DRAFT_UPSERT', draft: withoutRemotePreview(draft) })
      submissionKeyRef.current = null
      return
    }
    if (previewMatchesDraft(draft)) {
      if (submissionKeyRef.current === null && draft.submissionKey !== undefined) submissionKeyRef.current = draft.submissionKey
      return
    }
    if (!draft.draftId || draft.version === undefined || !draft.checkId) return
    const controller = new AbortController()
    let active = true
    setPreviewLoading(true)
    setRemotePreviewError(null)
    void submissionApi.preview({
      draftId: draft.draftId,
      expectedVersion: draft.version,
      checkId: draft.checkId,
      session: auth?.session ?? null,
      signal: controller.signal,
    }).then((preview) => {
      if (!active) return
      const nextDraft = {
        ...draft,
        mediaReferenceIds: [...preview.media_reference_ids],
        evidenceDraftIds: [...preview.evidence_draft_ids],
      }
      const nextPreview: SubmissionDraftPreview = {
        draftVersion: preview.draft_version,
        checkId: preview.check_id,
        previewHash: preview.preview_hash,
        frozenSnapshot: preview.payload_snapshot,
        mediaReferenceIds: [...preview.media_reference_ids],
        evidenceDraftIds: [...preview.evidence_draft_ids],
        generatedAt: preview.generated_at,
        inputFingerprint: submissionDraftPreviewFingerprint(nextDraft),
      }
      submissionKeyRef.current = null
      dispatch({ type: 'DRAFT_UPSERT', draft: { ...nextDraft, preview: nextPreview, submissionKey: undefined } })
      setRemotePreviewError(null)
      setRemoteSubmitError(null)
    }).catch((reason: unknown) => {
      if (!active || controller.signal.aborted) return
      const nextError = reason instanceof SubmissionApiError
        ? reason
        : new SubmissionApiError({
            kind: 'transport',
            code: 'CLIENT_REQUEST_FAILED',
            message: '提交预览未生成，当前输入已保留，请重试。',
            status: null,
            requestId: null,
            retryable: true,
            retryAfterMs: null,
          })
      setRemotePreviewError(nextError)
    }).finally(() => {
      if (active) setPreviewLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [auth?.session, dispatch, draft, previewAttempt, remoteSubmission, remoteRefreshRequired])

  async function refreshRemoteDraftAfterConflict(staleDraft: SubmissionDraft) {
    if (remoteRefreshing || !staleDraft.draftId) return
    setRemoteRefreshing(true)
    setPreviewLoading(true)
    setRemotePreviewError(null)
    try {
      const remote = await submissionApi.get({ draftId: staleDraft.draftId, session: auth?.session ?? null })
      const cleared = withoutRemotePreviewAndReferences(staleDraft)
      const mapped = remoteDraftToLocalDraft(remote, staleDraft.userId, cleared, 'preview', 'remote')
      const latest: SubmissionDraft = {
        ...mapped,
        mediaReferenceIds: [...remote.media_reference_ids],
        evidenceDraftIds: [...remote.evidence_draft_ids],
      }
      dispatch({ type: 'DRAFT_UPSERT', draft: latest })
      setRemoteRefreshRequired(false)
    } catch (reason: unknown) {
      const nextError = reason instanceof SubmissionApiError
        ? reason
        : new SubmissionApiError({
            kind: 'transport',
            code: 'CLIENT_REQUEST_FAILED',
            message: '最新草稿未刷新，当前输入已保留，请重试。',
            status: null,
            requestId: null,
            retryable: true,
            retryAfterMs: null,
          })
      setRemotePreviewError(nextError)
    } finally {
      setRemoteRefreshing(false)
      setPreviewLoading(false)
    }
  }

  async function submitRemote() {
    if (!isEditableSubmission || busy || !remoteSubmission || !currentRemotePreview || !draft.draftId) {
      if (remoteSubmission && !currentRemotePreview && !previewLoading) {
        setRemoteSubmitError(new SubmissionApiError({
          kind: 'protocol',
          code: 'PREVIEW_REQUIRED',
          message: '请先生成有效的提交预览。',
          status: null,
          requestId: null,
          retryable: false,
          retryAfterMs: null,
        }))
      }
      return
    }
    setConfirming(false)
    setBusy(true)
    setRemoteSubmitError(null)
    const submissionKey = submissionKeyRef.current ?? draft.submissionKey ?? makeSubmissionClientRequestId()
    submissionKeyRef.current = submissionKey
    if (draft.submissionKey !== submissionKey) {
      dispatch({ type: 'DRAFT_UPSERT', draft: { ...draft, submissionKey } })
    }
    try {
      const result = await submissionApi.submit({
        draftId: draft.draftId,
        draftVersion: currentRemotePreview.draftVersion,
        checkId: currentRemotePreview.checkId,
        previewHash: currentRemotePreview.previewHash,
        submissionKey,
        session: auth?.session ?? null,
      })
      const nextDraft: SubmissionDraft = {
        ...draft,
        status: 'pending_review',
        remoteStatus: 'submitted',
        reviewStatus: result.review_status,
        submissionId: result.submission_id,
        reviewWorkItemId: result.review_work_item_id,
        submittedFields: draft.submittedFields ?? draft.fields,
        submittedAt: draft.submittedAt ?? result.created_at,
        updatedAt: result.updated_at,
        submissionKey,
      }
      dispatch({ type: 'DRAFT_UPSERT', draft: nextDraft })
      setRemoteSubmitError(null)
      pushToast('提交已进入待审核队列。', 'success')
    } catch (reason: unknown) {
      const nextError = reason instanceof SubmissionApiError
        ? reason
        : new SubmissionApiError({
            kind: 'transport',
            code: 'CLIENT_REQUEST_FAILED',
            message: '网络连接不可用，当前内容已保留。',
            status: null,
            requestId: null,
            retryable: true,
            retryAfterMs: null,
          })
      setRemoteSubmitError(nextError)
      if (nextError.status === 409) {
        const staleDraft = withoutRemotePreviewAndReferences(draft)
        submissionKeyRef.current = null
        setRemoteRefreshRequired(true)
        dispatch({ type: 'DRAFT_UPSERT', draft: staleDraft })
        void refreshRemoteDraftAfterConflict(staleDraft)
      }
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!isEditableSubmission || busy) return
    if (remoteSubmission) {
      await submitRemote()
      return
    }
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
    if (remoteSubmission) {
      const previewError = remotePreviewError ?? remoteSubmitError
      const previewReady = currentRemotePreview !== null
      const retryRemoteError = previewError?.retryable
        ? remoteRefreshRequired
          ? () => { void refreshRemoteDraftAfterConflict(draft) }
          : previewError === remoteSubmitError ? submitRemote : () => setPreviewAttempt((value) => value + 1)
        : undefined
      return (
        <ReviewWorkspace
          title="发布预览"
          description="确认最新草稿、媒体和公开证据已准备就绪；只有有效预览才可以提交审核。"
          status={draft.status}
          previewLoading={previewLoading}
          dialogs={<ConfirmDialog open={confirming} title="提交当前内容？" description="提交后会进入审核队列，你可以随时查看进度。" confirmLabel="确认提交" onConfirm={submitRemote} onCancel={() => setConfirming(false)} />}
        >
          <PreviewSummary draft={draft} />
          {previewReady ? <RemotePreviewSummary preview={currentRemotePreview} /> : <section className="review-section review-section--preview-progress" role="status"><strong>{previewLoading ? '正在生成提交预览' : '等待提交预览'}</strong><p>{previewLoading ? '正在使用最新草稿和检查结果生成预览。' : '没有有效的提交预览，暂时不能提交。'}</p></section>}
          {previewError ? <ErrorPanel title={previewError === remoteSubmitError ? '提交未完成' : '提交预览未生成'} message={previewError === remoteSubmitError ? remoteSubmitErrorMessage(previewError) : remotePreviewErrorMessage(previewError)} onRetry={retryRemoteError} /> : null}
          {previewError && (previewError.status === 422 || isMaterialReadinessError(previewError)) ? <Link className="button" to={`/submit/new?draft=${draft.id}&step=${isMaterialReadinessError(previewError) ? 'development' : 'prefill'}`}>{isMaterialReadinessError(previewError) ? '返回开发与资产' : '返回修正作品信息'}</Link> : null}
          {!previewReady && !previewLoading && !previewError ? <Link className="button" to={`/submit/new?draft=${draft.id}&step=development`}>返回开发与资产</Link> : null}
          <aside className="review-section review-section--guidance submission-guidance stack stack--small"><strong>提交前请确认</strong><p>请核对最新草稿中的作品内容。封面和公开地址证据必须已经准备就绪，提交不会创建本地作品或动态。</p></aside>
          <div className="task-primary-actions cluster cluster--between"><Link className="button" to={`/submit/new?draft=${draft.id}&step=development`}>返回修改</Link><Button variant="primary" disabled={busy || previewLoading || !previewReady} onClick={() => setConfirming(true)}>{busy ? '提交中…' : previewReady ? '确认并提交审核' : '等待提交预览'}</Button></div>
        </ReviewWorkspace>
      )
    }
    return (
      <ReviewWorkspace
        title="发布预览"
        description="确认社区卡片、详情摘要与来源说明；只有点击确认提交后才会创建审核状态。"
        status={draft.status}
        dialogs={<ConfirmDialog open={confirming} title="提交当前内容？" description="提交后会进入审核，你可以随时查看进度。" confirmLabel="确认提交" onConfirm={submit} onCancel={() => setConfirming(false)} />}
      >
        <PreviewSummary draft={draft} />
        <aside className="review-section review-section--guidance submission-guidance stack stack--small"><strong>提交前请确认</strong><p>请核对从公开页面整理的内容。作品通过收录审核后，如需管理档案，还需要单独完成作者身份验证。</p></aside>
        {error ? <ErrorPanel title="提交未完成" message={error.message} onRetry={error.retryable ? submit : undefined} /> : null}
        <div className="task-primary-actions cluster cluster--between"><Link className="button" to={`/submit/new?draft=${draft.id}&step=development`}>返回修改</Link><Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>{busy ? '提交中…' : '确认并提交审核'}</Button></div>
      </ReviewWorkspace>
    )
  }

  if (remoteSubmission) {
    const statusLabel = draft.reviewStatus === 'pending_review' ? '待审核' : submissionReviewStatusLabels[draft.status] ?? draft.status
    return (
      <ReviewWorkspace
        title={`审核状态：${statusLabel}`}
        description="这里显示提交回执与审核状态；暂无可靠的预计完成时间。"
        status="pending_review"
      >
        <section className="review-section review-section--state review-section--pending_review stack stack--small" aria-live="polite">
          <div className="cluster cluster--between"><Tag tone="dashed">{statusLabel}</Tag></div>
          <h2>提交版本正在等待审核</h2>
          <p>提交已接受，审核人员会继续处理；此处不展示倒计时或承诺日期。</p>
          <p className="submission-receipt-note">提交回执与审核记录已生成。</p>
        </section>
        <SubmittedVersion draft={draft} />
      </ReviewWorkspace>
    )
  }

  const statusLabel = submissionReviewStatusLabels[draft.status] ?? draft.status
  const hasKnownReviewPresentation = draft.status === 'pending_review' || draft.status === 'changes_requested' || draft.status === 'rejected' || draft.status === 'approved' || draft.status === 'withdrawn'
  return (
    <ReviewWorkspace
      title={`审核状态：${statusLabel}`}
      description="在这里查看审核结果、修改意见和补充材料。预计完成时间无法确认时不会显示倒计时。"
      status={draft.status}
      dialogs={<><ConfirmDialog open={confirming} title="重新提交当前修改？" description="审核会以这次修改后的内容为准，之前的提交记录仍会保留。" confirmLabel="重新提交" onConfirm={submit} onCancel={() => setConfirming(false)} /><ConfirmDialog open={withdrawing} title="撤回当前审核？" description="审核会停止，已提交版本仍保留并可查看。" confirmLabel="确认撤回" danger onConfirm={withdraw} onCancel={() => setWithdrawing(false)} /></>}
    >
        <section className={`review-section review-section--state review-section--${draft.status} stack stack--small`} aria-live="polite">
          <div className="cluster cluster--between"><Tag tone={draft.status === 'approved' ? 'strong' : 'dashed'}>{statusLabel}</Tag></div>
          {draft.status === 'pending_review' ? <><h2>提交版本正在等待审核</h2><p>没有可靠的预计完成时间，因此此处不展示倒计时或承诺日期。</p></> : null}
          {draft.status === 'changes_requested' ? <><h2>请根据意见修改后重新提交</h2><p>只需修改审核中指出的内容，其他信息会继续保留。</p></> : null}
          {draft.status === 'rejected' ? <><h2>当前提交未通过</h2><p>{draft.reviewMessages.submission ?? '审核方未提供拒绝原因。'}</p></> : null}
          {draft.status === 'approved' ? <><h2>作品已通过并发布</h2><p>作品已经进入社区，你可以查看详情或分享首次发布动态。</p><div className="cluster"><Link className="button button--primary" to={`/project/${draft.publishedProjectId}`}>进入作品详情</Link><Link className="button" to={`/activity#${draft.publishedEventId}`}>查看首次发布动态</Link></div></> : null}
          {draft.status === 'withdrawn' ? <><h2>审核已撤回</h2><p>提交历史没有删除；你可以继续修改后重新提交。</p><Button onClick={() => dispatch({ type: 'DRAFT_UPSERT', draft: resumeSubmission(draft) })}>恢复为可编辑草稿</Button></> : null}
          {!hasKnownReviewPresentation ? <><h2>审核状态待确认</h2><p>当前状态正在确认，暂时没有可执行的审核操作。</p></> : null}
        </section>

        {draft.status === 'changes_requested' ? <section className="review-section review-section--changes stack"><h2>修改意见</h2><ul className="review-message-list">{Object.entries(draft.reviewMessages).map(([field, message]) => { const step = reviewFieldSteps[field as keyof SubmissionProjectFields]; return <li key={field}><div><strong>{reviewFieldLabel(field, draft.fields.categoryId)}</strong><p>{message}</p></div>{step ? <Link className="button" to={`/submit/new?draft=${draft.id}&step=${step}`}>前往修改</Link> : null}</li> })}</ul><Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>修改后重新提交</Button></section> : null}

        {(draft.status === 'pending_review' || draft.status === 'changes_requested') ? <section className="review-section review-section--supplemental stack"><h2>补充材料</h2><p>补充内容只提供给审核人员，不会修改已经提交的作品介绍。</p><label className="field"><span className="field__label">补充说明或公开材料地址</span><textarea className="input textarea" rows={4} value={material} onChange={(event) => setMaterial(event.target.value)} /></label><div className="cluster"><Button onClick={saveMaterial}>保存补充材料</Button><Button disabled={busy} onClick={refreshStatus}>刷新审核状态</Button><Button variant="danger" onClick={() => setWithdrawing(true)}>撤回审核</Button></div></section> : null}

        <SubmittedVersion draft={draft} />
        {error ? <ErrorPanel title="审核状态操作未完成" message={error.message} onRetry={error.retryable ? refreshStatus : undefined} /> : null}
    </ReviewWorkspace>
  )
}
