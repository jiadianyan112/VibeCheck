import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Button, ConfirmDialog, ErrorBoundary, ToastProvider } from '../../components'
import { projectId, userId } from '../../types'
import { AppStateProvider, useAppState } from '../../state'
import { AuthGateProvider, LoginGate } from './AuthGate'

const targetId = projectId('project-papertopractice')

function StateProbe() {
  const { state, dispatch } = useAppState()
  return <div><output aria-label="登录状态">{state.session.user?.displayName ?? '访客'}</output><output aria-label="收藏数量">{state.favoriteProjectIds.length}</output><output aria-label="待执行动作">{state.pendingAction?.kind ?? '无'}</output><Button onClick={() => { dispatch({ type: 'SESSION_SYNCED', user: { id: userId('11111111-1111-4111-8111-111111111111'), displayName: '邮箱用户', role: 'user', creatorId: null } }); dispatch({ type: 'PENDING_ACTION_REPLAY' }) }}>模拟服务端登录</Button><Button onClick={() => dispatch({ type: 'PENDING_ACTION_REPLAY' })}>再次回放</Button></div>
}

function GateExample() {
  const { dispatch } = useAppState()
  return <><LoginGate action={{ id: 'pending-favorite-1', kind: 'favorite', projectId: targetId, sourcePath: '/projects' }} onAuthorized={() => dispatch({ type: 'FAVORITE_TOGGLE', projectId: targetId })}>{(run) => <Button onClick={run}>收藏测试作品</Button>}</LoginGate><StateProbe /></>
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter><AppStateProvider><ToastProvider><AuthGateProvider>{children}</AuthGateProvider></ToastProvider></AppStateProvider></MemoryRouter>
}

describe('AuthGate', () => {
  beforeEach(() => localStorage.clear())

  it('queues a guest action and replays it exactly once after login', async () => {
    const user = userEvent.setup()
    render(<GateExample />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '收藏测试作品' }))
    expect(screen.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeInTheDocument()
    expect(screen.getByLabelText('待执行动作')).toHaveTextContent('favorite')
    expect(screen.getByRole('link', { name: '使用邮箱验证码登录' })).toHaveAttribute(
      'href',
      '/auth?return_to=%2Fprojects',
    )
    await user.click(screen.getByRole('button', { name: '模拟服务端登录' }))
    expect(screen.getByLabelText('登录状态')).toHaveTextContent('邮箱用户')
    expect(screen.getByLabelText('收藏数量')).toHaveTextContent('1')
    expect(screen.getByLabelText('待执行动作')).toHaveTextContent('无')
    await user.click(screen.getByRole('button', { name: '再次回放' }))
    expect(screen.getByLabelText('收藏数量')).toHaveTextContent('1')
  })

  it('runs an authenticated action without reopening the gate', async () => {
    const user = userEvent.setup()
    render(<GateExample />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: '收藏测试作品' }))
    await user.click(screen.getByRole('button', { name: '模拟服务端登录' }))
    await user.click(screen.getByRole('button', { name: '收藏测试作品' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('收藏数量')).toHaveTextContent('0')
  })

  it('supports destructive confirmation cancellation with Escape', async () => {
    const user = userEvent.setup(); const confirm = vi.fn(); const cancel = vi.fn()
    render(<ConfirmDialog open title="删除草稿？" description="删除后不可恢复。" danger onConfirm={confirm} onCancel={cancel} />)
    await user.keyboard('{Escape}')
    expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled()
  })

  it('catches rendering failures in a readable panel', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Broken(): never { throw new Error('render exploded') }
    render(<ErrorBoundary><Broken /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('页面出现问题')
    expect(screen.queryByText('render exploded')).not.toBeInTheDocument()
    consoleSpy.mockRestore()
  })
})
