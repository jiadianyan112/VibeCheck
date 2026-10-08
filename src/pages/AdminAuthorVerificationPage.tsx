import { useCallback, useEffect, useState } from 'react'
import { Button, EmptyState, ErrorPanel, LoadingState, Tag } from '../components'
import { useAuthSession } from '../features'
import { createAuthRequestId } from '../services/authService'
import { DeveloperReviewApiError, developerReviewApi, type ClaimedDeveloperVerificationWorkItem, type DeveloperVerificationWorkItem } from '../services/developerReviewApi'
import { VerificationApiError, type MaterialReviewerProjection, type VerificationReviewerProjection } from '../services/verificationApi'

type Decision = 'approve' | 'changes_requested' | 'reject'

function reviewError(error: unknown): string {
  if (error instanceof DeveloperReviewApiError) {
    const messages: Record<string, string> = {
      NETWORK_UNAVAILABLE: '网络连接失败，请检查网络后重试。',
      WORK_ITEM_VERSION_CONFLICT: '审核队列已变化，请刷新后重试。',
      WORK_ITEM_NOT_CLAIMABLE: '这项申请正在由其他审核员处理。',
      CONFLICT_OF_INTEREST: '不能审核自己提交的作品。',
      WORK_ITEM_CLAIM_FORBIDDEN: '审核租约已失效，请重新领取。',
      VERIFICATION_LINK_POLICY_CHANGED: '申请的归属策略已变化，请重新领取并审核。',
      VERIFICATION_VERSION_CONFLICT: '申请内容已变化，请重新领取并审核。',
      MATERIAL_READ_PURPOSE_INVALID: '私有材料读取目的不受支持。',
      LEGACY_MANAGER_APPROVAL_UNSUPPORTED: '这是历史管理者申请，请转到既有后台流程处理，当前页面不会将其升级为负责人。',
    }
    return messages[error.code] ?? `审核未完成（${error.code}），请刷新后重试。`
  }
  if (error instanceof VerificationApiError) {
    const messages: Record<string, string> = {
      NETWORK_UNAVAILABLE: '网络连接失败，请检查网络后重试。',
      VERIFICATION_VERSION_CONFLICT: '申请内容已变化，请重新领取并审核。',
      MATERIAL_REVIEW_UNAVAILABLE: '材料扫描结果暂时不可用，请稍后重试。',
      MATERIAL_READ_PURPOSE_INVALID: '私有材料读取目的不受支持。',
    }
    return messages[error.code] ?? `审核未完成（${error.code}），请刷新后重试。`
  }
  return error instanceof Error ? error.message : '审核服务暂时不可用，请稍后重试。'
}

