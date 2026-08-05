import { useMemo, useState } from 'react'
import { Button, ConfirmDialog, EmptyState, Tag } from '../components'
import { applyPublicationWorkflow, isAdminWorkflowAllowed, mergeAdminProjects, restrictProjectDisplay, submissionReviewStatusLabels, type PublicationDecision } from '../features'
import { adminReviewDrafts, projects } from '../mocks'
import { useAppState } from '../state'
import type { SubmissionDraft } from '../types'

function mergeDrafts(base: readonly SubmissionDraft[], overrides: readonly SubmissionDraft[]) {
  const byId = new Map(overrides.map((draft) => [draft.id, draft]))
  const baseIds = new Set(base.map((draft) => draft.id))
  return [...base.map((draft) => byId.get(draft.id) ?? draft), ...overrides.filter((draft) => !baseIds.has(draft.id))]
}

const decisionLabels: Record<PublicationDecision, string> = {
  approve: '通过并发布', return: '退回补充', reject: '拒绝收录', dispute: '标记争议',
}

export function AdminReviewsPage() {
  const { state, dispatch } = useAppState()
  const actor = state.session.user!
  const drafts = useMemo(() => mergeDrafts(adminReviewDrafts, state.submissionDrafts).filter((draft) => draft.status !== 'draft' && draft.status !== 'withdrawn'), [state.submissionDrafts])
  const allProjects = useMemo(() => mergeAdminProjects(projects, state.projectOverrides), [state.projectOverrides])
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ kind: 'publication'; draftId: SubmissionDraft['id']; decision: PublicationDecision } | { kind: 'restrict'; projectId: (typeof projects)[number]['id'] } | null>(null)
  const [restrictId, setRestrictId] = useState(allProjects[0]?.id ?? projects[0]!.id)

  function requestPublication(draft: SubmissionDraft, decision: PublicationDecision) {
    if (!reason.trim()) { setError('所有审核操作都必须填写原因。'); return }
    setError(null)
    setPending({ kind: 'publication', draftId: draft.id, decision })
  }

  function requestRestriction() {
    if (!reason.trim()) { setError('限制展示必须填写原因。'); return }
    setError(null)
    setPending({ kind: 'restrict', projectId: restrictId })
  }

  function confirm() {
    if (!pending) return
    if (pending.kind === 'publication') {
      const draft = drafts.find((item) => item.id === pending.draftId)
      if (draft) dispatch({ type: 'ADMIN_WORKFLOW_APPLY', mutation: applyPublicationWorkflow(draft, pending.decision, actor, reason) })
    } else {
      const project = allProjects.find((item) => item.id === pending.projectId)
      if (project) dispatch({ type: 'ADMIN_WORKFLOW_APPLY', mutation: restrictProjectDisplay(project, actor, reason) })
    }
    setPending(null)
    setReason('')
  }

  const publicationDescription = pending?.kind === 'publication'
    ? `${decisionLabels[pending.decision]}会更新提交者个人中心并追加一条审核通知和不可删除日志。`
    : '限制展示会同步到公开作品详情，并保留原始档案和历史。'

  return (
    <div className="admin-page stack">
      <header className="admin-page-header"><div><p className="eyebrow">A05 · Publication review</p><h1>发布审核</h1><p>通过、退回、拒绝和争议均要求原因；通过后使用稳定提交 ID 生成公开档案。</p></div><Tag>{drafts.filter((draft) => draft.status === 'pending_review').length} 项待审核</Tag></header>
      <label className="field"><span className="field__label">本次操作原因（必填）</span><textarea className="input textarea" rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setError(null) }} placeholder="说明核对结论与依据" /></label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}

      {drafts.length ? <section className="admin-workflow-list stack" aria-label="发布审核队列">{drafts.map((draft) => <article className="admin-workflow-card stack" key={draft.id}><div className="cluster cluster--between"><div><strong>{draft.fields.currentName ?? '未命名提交'}</strong><code>{draft.id}</code></div><Tag tone={draft.status === 'pending_review' ? 'strong' : 'dashed'}>{submissionReviewStatusLabels[draft.status] ?? (draft.status === 'restricted' ? '争议复核中' : draft.status)}</Tag></div><p>{draft.fields.oneLineDefinition ?? '未提供一句话定义'}</p><p>提交者：{draft.userId}；提交时间：{draft.submittedAt ? new Date(draft.submittedAt).toLocaleString('zh-CN') : '未记录'}</p>{draft.reviewMessages.submission ? <aside className="feedback"><strong>最近审核原因</strong><p>{draft.reviewMessages.submission}</p></aside> : null}<div className="cluster"><Button disabled={!isAdminWorkflowAllowed('publication_approved', state.session.role)} onClick={() => requestPublication(draft, 'approve')}>通过</Button><Button onClick={() => requestPublication(draft, 'return')}>退回</Button><Button variant="danger" onClick={() => requestPublication(draft, 'reject')}>拒绝</Button><Button variant="danger" disabled={!isAdminWorkflowAllowed('publication_disputed', state.session.role)} onClick={() => requestPublication(draft, 'dispute')}>标争议</Button></div></article>)}</section> : <EmptyState title="当前没有发布审核记录" description="提交者确认发布后，冻结版本会进入这里。" />}

      <section className="wire-panel stack" aria-labelledby="restrict-heading"><div><p className="eyebrow">High-risk action</p><h2 id="restrict-heading">限制已发布作品展示</h2></div><p>该动作仅管理员可用，不删除作品、来源或历史。</p><label className="field"><span className="field__label">选择作品</span><select className="input" value={restrictId} onChange={(event) => setRestrictId(event.target.value as typeof restrictId)}>{allProjects.map((project) => <option key={project.id} value={project.id}>{project.currentName.state === 'known' ? project.currentName.value : project.id}（{project.reviewStatus}）</option>)}</select></label><Button variant="danger" disabled={!isAdminWorkflowAllowed('display_restricted', state.session.role)} onClick={requestRestriction}>限制展示</Button></section>

      <section className="wire-panel stack"><h2>最近操作日志</h2>{state.adminWorkflowLogs.filter((log) => log.action.startsWith('publication_') || log.action === 'display_restricted').length ? <ol className="admin-audit-list">{state.adminWorkflowLogs.filter((log) => log.action.startsWith('publication_') || log.action === 'display_restricted').slice().reverse().map((log) => <li key={log.id}><strong>{log.action}</strong><p>{log.targetId}：{String(log.beforeValue)} → {String(log.afterValue)}</p><p>原因：{log.reason}</p></li>)}</ol> : <p>尚无发布审核操作。</p>}</section>
      <ConfirmDialog open={Boolean(pending)} title={pending?.kind === 'publication' ? `确认${decisionLabels[pending.decision]}？` : '确认限制展示？'} description={publicationDescription} confirmLabel="确认并留痕" danger={pending?.kind === 'restrict' || pending?.kind === 'publication' && (pending.decision === 'reject' || pending.decision === 'dispute')} onConfirm={confirm} onCancel={() => setPending(null)} />
    </div>
  )
}
