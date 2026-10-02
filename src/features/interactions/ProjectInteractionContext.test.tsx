import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProviders } from '../../app/providers'
import { projects } from '../../mocks'
import type { AuthSessionDto } from '../../services/authService'
import { interactionApi, type InteractionSnapshot } from '../../services/interactionApi'
import { useAuthSession } from '../auth/AuthSessionContext'
import { useProjectInteractions } from './ProjectInteractionContext'

vi.mock('../../services/authService', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/authService')>(),
  getAuthSession: vi.fn(async () => session),
}))
vi.mock('../../services/interactionApi', () => ({ interactionApi: { list: vi.fn(), setLike: vi.fn() } }))
const id = '11111111-1111-4111-8111-111111111111'
const project = { ...projects[0]!, id: id as typeof projects[number]['id'] }
const session: AuthSessionDto = {
  authenticated: true, user_id: '22222222-2222-4222-8222-222222222222', display_name: '测试用户',
  account_status: 'active', roles: ['user'], primary_role: 'user', permissions: [],
  session_version: 1, csrf_token: 'csrf-device-a', recent_auth_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z',
}
const snapshot = (like: boolean, count: number): InteractionSnapshot => ({
  project_id: id, states: { like, favorite: false, follow: false }, counts: { like_count: count, favorite_count: 0, follower_count: 0 },
})
function Probe() {
  const interactions = useProjectInteractions([project])
  const auth = useAuthSession()
  return <>
    <output aria-label="点赞数">{interactions.likeCount(project)}</output>
    <button disabled={interactions.busy(project)} onClick={() => interactions.toggleLike(project)}>{interactions.liked(project) ? '取消点赞' : '点赞'}</button>
    <button onClick={() => auth.acceptSession({ ...session, user_id: '33333333-3333-4333-8333-333333333333' })}>切换账号</button>
  </>
}
describe('server-backed project likes', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('PROD', true)
    vi.stubEnv('MODE', 'production')
    vi.mocked(interactionApi.list).mockReset().mockResolvedValue([snapshot(false, 7)])
    vi.mocked(interactionApi.setLike).mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('restores account likes on another device and refreshes another device change on focus', async () => {
    vi.mocked(interactionApi.list).mockResolvedValue([snapshot(true, 8)])
    const first = render(<AppProviders><Probe /></AppProviders>)
    expect(await screen.findByRole('button', { name: '取消点赞' })).toBeInTheDocument()
    expect(screen.getByLabelText('点赞数')).toHaveTextContent('8')
    first.unmount()
    localStorage.clear()
    render(<AppProviders><Probe /></AppProviders>)
    expect(await screen.findByRole('button', { name: '取消点赞' })).toBeInTheDocument()
    vi.mocked(interactionApi.list).mockResolvedValue([snapshot(false, 7)])
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(screen.getByLabelText('点赞数')).toHaveTextContent('7'))
    expect(screen.getByRole('button', { name: '点赞' })).toBeInTheDocument()
  })

  it('uses confirmed totals without adding one twice and keeps confirmed state on failed saves', async () => {
    const user = userEvent.setup()
    render(<AppProviders><Probe /></AppProviders>)
    await waitFor(() => expect(screen.getByLabelText('点赞数')).toHaveTextContent('7'))
    vi.mocked(interactionApi.setLike).mockResolvedValueOnce(snapshot(true, 8))
    await user.click(screen.getByRole('button', { name: '点赞' }))
    await waitFor(() => expect(screen.getByLabelText('点赞数')).toHaveTextContent('8'))
    expect(interactionApi.setLike).toHaveBeenCalledWith(id, true, session)
    vi.mocked(interactionApi.setLike).mockRejectedValueOnce(new Error('network'))
    await user.click(screen.getByRole('button', { name: '取消点赞' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('点赞未保存')
    expect(screen.getByLabelText('点赞数')).toHaveTextContent('8')
    expect(screen.getByRole('button', { name: '取消点赞' })).toBeInTheDocument()
  })

  it('loads the new account state without carrying over the previous account likes', async () => {
    const user = userEvent.setup()
    vi.mocked(interactionApi.list).mockResolvedValue([snapshot(true, 8)])
    render(<AppProviders><Probe /></AppProviders>)
    await screen.findByRole('button', { name: '取消点赞' })
    vi.mocked(interactionApi.list).mockResolvedValue([snapshot(false, 8)])
    await user.click(screen.getByRole('button', { name: '切换账号' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '点赞' })).toBeInTheDocument())
    expect(screen.getByLabelText('点赞数')).toHaveTextContent('8')
  })

  it('does not let a late background read overwrite a confirmed write', async () => {
    const user = userEvent.setup()
    render(<AppProviders><Probe /></AppProviders>)
    await waitFor(() => expect(screen.getByLabelText('点赞数')).toHaveTextContent('7'))
    let finishRead!: (items: InteractionSnapshot[]) => void
    vi.mocked(interactionApi.list).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    act(() => window.dispatchEvent(new Event('focus')))
    vi.mocked(interactionApi.setLike).mockResolvedValueOnce(snapshot(true, 8))
    await user.click(screen.getByRole('button', { name: '点赞' }))
    await waitFor(() => expect(screen.getByLabelText('点赞数')).toHaveTextContent('8'))
    await act(async () => finishRead([snapshot(false, 7)]))
    expect(screen.getByRole('button', { name: '取消点赞' })).toBeInTheDocument()
    expect(screen.getByLabelText('点赞数')).toHaveTextContent('8')
  })
})
