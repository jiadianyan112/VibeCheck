import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProviders } from '../../app/providers'
import { projects } from '../../mocks'
import type { AuthSessionDto } from '../../services/authService'
import { interactionApi, type InteractionSnapshot } from '../../services/interactionApi'
import { projectService } from '../../services/projectService'
import { useAuthSession } from '../auth/AuthSessionContext'
import { useFavoriteProjects } from './useFavoriteProjects'
import { AccountFavorites } from './AccountFavorites'

vi.mock('../../services/authService', async original => ({ ...await original<typeof import('../../services/authService')>(), getAuthSession: vi.fn(async () => session) }))
vi.mock('../../services/interactionApi', () => ({ interactionApi: { favorites: vi.fn(), list: vi.fn(), setState: vi.fn() } }))
vi.mock('../../services/projectService', () => ({ projectService: { getById: vi.fn() } }))
const id = '11111111-1111-4111-8111-111111111111'
const secondId = '44444444-4444-4444-8444-444444444444'
const session = { authenticated: true, user_id: '22222222-2222-4222-8222-222222222222', csrf_token: 'csrf', roles: ['user'], primary_role: 'user', permissions: [], account_status: 'active' } as unknown as AuthSessionDto
const item = (project_id: string): InteractionSnapshot => ({ project_id, states: { like: false, favorite: true, follow: false }, counts: { like_count: 0, favorite_count: 1, follower_count: 0 } })
function Probe() {
  const favorites = useFavoriteProjects()
  const auth = useAuthSession()
  return <><output>{favorites.projects.map(project => project.id).join(',')}</output>{favorites.error ? <p role="alert">{favorites.error}</p> : null}<button onClick={() => void favorites.loadMore()}>更多</button><button onClick={() => auth.acceptSession({ ...session, user_id: '33333333-3333-4333-8333-333333333333' })}>切换账号</button></>
}
describe('account favorites', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('PROD', true)
    vi.stubEnv('MODE', 'production')
    vi.mocked(interactionApi.favorites).mockReset().mockResolvedValue({ items: [item(id)], next_cursor: 'next' })
    vi.mocked(interactionApi.list).mockReset().mockResolvedValue([item(id)])
    vi.mocked(interactionApi.setState).mockReset()
    vi.mocked(projectService.getById).mockReset().mockImplementation(async projectId => ({ ok: true, data: { ...projects[0]!, id: projectId } }))
  })
  afterEach(() => vi.unstubAllEnvs())
  it('shows account favorites and saves follow/cancel controls through the server', async () => {
    const user = userEvent.setup()
    render(<AppProviders><MemoryRouter><AccountFavorites /></MemoryRouter></AppProviders>)
    const follow = await screen.findByRole('button', { name: '关注更新' })
    await waitFor(() => expect(follow).toBeEnabled())
    vi.mocked(interactionApi.setState).mockResolvedValueOnce({ ...item(id), states: { like: false, favorite: true, follow: true } })
    await user.click(follow)
    await screen.findByRole('button', { name: '取消关注更新' })
    expect(interactionApi.setState).toHaveBeenCalledWith('follow', id, true, session)
    vi.mocked(interactionApi.favorites).mockResolvedValue({ items: [], next_cursor: null })
    vi.mocked(interactionApi.setState).mockResolvedValueOnce({ ...item(id), states: { like: false, favorite: false, follow: false } })
    await user.click(screen.getByRole('button', { name: '取消收藏' }))
    await screen.findByText('还没有收藏作品')
    expect(interactionApi.setState).toHaveBeenCalledWith('favorite', id, false, session)
  })
  it('loads real account favorites on a clean device, pages them and refreshes remote removals', async () => {
    const user = userEvent.setup()
    render(<AppProviders><Probe /></AppProviders>)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(id))
    vi.mocked(interactionApi.favorites).mockResolvedValueOnce({ items: [item(secondId)], next_cursor: null })
    await user.click(screen.getByRole('button', { name: '更多' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(secondId))
    expect(interactionApi.favorites).toHaveBeenCalledWith('next', expect.any(AbortSignal))
    vi.mocked(interactionApi.favorites).mockResolvedValue({ items: [], next_cursor: null })
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
  })
  it('retains confirmed items on failure and discards late reads after account switch', async () => {
    const user = userEvent.setup()
    render(<AppProviders><Probe /></AppProviders>)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(id))
    vi.mocked(interactionApi.favorites).mockRejectedValueOnce(new Error('network'))
    act(() => window.dispatchEvent(new Event('focus')))
    await screen.findByRole('alert')
    expect(screen.getByRole('status')).toHaveTextContent(id)
    let finish!: (page: { items: InteractionSnapshot[]; next_cursor: null }) => void
    vi.mocked(interactionApi.favorites).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    act(() => window.dispatchEvent(new Event('focus')))
    vi.mocked(interactionApi.favorites).mockResolvedValue({ items: [], next_cursor: null })
    await user.click(screen.getByRole('button', { name: '切换账号' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
    await act(async () => finish({ items: [item(id)], next_cursor: null }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
