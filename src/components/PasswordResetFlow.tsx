import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from './index'
import {
  AuthApiError, createAuthRequestId, resetPassword, startPasswordResetChallenge,
  verifyEmailChallenge, type AuthChallengeDto, type AuthSessionDto,
} from '../services/authService'

function message(error: unknown): string {
  if (!(error instanceof AuthApiError)) return '暂时无法完成操作，请稍后重试。'
  const messages: Record<string, string> = {
    EMAIL_INVALID: '请输入有效的邮箱地址。', PASSWORD_INVALID: '密码长度需为 8–64 个字符。',
    OTP_INVALID: '验证码不正确。', OTP_EXPIRED: '验证码已过期，请重新获取。',
    OTP_ALREADY_USED: '验证码已使用，请重新获取。', OTP_ATTEMPTS_EXCEEDED: '验证码错误次数过多，请重新获取。',
    PASSWORD_RESET_INVALID: '验证已过期或无效，请重新获取验证码。',
    AUTH_RATE_LIMITED: '请求次数过多，请稍后再试。', CSRF_INVALID: '页面验证已失效，请刷新后重试。',
    AUTH_FLOW_MISMATCH: '验证流程已变化，请重新获取验证码。',
  }
  return messages[error.code] ?? '暂时无法完成操作，请稍后重试。'
}

export function PasswordResetFlow({ session, onSuccess }: {
  session?: AuthSessionDto | null
  onSuccess: () => void
}) {
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState<AuthChallengeDto | null>(null)
  const [otp, setOtp] = useState('')
  const [grant, setGrant] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    if (!challenge) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [challenge])
  const resend = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.resend_after) - clock) / 1000)) : 0

  const request = async (event?: FormEvent) => {
    event?.preventDefault()
    if (busy || resend > 0) return
    if (!session && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('请输入有效的邮箱地址。'); return }
    setBusy(true); setError(null)
    try {
      const result = await startPasswordResetChallenge({ email: session ? undefined : email.trim(), clientRequestId: createAuthRequestId() })
      setChallenge(result); setGrant(null); setOtp(''); setClock(Date.now())
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge || busy) return
    if (!/^\d{6}$/.test(otp)) { setError('请输入邮件中的 6 位数字验证码。'); return }
    setBusy(true); setError(null)
    try {
      const result = await verifyEmailChallenge({ challengeId: challenge.challenge_id,
        authFlowId: challenge.auth_flow_id, otp, clientRequestId: createAuthRequestId() })
      if (result.purpose !== 'password_reset') throw new Error('验证流程不匹配')
      setGrant(result.reset_grant)
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!grant || busy) return
    const length = Array.from(password).length
    if (length < 8 || length > 64) { setError('密码长度需为 8–64 个字符。'); return }
    if (password !== confirmation) { setError('两次输入的密码不一致。'); return }
    setBusy(true); setError(null)
    try {
      await resetPassword(grant, password, session ?? undefined)
      setPassword(''); setConfirmation(''); setGrant(null); onSuccess()
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.code === 'PASSWORD_RESET_INVALID') { setGrant(null); setChallenge(null); setOtp('') }
      setError(message(cause))
    } finally { setBusy(false) }
  }
  return <div className="password-reset-flow stack stack--small">
    {!grant ? <>
      {!session ? <Input label="账号邮箱" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(null) }} autoComplete="username" maxLength={254} required disabled={busy || Boolean(challenge)} /> : null}
      {challenge ? <>
        <p role="status">验证码已发送至 {challenge.masked_email}</p>
        <form onSubmit={(event) => void verify(event)} className="stack stack--small">
          <Input label="邮箱验证码" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }} maxLength={6} required disabled={busy} />
          <Button variant="primary" type="submit" loading={busy}>验证邮箱</Button>
        </form>
        <div className="cluster"><Button variant="quiet" disabled={busy || resend > 0} onClick={() => void request()}>{resend > 0 ? `${resend} 秒后重发` : '重新发送验证码'}</Button>{!session ? <Button variant="quiet" onClick={() => { setChallenge(null); setOtp(''); setError(null) }}>更换邮箱</Button> : null}</div>
      </> : <Button variant="primary" disabled={busy} loading={busy} onClick={() => void request()}>发送邮箱验证码</Button>}
    </> : <form onSubmit={(event) => void save(event)} className="stack stack--small">
      <p>邮箱已验证，请设置新密码。</p>
      <Input label="新密码" type={visible ? 'text' : 'password'} value={password} onChange={(event) => { setPassword(event.target.value); setError(null) }} autoComplete="new-password" minLength={8} required disabled={busy} />
      <Input label="确认新密码" type={visible ? 'text' : 'password'} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(null) }} autoComplete="new-password" minLength={8} required disabled={busy} />
      <label className="cluster"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />显示密码</label>
      <Button variant="primary" type="submit" loading={busy}>保存新密码</Button>
    </form>}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </div>
}
