import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProviders } from '../../app/providers'
import type { AuthSessionDto } from '../../services/authService'
import { serverNotificationApi, type ServerNotificationPage } from '../../services/serverNotificationApi'
import { useAuthSession } from '../auth/AuthSessionContext'
import { useServerNotifications } from './ServerNotificationContext'

vi.mock('../../services/authService', async original => ({ ...await original<typeof import('../../services/authService')>(), getAuthSession: vi.fn(async () => session) }))
vi.mock('../../services/serverNotificationApi', () => ({ serverNotificationApi: { list: vi.fn(), markRead: vi.fn() } }))
const session = { authenticated: true, user_id: '22222222-2222-4222-8222-222222222222', csrf_token: 'csrf', roles: ['user'], primary_role: 'user', permissions: [], account_status: 'active' } as unknown as AuthSessionDto
const page: ServerNotificationPage = { items: [{ notification_id: 'notice', type: 'project_updated', title: '更新', body_summary: '更新内容', target_type: 'project', target_id: 'project', event_id: 'event', created_at: '2026-10-03T00:00:00Z', read_at: null }], unread_count: 1, next_cursor: null }
function Probe() {
  const notifications = useServerNotifications()
  const auth = useAuthSession()
  return <><output aria-label="未读">{notifications.unreadCount}</output><output aria-label="状态">{notifications.items[0]?.read_at ? '已读' : '未读'}</output><button onClick={() => void notifications.markRead('notice')}>标记</button><button onClick={() => auth.acceptSession({ ...session, user_id: '33333333-3333-4333-8333-333333333333' })}>切换</button></>
}
describe('server notification synchronization', () => {
  beforeEach(() => { localStorage.clear(); vi.stubEnv('PROD', true); vi.stubEnv('MODE', 'production'); vi.mocked(serverNotificationApi.list).mockReset().mockResolvedValue(page); vi.mocked(serverNotificationApi.markRead).mockReset() })
  afterEach(() => vi.unstubAllEnvs())
  it('refreshes remotely read notifications on focus', async () => {
    render(<AppProviders><Probe /></AppProviders>)
    await waitFor(() => expect(screen.getByLabelText('未读')).toHaveTextContent('1'))
    vi.mocked(serverNotificationApi.list).mockResolvedValue({ ...page, unread_count: 0, items: [{ ...page.items[0]!, read_at: '2026-10-03T01:00:00Z' }] })
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(screen.getByLabelText('未读')).toHaveTextContent('0'))
    expect(screen.getByLabelText('状态')).toHaveTextContent('已读')
  })
  it('does not overwrite a confirmed read with a late background response', async () => {
    const user = userEvent.setup()
    render(<AppProviders><Probe /></AppProviders>)
    await waitFor(() => expect(screen.getByLabelText('未读')).toHaveTextContent('1'))
    let finish!: (value: ServerNotificationPage) => void
    vi.mocked(serverNotificationApi.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    act(() => window.dispatchEvent(new Event('focus')))
    vi.mocked(serverNotificationApi.markRead).mockResolvedValue({ read: true, changed_count: 1, unread_count: 0, read_at: '2026-10-03T01:00:00Z' })
    await user.click(screen.getByRole('button', { name: '标记' }))
    await waitFor(() => expect(screen.getByLabelText('未读')).toHaveTextContent('0'))
    await act(async () => finish(page))
    expect(screen.getByLabelText('未读')).toHaveTextContent('0')
    expect(screen.getByLabelText('状态')).toHaveTextContent('已读')
  })
})