export function AdminAuthorVerificationPage() {
  const { session } = useAuthSession()
  const [items, setItems] = useState<DeveloperVerificationWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<ClaimedDeveloperVerificationWorkItem | null>(null)
  const [detail, setDetail] = useState<VerificationReviewerProjection | null>(null)
  const [materialStates, setMaterialStates] = useState<Record<string, MaterialReviewerProjection>>({})
  const [materialLinks, setMaterialLinks] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await developerReviewApi.listPending())
      setError(null)
    } catch (cause) { setError(reviewError(cause)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!claimed || !session) return
    // The workflow lease is one minute; renew well before expiry while a
    // reviewer is inspecting private material or policy details. Heartbeats
    // increment the work-item version, so retain the returned projection for
    // the next preview/decision request.
    const heartbeat = window.setInterval(() => {
      void developerReviewApi.heartbeat(claimed, session).then((next) => {
        setClaimed(current => current && current.work_item_id === next.work_item_id ? { ...current, ...next } : current)
      }).catch((cause) => {
        setError(reviewError(cause))
        if (cause instanceof DeveloperReviewApiError && ['WORK_ITEM_LEASE_EXPIRED', 'WORK_ITEM_MAXIMUM_CLAIM_REACHED', 'WORK_ITEM_CLAIM_FORBIDDEN'].includes(cause.code)) {
          setClaimed(null)
          setDetail(null)
        }
      })
    }, 30_000)
    return () => window.clearInterval(heartbeat)
  }, [claimed, session])

  async function openReview(item: DeveloperVerificationWorkItem) {
    if (!session || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const nextClaim = await developerReviewApi.claim(item, session)
      const nextDetail = await developerReviewApi.getClaimedDetail(nextClaim, session)
      setClaimed(nextClaim)
      setDetail(nextDetail)
      setMaterialStates({})
      setMaterialLinks({})
    } catch (cause) { setError(reviewError(cause)) } finally { setBusy(false) }
  }

  async function viewMaterial(materialId: string) {
    if (!claimed || !session || busy) return
    setBusy(true)
    setError(null)
    try {
      const material = await developerReviewApi.getReviewerMaterial(claimed, session, materialId)
      setMaterialStates(current => ({ ...current, [materialId]: material }))
      const grant = await developerReviewApi.createMaterialReadGrant(claimed, session, materialId)
      setMaterialLinks(current => ({ ...current, [materialId]: grant.read_url }))
    } catch (cause) { setError(reviewError(cause)) } finally { setBusy(false) }
  }

  async function decide(decision: Decision) {
    if (!claimed || !detail || !session || busy) return
    if (decision !== 'approve' && !reason.trim()) { setError('要求补充、失败和争议操作必须填写原因。'); return }
    setBusy(true)
    setError(null)
    setNotice(null)
    const reasonCode = decision === 'approve' ? 'verification_approved' : decision === 'changes_requested' ? 'verification_changes_requested' : 'verification_rejected'
    try {
      const preview = await developerReviewApi.preview(claimed, detail, session, decision, reasonCode)
      const confirm = await developerReviewApi.confirm(preview, session, createAuthRequestId())
      await developerReviewApi.decide(claimed, detail, preview.preview_token, confirm.confirm_token, session, decision, reasonCode, createAuthRequestId())
      setNotice(decision === 'approve' ? '身份审核决定已保存，作品管理权限将按服务端结果生效。' : '身份审核决定已保存。')
      setClaimed(null)
      setDetail(null)
      setReason('')
      await reload()
    } catch (cause) {
      setError(reviewError(cause))
      const code = cause instanceof DeveloperReviewApiError || cause instanceof VerificationApiError ? cause.code : null
      if (code === 'WORK_ITEM_VERSION_CONFLICT' || code === 'WORK_ITEM_CLAIM_FORBIDDEN' || code === 'VERIFICATION_VERSION_CONFLICT' || code === 'VERIFICATION_LINK_POLICY_CHANGED') {
        setClaimed(null)
        setDetail(null)
      }
      await reload()
    } finally { setBusy(false) }
  }

  async function releaseReview() {
    if (!claimed || !session || busy) return
    setBusy(true)
    try { await developerReviewApi.release(claimed, session); setClaimed(null); setDetail(null); await reload() } catch (cause) { setError(reviewError(cause)) } finally { setBusy(false) }
  }

  return <div className="admin-page stack">
    <header className="admin-page-header"><div><h1>开发者身份审核</h1><p>材料只在此后台审核页显示；公开作品与开发者资料不读取私有材料原文。</p></div><Tag>{items.length} 项待审核</Tag></header>
    {error ? <ErrorPanel title="审核操作未完成" message={error} onRetry={() => void reload()} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {loading ? <LoadingState label="正在读取开发者身份审核队列" /> : items.length ? <section className="admin-workflow-list stack" aria-label="开发者身份审核队列">{items.map(item => <article className="admin-workflow-card stack" key={item.work_item_id}><div className="cluster cluster--between"><div><strong>{item.domain_summary.current_name ?? item.target_id}</strong><p>作品身份申请</p></div><Tag tone="dashed">待人工审核</Tag></div><p>申请已由服务端冻结，领取后才能查看详细资料与私有材料。</p><div className="cluster"><Button disabled={busy} onClick={() => void openReview(item)}>打开审核</Button></div></article>)}</section> : <EmptyState title="当前没有待审核的开发者身份" description="申请人提交扫描通过的材料后会进入这里。" />}
    {claimed && detail ? <section className="wire-panel stack developer-review-detail" aria-labelledby="developer-review-detail-heading"><div className="cluster cluster--between"><div><h2 id="developer-review-detail-heading">审核申请</h2><p>申请编号：{detail.verification_id}</p></div><Tag tone="dashed">已领取</Tag></div>{detail.requested_link_role === 'manager' ? <aside className="feedback stack stack--small" role="note"><strong>历史管理者申请</strong><p>此申请沿用旧管理者归属规则，当前页面不会把它升级为负责人，请转到既有后台流程处理通过。</p></aside> : null}<dl className="definition-list"><div><dt>作品</dt><dd>{detail.project_id}</dd></div><div><dt>开发主体</dt><dd>{detail.new_creator_profile_input?.kind === 'team' ? '团队' : detail.new_creator_profile_input?.kind === 'individual' ? '个人' : '类型未标注'} · {detail.new_creator_profile_input?.display_name ?? '复用已有身份'}</dd></div>{detail.new_creator_profile_input?.bio ? <div><dt>主体简介</dt><dd>{detail.new_creator_profile_input.bio}</dd></div> : null}{detail.new_creator_profile_input?.avatar_url ? <div><dt>头像或 Logo</dt><dd><a href={detail.new_creator_profile_input.avatar_url} target="_blank" rel="noopener noreferrer">打开头像或 Logo</a></dd></div> : null}{detail.new_creator_profile_input?.website_url ? <div><dt>官网</dt><dd><a href={detail.new_creator_profile_input.website_url} target="_blank" rel="noopener noreferrer">打开官网</a></dd></div> : null}<div><dt>材料说明</dt><dd>{detail.public_summary}</dd></div><div><dt>证明方式</dt><dd>{detail.method === 'manual_material' ? '上传材料' : detail.method}</dd></div></dl><section className="stack"><h3>私有材料</h3><p>先读取扫描结果，再通过一次性受控授权打开材料。原始文件不会写入审核日志。</p><ul className="verification-material-list">{detail.material_ids.map(materialId => <li key={materialId}><span><strong>{materialStates[materialId]?.status === 'ready' ? '扫描通过' : '尚未读取扫描结果'}</strong><small>{materialId}</small></span>{materialLinks[materialId] ? <a href={materialLinks[materialId]} target="_blank" rel="noopener noreferrer">打开受控材料</a> : <Button variant="quiet" disabled={busy} onClick={() => void viewMaterial(materialId)}>查看材料</Button>}</li>)}</ul></section><label className="field" htmlFor="developer-review-reason"><span className="field__label">审核原因（通过可选，其余必填）</span><textarea id="developer-review-reason" className="input textarea" rows={3} value={reason} onChange={event => { setReason(event.target.value); setError(null) }} placeholder="要求补充或拒绝时说明依据" /></label><div className="cluster"><Button variant="primary" disabled={busy || detail.requested_link_role === 'manager'} onClick={() => void decide('approve')}>通过并留痕</Button><Button disabled={busy} onClick={() => void decide('changes_requested')}>要求补充</Button><Button variant="danger" disabled={busy} onClick={() => void decide('reject')}>审核未通过</Button><Button variant="quiet" disabled={busy} onClick={() => void releaseReview()}>释放审核租约</Button></div></section> : null}
  </div>
}
