import { useMemo, useState } from 'react'
import { Button, ConfirmDialog, EmptyState, Tag } from '../components'
import { applyIdentityWorkflow, isAdminWorkflowAllowed, mergeAdminProjects, verificationMethodLabels, verificationStatusLabels, type IdentityDecision } from '../features'
import { projects, prototypeUsers, verificationRequests } from '../mocks'
import { useAppState } from '../state'
import type { AuthorVerificationRequest } from '../types'

function mergeRequests(base: readonly AuthorVerificationRequest[], overrides: readonly AuthorVerificationRequest[]) {
  const byId = new Map(overrides.map((request) => [request.id, request]))
  const baseIds = new Set(base.map((request) => request.id))
  return [...base.map((request) => byId.get(request.id) ?? request), ...overrides.filter((request) => !baseIds.has(request.id))]
}

const decisionLabels: Record<IdentityDecision, string> = {
  verified: '验证通过', changes_requested: '要求补充', failed: '验证失败', disputed: '标记争议',
}

export function AdminAuthorVerificationPage() {
  const { state, dispatch } = useAppState()
  const allProjects = useMemo(() => mergeAdminProjects(projects, state.projectOverrides), [state.projectOverrides])
  const requests = useMemo(() => mergeRequests(verificationRequests, state.verificationRequests), [state.verificationRequests])
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ requestId: AuthorVerificationRequest['id']; decision: IdentityDecision } | null>(null)

  function requestDecision(request: AuthorVerificationRequest, decision: IdentityDecision) {
    if (!reason.trim()) { setError('身份审核操作必须填写原因。'); return }
    setError(null)
    setPending({ requestId: request.id, decision })
  }

  function confirmDecision() {
    if (!pending || !state.session.user) return
    const request = requests.find((item) => item.id === pending.requestId)
    const project = request ? allProjects.find((item) => item.id === request.projectId) : null
    if (request && project) dispatch({ type: 'ADMIN_WORKFLOW_APPLY', mutation: applyIdentityWorkflow(request, project, pending.decision, state.session.user, reason) })
    setPending(null)
    setReason('')
  }

  return (
    <div className="admin-page stack">
      <header className="admin-page-header"><div><p className="eyebrow">A06 · Private review</p><h1>作者身份审核</h1><p>材料只在此后台审核页显示；前台作品、动态、作者主页和公开证据抽屉均不读取私有材料引用。</p></div><Tag>{requests.filter((request) => request.status === 'pending').length} 项待审核</Tag></header>
      <label className="field"><span className="field__label">本次身份审核原因（必填）</span><textarea className="input textarea" rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setError(null) }} placeholder="说明材料是否足以建立作品归属" /></label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {requests.length ? <section className="admin-workflow-list stack" aria-label="作者身份审核队列">{requests.map((request) => { const project = allProjects.find((item) => item.id === request.projectId); const applicant = prototypeUsers.find((user) => user.id === request.userId); return <article className="admin-workflow-card stack" key={request.id}><div className="cluster cluster--between"><div><strong>{project?.currentName.state === 'known' ? project.currentName.value : request.projectId}</strong><p>申请人：{applicant?.displayName ?? request.userId}</p></div><Tag tone={request.status === 'verified' ? 'strong' : 'dashed'}>{verificationStatusLabels[request.status]}</Tag></div><dl className="definition-list"><div><dt>证明方式</dt><dd>{verificationMethodLabels[request.method]}</dd></div><div><dt>材料摘要</dt><dd>{request.materialSummary}</dd></div><div><dt>私有材料引用</dt><dd><code>{request.privateMaterialReference}</code></dd></div></dl>{request.reviewMessage ? <aside className="feedback"><strong>最近审核原因</strong><p>{request.reviewMessage}</p></aside> : null}<div className="cluster"><Button disabled={!isAdminWorkflowAllowed('identity_verified', state.session.role)} onClick={() => requestDecision(request, 'verified')}>通过</Button><Button onClick={() => requestDecision(request, 'changes_requested')}>要求补充</Button><Button variant="danger" disabled={!isAdminWorkflowAllowed('identity_failed', state.session.role)} onClick={() => requestDecision(request, 'failed')}>失败</Button><Button variant="danger" disabled={!isAdminWorkflowAllowed('identity_disputed', state.session.role)} onClick={() => requestDecision(request, 'disputed')}>争议</Button></div></article>})}</section> : <EmptyState title="没有身份审核申请" description="申请人提交私有材料后会进入这里。" />}
      <section className="wire-panel stack"><h2>身份审核日志</h2>{state.adminWorkflowLogs.filter((log) => log.action.startsWith('identity_')).length ? <ol className="admin-audit-list">{state.adminWorkflowLogs.filter((log) => log.action.startsWith('identity_')).slice().reverse().map((log) => <li key={log.id}><strong>{log.action}</strong><p>{log.targetId}：{String(log.beforeValue)} → {String(log.afterValue)}</p><p>原因：{log.reason}</p><small>日志不包含私有材料原文或引用。</small></li>)}</ol> : <p>尚无身份审核操作。</p>}</section>
      <ConfirmDialog open={Boolean(pending)} title={pending ? `确认${decisionLabels[pending.decision]}？` : '确认身份审核？'} description="操作会更新申请人的个人中心和通知，并同步作品作者关联状态；私有材料不会写入公开记录。" confirmLabel="确认并留痕" danger={pending?.decision === 'failed' || pending?.decision === 'disputed'} onConfirm={confirmDecision} onCancel={() => setPending(null)} />
    </div>
  )
}
