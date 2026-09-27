import { useCallback, useEffect, useState } from 'react'
import { Button, EmptyState, Input, LoadingState, Modal } from '../components'
import { useAuthSession } from '../features'
import { AuthApiError, createAuthRequestId, startAdminEmailChallenge, verifyEmailChallenge, type AuthChallengeDto } from '../services/authService'
import { ReviewApiError, reviewApi, type ClaimedSubmissionWorkItem, type SubmissionWorkItem } from '../services/reviewApi'

type Decision = 'approve' | 'changes_requested' | 'reject'
type ReviewProgress = {
  item: ClaimedSubmissionWorkItem
  decision: Decision
  reasonCode: string
  previewToken: string
  confirmationSummaryHash: string
  confirmRequestId: string
  decisionRequestId: string
}

const reasonOptions = {
  changes_requested: [
    ['information_incomplete', '作品信息需要补充'],
    ['media_not_ready', '封面或材料需要补充'],
    ['url_unavailable', '作品链接无法访问'],
  ],
  reject: [
    ['out_of_scope', '不符合收录范围'],
    ['unsafe_content', '内容不符合社区规则'],
    ['duplicate_submission', '与已有作品重复'],
  ],
} as const

function reviewError(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.code === 'NETWORK_UNAVAILABLE') return '网络连接失败，请检查网络后重试。'
    if (error.code === 'OTP_INVALID' || error.code === 'EMAIL_CHALLENGE_INVALID') return '验证码不正确，请检查后重试。'
    if (error.code === 'EMAIL_CHALLENGE_EXPIRED') return '验证码已过期，请重新开始审核。'
    return `邮箱验证未完成（${error.code}），请重试。`
  }
  if (!(error instanceof ReviewApiError)) return '审核服务暂时不可用，请重试。'
  const messages: Record<string, string> = {
    NETWORK_UNAVAILABLE: '网络连接失败，请检查网络后重试。',
    WORK_ITEM_VERSION_CONFLICT: '审核状态已变化，请刷新队列。',
    WORK_ITEM_NOT_CLAIMABLE: '这项提交正在由其他审核员处理。',
    CONFLICT_OF_INTEREST: '不能审核自己提交的作品。',
    REAUTH_REQUIRED: '请用邮箱验证码再次确认本次审核操作。',
    SUBMISSION_MEDIA_NOT_READY: '作品媒体尚未准备好，暂不能通过。',
    SUBMISSION_EVIDENCE_NOT_READY: '作品证据尚未准备好，暂不能通过。',
  }
  return messages[error.code] ?? `审核未完成（${error.code}），请刷新后重试。`
}

