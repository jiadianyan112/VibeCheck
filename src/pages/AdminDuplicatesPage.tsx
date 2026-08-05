import { useMemo, useState } from 'react'
import { Button, ConfirmDialog, Tag } from '../components'
import { isAdminWorkflowAllowed, mergeAdminProjects, mergeDuplicateProjects } from '../features'
import { projects } from '../mocks'
import { useAppState } from '../state'

const candidateIds = ['project-quizforge', 'project-pdfquizlab'] as const

export function AdminDuplicatesPage() {
  const { state, dispatch } = useAppState()
  const allProjects = useMemo(() => mergeAdminProjects(projects, state.projectOverrides), [state.projectOverrides])
  const candidates = candidateIds.map((id) => allProjects.find((project) => project.id === id)).filter((project): project is (typeof allProjects)[number] => Boolean(project))
  const [mainId, setMainId] = useState(candidates[0]?.id ?? projects[0]!.id)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const main = candidates.find((project) => project.id === mainId) ?? candidates[0]
  const duplicate = candidates.find((project) => project.id !== main?.id)
  const mergedTo = duplicate ? state.projectAliases[duplicate.id] : null

  function requestMerge() {
    if (!reason.trim()) { setError('合并重复作品必须填写操作原因。'); return }
    setError(null)
    setConfirming(true)
  }

  function confirmMerge() {
    if (!main || !duplicate || !state.session.user) return
    dispatch({ type: 'ADMIN_WORKFLOW_APPLY', mutation: mergeDuplicateProjects(main, duplicate, state.session.user, reason) })
    setConfirming(false)
    setReason('')
  }

  return (
    <div className="admin-page stack">
      <header className="admin-page-header"><div><p className="eyebrow">A04 · Stable identity</p><h1>重复与合并</h1><p>选择主档后保留主档稳定 ID；副档完整历史继续保存，并建立旧 ID 到主档的映射。</p></div><Tag tone="dashed">1 组候选</Tag></header>
      <section className="admin-duplicate-grid" aria-label="重复作品候选">{candidates.map((project) => <label className={`admin-workflow-card stack ${main?.id === project.id ? 'admin-workflow-card--selected' : ''}`} key={project.id}><div className="cluster cluster--between"><strong>{project.currentName.state === 'known' ? project.currentName.value : '名称未知'}</strong><Tag>{main?.id === project.id ? '主档' : '副档'}</Tag></div><code>{project.id}</code><span>{project.publicUrl.state === 'known' ? project.publicUrl.value : '地址未知'}</span><span>{project.versionIds.length} 个版本，{project.eventIds.length} 条事件，{project.assetIds.length} 项资产</span><span><input type="radio" name="main-project" checked={main?.id === project.id} onChange={() => setMainId(project.id)} /> 设为合并主档</span></label>)}</section>
      {mergedTo ? <aside className="feedback" role="status"><strong>此候选组已完成稳定 ID 映射</strong><p><code>{duplicate?.id}</code> → <code>{mergedTo}</code>。再次执行相同动作不会重复追加日志。</p></aside> : null}
      <section className="wire-panel stack"><h2>合并预览</h2><dl className="definition-list"><div><dt>保留稳定 ID</dt><dd>{main?.id}</dd></div><div><dt>旧 ID 映射</dt><dd>{duplicate?.id} → {main?.id}</dd></div><div><dt>历史处理</dt><dd>名称、地址、版本、事件、资产、关系与互动计数合并；副档标为归档，不物理删除。</dd></div></dl><label className="field"><span className="field__label">合并原因（必填）</span><textarea className="input textarea" rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setError(null) }} /></label>{error ? <p className="field-error" role="alert">{error}</p> : null}<Button variant="danger" disabled={!main || !duplicate || Boolean(mergedTo) || !isAdminWorkflowAllowed('duplicate_merged', state.session.role)} onClick={requestMerge}>确认合并候选</Button>{state.session.role !== 'admin' ? <p className="page-description">平台编辑可预览，只有管理员能执行稳定 ID 合并。</p> : null}</section>
      <section className="wire-panel stack"><h2>合并操作日志</h2>{state.adminWorkflowLogs.filter((log) => log.action === 'duplicate_merged').length ? <ol className="admin-audit-list">{state.adminWorkflowLogs.filter((log) => log.action === 'duplicate_merged').map((log) => <li key={log.id}><strong>{log.targetId} 已映射到 {log.projectId}</strong><p>原因：{log.reason}</p></li>)}</ol> : <p>尚无合并记录。</p>}</section>
      <ConfirmDialog open={confirming} title="确认合并这两个作品档案？" description="操作将更新前台、收藏、关注和比较中的旧 ID 引用，同时保留副档和全部历史。" confirmLabel="合并并保留映射" danger onConfirm={confirmMerge} onCancel={() => setConfirming(false)} />
    </div>
  )
}
