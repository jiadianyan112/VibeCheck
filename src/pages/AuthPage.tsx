import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageFrame, useToast } from '../components'
import { createLoginAction, roleDescriptions, roleLabels } from '../features'
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

  if (state.session.user) {
    const logout = () => {
      dispatch({ type: 'LOGOUT' })
      pushToast('已退出测试身份；账户私有数据已从当前会话移除。', 'success')
    }
    return (
      <PageFrame title="当前测试身份" description="这是低保真原型的权限模拟，不代表真实账户认证。">
        <section className="auth-page-panel stack">
          <div className="stack stack--small">
            <p className="eyebrow">P17 · 登录／注册模拟</p>
            <h2>{state.session.user.displayName} · {roleLabels[state.session.role]}</h2>
            <p>返回目标：<code>{returnPath}</code></p>
          </div>
          <div className="cluster">
            <Link className="button button--primary" to={returnPath}>继续返回原页面</Link>
            <Button variant="secondary" onClick={logout}>退出并切换身份</Button>
          </div>
        </section>
      </PageFrame>
    )
  }

  const login = (user: PrototypeUser) => {
    dispatch(createLoginAction(user))
    dispatch({ type: 'PENDING_ACTION_REPLAY' })
    pushToast('登录成功，正在返回刚才的页面。', 'success')
    navigate(returnPath, { replace: true, state: { from: location.pathname } })
  }

  return (
    <PageFrame
      title="选择原型身份"
      description="低保真原型不收集密码，也不会创建真实账户；选择身份后会回到 from 指定的页面。"
    >
      <section className="auth-page-panel stack" aria-labelledby="auth-choice-heading">
        <div className="stack stack--small">
          <p className="eyebrow">P17 · 登录／注册模拟</p>
          <h2 id="auth-choice-heading">固定测试身份</h2>
          <p>本次完成后返回：<code>{returnPath}</code></p>
        </div>
        <div className="auth-page-choices">
          {prototypeUsers.map((user) => (
            <div className="wire-panel stack stack--small" key={user.id}>
              <strong>{user.displayName} · {roleLabels[user.role]}</strong>
              <p>{roleDescriptions[user.role]}</p>
              <Button aria-label={`使用${user.displayName}测试身份`} onClick={() => login(user)}>使用此测试身份</Button>
            </div>
          ))}
        </div>
        <div className="wire-panel stack stack--small">
          <strong>游客</strong>
          <p>仅验证公开浏览、搜索和匿名比较；受保护页面仍会要求选择测试身份。</p>
          <Button variant="secondary" onClick={() => navigate('/projects', { replace: true })}>以游客身份继续</Button>
        </div>
      </section>
    </PageFrame>
  )
}
