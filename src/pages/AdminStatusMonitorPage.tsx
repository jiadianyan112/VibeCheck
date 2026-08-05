import { useMemo, useState } from 'react'
import { AccessStatusBadge, Button, ConfirmDialog, EmptyState, Tag } from '../components'
import { isAdminWorkflowAllowed, mergeAdminProjects, reviewProjectStatus } from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'
import { accessStatuses, type AccessStatus, type Project } from '../types'
import { accessStatusText } from '../utils'

export function AdminStatusMonitorPage() {
  const { state, dispatch } = useAppState()
  const allProjects = useMemo(() => mergeAdminProjects(projects, state.projectOverrides), [state.projectOverrides])
  const candidates = allProjects.filter((project) => project.httpCheckStatus !== 'normal' || state.statusReviewCounts[project.id])
  const [selectedId, setSelectedId] = useState<Project['id']>(candidates[0]?.id ?? projects[0]!.id)
  const [targetStatus, setTargetStatus] = useState<AccessStatus>('pending_recheck')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const project = candidates.find((item) => item.id === selectedId) ?? candidates[0]
  const reviewCount = project ? state.statusReviewCounts[project.id] ?? 0 : 0
  const workflowAction = reviewCount < 1 ? 'status_recheck_queued' : 'status_confirmed'

  function requestReview() {
    if (!reason.trim()) { setError('状态检查复核必须填写原因。'); return }
    setError(null)
    setConfirming(true)
  }

  function confirmReview() {
    if (!project || !state.session.user) return
    dispatch({ type: 'ADMIN_WORKFLOW_APPLY', mutation: reviewProjectStatus(project, targetStatus, reviewCount, state.session.user, reason) })
    setConfirming(false)
    setReason('')
  }

  return (
    <div className="admin-page stack">
      <header className="admin-page-header"><div><p className="eyebrow">A09 · Status recheck</p><h1>状态监测</h1><p>技术检查只生成观察信号。首次 URL 异常只进入待复查，不能直接推导暂停、结束或失败。</p></div><Tag tone="dashed">{candidates.length} 项异常信号</Tag></header>
      {candidates.length && project ? <><section className="admin-status-grid" aria-label="状态异常队列">{candidates.map((item) => { const status = item.accessStatus.state === 'known' ? item.accessStatus.value : 'unknown'; const count = state.statusReviewCounts[item.id] ?? 0; return <button type="button" className={`admin-status-card ${item.id === project.id ? 'admin-status-card--selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><strong>{item.currentName.state === 'known' ? item.currentName.value : item.id}</strong><span>技术检查：{item.httpCheckStatus}</span><AccessStatusBadge status={status} /><span>{count ? `已人工检查 ${count} 次` : '尚未人工复核'}</span></button>})}</section>
        <section className="wire-panel stack"><div className="cluster cluster--between"><div><p className="eyebrow">Selected finding</p><h2>{project.currentName.state === 'known' ? project.currentName.value : project.id}</h2></div><Tag tone={reviewCount ? 'strong' : 'dashed'}>{reviewCount < 1 ? '首次异常待记录' : '可进行确认复核'}</Tag></div><dl className="definition-list"><div><dt>技术检查</dt><dd>{project.httpCheckStatus}</dd></div><div><dt>当前公开状态</dt><dd>{project.accessStatus.state === 'known' ? accessStatusText[project.accessStatus.value] : '未知'}</dd></div><div><dt>发布状态</dt><dd>{project.reviewStatus}</dd></div></dl><label className="field"><span className="field__label">拟确认状态</span><select className="input" value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as AccessStatus)}>{accessStatuses.map((status) => <option key={status} value={status}>{accessStatusText[status]}</option>)}</select></label><p className="page-description">{reviewCount < 1 ? '本次即使选择“暂停”或“结束”，系统也只记录待复查，不改写公开状态。' : '第二次及后续复核可由管理员确认公开状态，并追加生命周期事件。'}</p><label className="field"><span className="field__label">状态复核原因（必填）</span><textarea className="input textarea" rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setError(null) }} /></label>{error ? <p className="field-error" role="alert">{error}</p> : null}<Button variant={reviewCount < 1 ? 'primary' : 'danger'} disabled={!isAdminWorkflowAllowed(workflowAction, state.session.role)} onClick={requestReview}>{reviewCount < 1 ? '记录首次检查并进入待复查' : '确认复核状态'}</Button>{!isAdminWorkflowAllowed(workflowAction, state.session.role) ? <p className="page-description">平台编辑可记录首次检查，最终状态确认需要管理员权限。</p> : null}</section></> : <EmptyState title="当前没有状态异常" description="技术检查异常会先进入此队列。" />}
      <section className="wire-panel stack"><h2>状态复核日志</h2>{state.adminWorkflowLogs.filter((log) => log.action.startsWith('status_')).length ? <ol className="admin-audit-list">{state.adminWorkflowLogs.filter((log) => log.action.startsWith('status_')).slice().reverse().map((log) => <li key={log.id}><strong>{log.action}</strong><p>{log.targetId}：{String(log.beforeValue)} → {String(log.afterValue)}</p><p>原因：{log.reason}</p></li>)}</ol> : <p>尚无状态复核操作。</p>}</section>
      <ConfirmDialog open={confirming} title={reviewCount < 1 ? '确认记录首次异常检查？' : '确认更新公开状态？'} description={reviewCount < 1 ? '只会进入待复查，不会把拟确认状态写入前台。' : '会更新前台状态并追加生命周期事件；旧值继续保留在历史中。'} confirmLabel="确认并留痕" danger={reviewCount > 0} onConfirm={confirmReview} onCancel={() => setConfirming(false)} />
    </div>
  )
}