export function ServerAdminReviewsPage() {
  const { session } = useAuthSession()
  const [items, setItems] = useState<SubmissionWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<{ item: SubmissionWorkItem; decision: Decision } | null>(null)
  const [reasonCode, setReasonCode] = useState('')
  const [progress, setProgress] = useState<ReviewProgress | null>(null)
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState<AuthChallengeDto | null>(null)
  const [otp, setOtp] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await reviewApi.listPending())
      setError(null)
    } catch (cause) {
      setError(reviewError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!progress || !session) return
    const timer = globalThis.setInterval(() => {
      void reviewApi.heartbeat(progress.item, session).catch(() => {
        setError('审核占用已过期，请刷新队列后重试。')
        setProgress(null)
      })
    }, 20_000)
    return () => globalThis.clearInterval(timer)
  }, [progress, session])

  async function finishReview(current: ReviewProgress, reauthGrantId: string | null) {
    if (!session) throw new ReviewApiError('AUTHENTICATION_REQUIRED', 401)
    const confirmed = await reviewApi.confirm({ preview_token: current.previewToken, confirmation_summary_hash: current.confirmationSummaryHash }, session, reauthGrantId, current.confirmRequestId)
    await reviewApi.decide(
      current.item, current.previewToken, confirmed.confirm_token, session,
      current.decision, current.reasonCode,
      current.decision === 'changes_requested' ? ['/project_core'] : [], current.decisionRequestId,
    )
    setProgress(null)
    setChallenge(null)
    setOtp('')
    setNotice(current.decision === 'approve' ? '审核决定已保存，作品正在进入公开目录。' : '审核决定已保存。')
    await reload()
  }

  async function confirmDecision() {
    if (!pending || !session || busy) return
    const selectedReason = pending.decision === 'approve' ? 'submission_approved' : reasonCode
    if (!selectedReason) { setError('请先选择审核原因。'); return }
    setPending(null)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const claimed = await reviewApi.claim(pending.item, session)
      const preview = await reviewApi.preview(claimed, session, pending.decision, selectedReason)
      const current: ReviewProgress = {
        item: claimed, decision: pending.decision, reasonCode: selectedReason,
        previewToken: preview.preview_token,
        confirmationSummaryHash: preview.confirmation_summary_hash,
        confirmRequestId: createAuthRequestId(),
        decisionRequestId: createAuthRequestId(),
      }
      setProgress(current)
      try {
        await finishReview(current, null)
      } catch (cause) {
        if (!(cause instanceof ReviewApiError) || cause.code !== 'REAUTH_REQUIRED') throw cause
        setError(reviewError(cause))
      }
    } catch (cause) {
      setProgress(null)
      await reload()
      setError(reviewError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function sendCode() {
    if (!progress || busy) return
    setBusy(true)
    setError(null)
    try {
      setChallenge(await startAdminEmailChallenge({ email, previewToken: progress.previewToken, clientRequestId: createAuthRequestId() }))
    } catch (cause) {
      setError(reviewError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    if (!progress || !challenge || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await verifyEmailChallenge({ challengeId: challenge.challenge_id, authFlowId: challenge.auth_flow_id, otp, clientRequestId: createAuthRequestId() })
      if (result.purpose !== 'admin_confirm') throw new ReviewApiError('REAUTH_PURPOSE_INVALID', 409)
      await finishReview(progress, result.reauth_grant_id)
    } catch (cause) {
      setError(reviewError(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div className="admin-page stack">
    <header className="admin-page-header"><div><h1>发布审核</h1><p>审核决定会写入数据库；通过后由发布服务创建公开作品档案。</p></div><span>{items.length} 项待审核</span></header>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <Button onClick={() => void reload()} disabled={loading || busy}>刷新队列</Button>
    {progress ? <section className="wire-panel stack" aria-label="邮箱再次确认"><h2>邮箱再次确认</h2><p>本次敏感操作需要用账户邮箱验证码确认。请输入当前账户的完整邮箱地址。</p><Input label="账户邮箱" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy || Boolean(challenge)} />{challenge ? <><p>验证码已发送至 {challenge.masked_email}</p><Input label="邮箱验证码" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} disabled={busy} /><Button variant="primary" onClick={() => void verifyCode()} disabled={busy || !/^\d{6}$/.test(otp)}>确认审核</Button></> : <Button onClick={() => void sendCode()} disabled={busy || !email.includes('@')}>发送验证码</Button>}</section> : null}
    {loading ? <LoadingState label="正在读取待审核提交" /> : items.length ? <section className="admin-workflow-list stack" aria-label="发布审核队列">{items.map((item) => <article className="admin-workflow-card stack" key={item.work_item_id}><div className="cluster cluster--between"><div><strong>{item.domain_summary.current_name ?? '未命名提交'}</strong><code>{item.target_id}</code></div><span>待审核</span></div><p>{item.domain_summary.one_line_definition ?? '尚无一句话介绍。'}</p>{item.domain_summary.public_url ? <a href={item.domain_summary.public_url} target="_blank" rel="noopener noreferrer">访问提交的作品地址 ↗</a> : null}<p>提交时间：{new Date(item.created_at).toLocaleString('zh-CN')}</p><div className="cluster"><Button disabled={busy || Boolean(progress)} onClick={() => { setReasonCode(''); setPending({ item, decision: 'approve' }) }}>通过</Button><Button disabled={busy || Boolean(progress)} onClick={() => { setReasonCode(''); setPending({ item, decision: 'changes_requested' }) }}>退回</Button><Button variant="danger" disabled={busy || Boolean(progress)} onClick={() => { setReasonCode(''); setPending({ item, decision: 'reject' }) }}>拒绝</Button></div></article>)}</section> : <EmptyState title="当前没有待审核提交" description="新的提交进入数据库审核队列后会显示在这里。" />}
    <Modal open={Boolean(pending)} title={pending?.decision === 'approve' ? '通过并发布？' : pending?.decision === 'reject' ? '拒绝收录？' : '退回补充？'} onClose={() => setPending(null)} footer={<><Button onClick={() => setPending(null)}>取消</Button><Button variant={pending?.decision === 'reject' ? 'danger' : 'primary'} onClick={() => void confirmDecision()} disabled={pending?.decision !== 'approve' && !reasonCode}>{pending?.decision === 'approve' ? '确认通过' : '确认审核'}</Button></>}>
      {pending?.decision === 'approve' ? <p>审核通过后会写入数据库，并进入公开作品目录。</p> : <label className="field"><span className="field__label">审核原因（必选）</span><select className="input" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">请选择原因</option>{pending ? reasonOptions[pending.decision].map(([value, label]) => <option key={value} value={value}>{label}</option>) : null}</select></label>}
    </Modal>
  </div>
}
