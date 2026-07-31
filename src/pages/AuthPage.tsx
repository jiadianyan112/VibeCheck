import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageFrame, useToast } from '../components'
import { prototypeUsers } from '../mocks'
import { useAppState } from '../state'
import type { PrototypeUser } from '../types'

export function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/projects'
  return value
}

export function AuthPage() {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const returnPath = safeReturnPath(searchParams.get('from'))

  if (state.session.user) return (
    <PageFrame title="已登录" description={`当前身份：${state.session.user.displayName}`}>
      <Link className="button button--primary" to={returnPath}>继续返回原页面</Link>
    </PageFrame>
  )

  const login = (user: PrototypeUser) => {
    dispatch({ type: 'LOGIN_COMPLETED', user })
    dispatch({ type: 'PENDING_ACTION_REPLAY' })
    pushToast('登录成功，正在返回刚才的页面。', 'success')
    navigate(returnPath, { replace: true, state: { from: location.pathname } })
  }

  return (
    <PageFrame
      title="选择原型身份"
      description="低保真原型不收集密码；登录后会回到刚才的发布入口。"
    >
      <section className="auth-page-panel stack" aria-labelledby="auth-choice-heading">
        <div className="stack stack--small">
          <p className="eyebrow">P17 · 登录／注册</p>
          <h2 id="auth-choice-heading">固定测试身份</h2>
          <p>本次完成后返回：<code>{returnPath}</code></p>
        </div>
        <div className="auth-page-choices">
          {prototypeUsers.map((user) => (
            <Button key={user.id} onClick={() => login(user)}>
              {user.displayName} · {user.role}
            </Button>
          ))}
        </div>
      </section>
    </PageFrame>
  )
}
