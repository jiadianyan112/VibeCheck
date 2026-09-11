import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Input, useToast } from '../components'
import { BrandMark } from '../components/brand'
import { roleLabels, useAuthSession } from '../features'
import {
  AuthApiError,
  createAuthRequestId,
  startEmailChallenge,
  verifyEmailChallenge,
  type AuthChallengeDto,
} from '../services/authService'
import { useAppState } from '../state'

export function safeReturnPath(value: string | null) {
  if (!value || value.length > 2_048 || !value.startsWith('/') || value.startsWith('//')) return '/me'
  try {
    const parsed = new URL(value, 'https://vibecheck.invalid')
    if (parsed.origin !== 'https://vibecheck.invalid') return '/me'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/me'
  }
}

function authErrorMessage(error: unknown): string {
  if (!(error instanceof AuthApiError)) return '登录服务暂时不可用，请稍后重试。'
  const messages: Record<string, string> = {
    EMAIL_INVALID: '请输入有效的邮箱地址。',
    OTP_INVALID: '验证码不正确，请检查后重试。',
    OTP_ATTEMPTS_EXCEEDED: '验证码已连续输错 5 次，请重新获取。',
    OTP_EXPIRED: '验证码已过期，请重新获取。',
    OTP_ALREADY_USED: '该验证码已使用，请重新获取。',
    OTP_CANCELLED: '该验证码已失效，请重新获取。',
    OTP_RESEND_TOO_SOON: '请求过于频繁，请等待倒计时结束。',
    AUTH_RATE_LIMITED: '请求次数过多，请稍后再试。',
    AUTH_FLOW_MISMATCH: '登录验证环境已变化，请重新获取验证码。',
    NETWORK_UNAVAILABLE: '网络连接不可用，请检查网络后重试。',
  }
  return messages[error.code] ?? '登录服务暂时不可用，请稍后重试。'
}

export function AuthPage() {
  const { state, dispatch } = useAppState()
  const auth = useAuthSession()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const returnPath = safeReturnPath(searchParams.get('return_to'))
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [challenge, setChallenge] = useState<AuthChallengeDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const emailInput = useRef<HTMLInputElement>(null)
  const otpInput = useRef<HTMLInputElement>(null)
  const [errorField, setErrorField] = useState<'email' | 'otp' | null>(null)

  useEffect(() => {
    if (challenge) otpInput.current?.focus()
  }, [challenge])

  useEffect(() => {
    if (!challenge) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [challenge])

  const resendSeconds = useMemo(() => {
    if (!challenge) return 0
    return Math.max(0, Math.ceil((Date.parse(challenge.resend_after) - clock) / 1_000))
  }, [challenge, clock])

  const requestChallenge = async (event?: FormEvent) => {
    event?.preventDefault()
    if (submitting || resendSeconds > 0) return
    if (!emailInput.current?.validity.valid) {
      setError('请输入有效的邮箱地址。')
      setErrorField('email')
      emailInput.current?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    setErrorField(null)
    try {
      const accepted = await startEmailChallenge({
        email: email.trim(),
        returnTo: returnPath,
        clientRequestId: createAuthRequestId(),
      })
      setChallenge(accepted)
      setOtp('')
      setClock(Date.now())
    } catch (requestError) {
      setError(authErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge || submitting) return
    if (!/^\d{6}$/.test(otp)) {
      setError('请输入邮件中的 6 位数字验证码。')
      setErrorField('otp')
      otpInput.current?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    setErrorField(null)
    try {
      const result = await verifyEmailChallenge({
        challengeId: challenge.challenge_id,
        authFlowId: challenge.auth_flow_id,
        otp,
        clientRequestId: createAuthRequestId(),
      })
      if (result.purpose !== 'login') throw new Error('AUTH_PURPOSE_UNEXPECTED')
      auth.acceptSession(result.session)
      dispatch({ type: 'PENDING_ACTION_REPLAY' })
      pushToast('登录成功，正在返回刚才的页面。', 'success')
      navigate(safeReturnPath(result.return_to), { replace: true })
    } catch (requestError) {
      setError(authErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  if (state.session.user) {
    const logout = async () => {
      setSubmitting(true)
      setError(null)
      try {
        await auth.signOut()
        pushToast('已安全退出当前账号。', 'success')
      } catch (requestError) {
        setError(authErrorMessage(requestError))
      } finally {
        setSubmitting(false)
      }
    }
    return (
      <main className="auth-page highfi-scope">
        <Link className="auth-page__back" to="/projects">← 返回作品广场</Link>
        <section className="auth-page__content auth-page__account">
          <BrandMark />
          <h1>当前账号</h1>
          <p>{state.session.user.displayName} · {roleLabels[state.session.role]}</p>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Link className="button button--primary auth-page__submit" to={returnPath}>继续</Link>
          <Button variant="quiet" loading={submitting} onClick={() => void logout()}>退出登录</Button>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-page highfi-scope">
      <Link className="auth-page__back" to="/projects">← 返回作品广场</Link>
      <section className="auth-page__content" aria-labelledby="email-auth-heading">
        <header className="auth-page__heading">
          <BrandMark />
          <h1 className="sr-only">登录／注册</h1>
          <h2 id="email-auth-heading">邮箱验证码登录</h2>
        </header>
        <form className="auth-page__form" onSubmit={(event) => void (challenge ? verify(event) : requestChallenge(event))} noValidate>
          <div className={`auth-page__input-row${challenge ? ' auth-page__input-row--locked' : ''}`}>
            <Input
              ref={emailInput}
              label="邮箱地址"
              type="email"
              placeholder="请输入邮箱地址"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(null); setErrorField(null) }}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              readOnly={Boolean(challenge)}
              disabled={submitting}
              aria-invalid={errorField === 'email'}
              aria-describedby={error ? 'auth-feedback-error' : undefined}
            />
            {challenge ? <button className="auth-page__inline-action" type="button" disabled={submitting} onClick={() => {
              setChallenge(null)
              setOtp('')
              setError(null)
              setErrorField(null)
              emailInput.current?.focus()
            }}>更换邮箱</button> : null}
          </div>
          <div className="auth-page__input-row auth-page__input-row--code">
            <Input
              ref={otpInput}
              label="6 位验证码"
              placeholder="请输入验证码"
              value={otp}
              onChange={(event) => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); setErrorField(null) }}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              disabled={!challenge || submitting}
              aria-invalid={errorField === 'otp'}
              aria-describedby={error ? 'auth-feedback-error' : undefined}
            />
            <button
              className="auth-page__inline-action"
              type="button"
              disabled={submitting || resendSeconds > 0}
              aria-label={resendSeconds > 0 ? `${resendSeconds} 秒后重新发送` : challenge ? '重新发送验证码' : '发送验证码'}
              onClick={() => void requestChallenge()}
            >
              {submitting ? '处理中…' : resendSeconds > 0 ? `${resendSeconds}s 后重发` : challenge ? '重新发送' : '发送验证码'}
            </button>
          </div>
          <div className="auth-page__feedback">
            {error ? <p id="auth-feedback-error" className="field-error" role="alert">{error}</p> : null}
            <p role="status">{!error && challenge ? `验证码已发送至 ${challenge.masked_email}` : ''}</p>
          </div>
          <Button className="auth-page__submit" type="submit" variant="primary" loading={submitting} disabled={!challenge}>登录</Button>
          <p className="auth-page__note">新邮箱验证后自动注册</p>
        </form>
        <Link className="auth-page__guest" to="/projects" replace>先逛逛</Link>
      </section>
    </main>
  )
}
