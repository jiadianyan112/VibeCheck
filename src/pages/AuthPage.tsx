import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Input, PageFrame, useToast } from '../components'
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
    setSubmitting(true)
    setError(null)
    try {
      const accepted = await startEmailChallenge({
        email,
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
    if (!challenge) return
    if (!/^\d{6}$/.test(otp)) {
      setError('请输入邮件中的 6 位数字验证码。')
      return
    }
    setSubmitting(true)
    setError(null)
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
      <PageFrame title="当前账号" description="你已登录此账户。账户或权限发生变化后，需要重新登录。">
        <section className="auth-page-panel stack">
          <div className="stack stack--small">
            <h2>{state.session.user.displayName} · {roleLabels[state.session.role]}</h2>
            <p>你可以继续返回刚才的页面，或安全退出此账户。</p>
          </div>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <div className="cluster">
            <Link className="button button--primary" to={returnPath}>继续返回原页面</Link>
            <Button variant="secondary" loading={submitting} onClick={() => void logout()}>
              退出登录
            </Button>
          </div>
        </section>
      </PageFrame>
    )
  }

  return (
    <PageFrame
      title="登录／注册"
      description="无需密码。输入邮箱并使用一次性验证码登录；新邮箱验证后会自动创建账号。"
    >
      <section className="auth-page-panel stack" aria-labelledby="email-auth-heading">
        <div className="stack stack--small">
          <h2 id="email-auth-heading">邮箱验证码登录</h2>
          <p>验证码 10 分钟内有效，最多可尝试 5 次；60 秒后可重新发送。</p>
          {state.comparisonProjectIds.length ? (
            <p className="boundary-note" role="note">
              当前 {state.comparisonProjectIds.length} 个临时比较作品会在本设备保留。
            </p>
          ) : null}
        </div>

        {!challenge ? (
          <form className="stack" onSubmit={(event) => void requestChallenge(event)} noValidate>
            <Input
              label="邮箱地址"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              hint="我们只会发送本次登录验证码，不会公开你的邮箱。"
            />
            {error ? <p className="field-error" role="alert">{error}</p> : null}
            <Button type="submit" variant="primary" loading={submitting}>发送验证码</Button>
          </form>
        ) : (
          <form className="stack" onSubmit={(event) => void verify(event)} noValidate>
            <p role="status">验证码已发送至 {challenge.masked_email}</p>
            <Input
              label="6 位验证码"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
            />
            {error ? <p className="field-error" role="alert">{error}</p> : null}
            <div className="cluster">
              <Button type="submit" variant="primary" loading={submitting}>验证并登录</Button>
              <Button
                type="button"
                variant="secondary"
                disabled={submitting || resendSeconds > 0}
                onClick={() => void requestChallenge()}
              >
                {resendSeconds > 0 ? `${resendSeconds} 秒后重新发送` : '重新发送验证码'}
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={submitting}
                onClick={() => {
                  setChallenge(null)
                  setOtp('')
                  setError(null)
                }}
              >
                更换邮箱
              </Button>
            </div>
          </form>
        )}

        <div className="wire-panel stack stack--small">
          <strong>暂不登录</strong>
          <p>游客仍可浏览、搜索和临时比较；收藏、关注、评论和发布需要登录。</p>
          <Button variant="secondary" onClick={() => navigate('/projects', { replace: true })}>
            先以游客身份浏览
          </Button>
        </div>
      </section>
    </PageFrame>
  )
}
