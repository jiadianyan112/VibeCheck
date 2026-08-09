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
      pushToast('已退出当前身份。', 'success')
    }
    return (
      <PageFrame title="当前账号" description="你已登录，可以继续使用收藏、比较和发布功能。">
        <section className="auth-page-panel stack">
          <div className="stack stack--small">
            <h2>{state.session.user.displayName} · {roleLabels[state.session.role]}</h2>
            <p>你可以继续刚才的操作，或切换其他账号。</p>
          </div>
          <div className="cluster">
            <Link className="button button--primary" to={returnPath}>继续返回原页面</Link>
            <Button variant="secondary" onClick={logout}>切换账号</Button>
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
      title="登录／注册"
      description="登录后可以保存比较、关注作品、参与讨论和发布作品。"
    >
      <section className="auth-page-panel stack" aria-labelledby="auth-choice-heading">
        <div className="stack stack--small">
          <h2 id="auth-choice-heading">选择账号继续</h2>
          {state.comparisonProjectIds.length ? <p className="boundary-note" role="note">登录后将保存当前 {state.comparisonProjectIds.length} 个比较作品，不会自动合并账号中的历史比较。</p> : null}
        </div>
        <div className="auth-page-choices">
          {prototypeUsers.map((user) => (
            <div className="wire-panel stack stack--small" key={user.id}>
              <strong>{user.displayName} · {roleLabels[user.role]}</strong>
              <p>{roleDescriptions[user.role]}</p>
              <Button aria-label={`使用${user.displayName}账号`} onClick={() => login(user)}>使用此账号</Button>
            </div>
          ))}
        </div>
        <div className="wire-panel stack stack--small">
          <strong>游客</strong>
          <p>可以浏览、搜索和临时比较作品，需要保存或发布时再选择身份。</p>
          <Button variant="secondary" onClick={() => navigate('/projects', { replace: true })}>先以游客身份浏览</Button>
        </div>
      </section>
    </PageFrame>
  )
}
