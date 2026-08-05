import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { configureServiceRuntime } from '../services'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'

function seedUser(userIndex = 1) {
  const state = appReducer(createInitialAppState(), { type: 'LOGIN_COMPLETED', user: prototypeUsers[userIndex]! })
  persistAppState(state)
}

function renderUpdate(path = '/project/project-speakmirror/update?type=address') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) }
}

function persistedState() { return JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) }

async function fillContext(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: '来源说明' }), '作者公开发布说明与仓库同步更新。')
  await user.type(screen.getByRole('textbox', { name: '影响范围' }), '详情访问入口、现有使用者和关注者。')
}

describe('verified author project updates', () => {
  beforeEach(() => { localStorage.clear(); configureServiceRuntime({ defaultDelayMs: 0 }); seedUser() })

  it('previews and appends an address migration to detail, activity and follower notifications', async () => {
    const user = userEvent.setup()
    const { router } = renderUpdate()
    expect(await screen.findByRole('heading', { name: '更新 口语回声' })).toBeInTheDocument()
    expect(screen.getByText('https://example.test/products/project-speakmirror')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '新公开地址' }), 'https://example.test/products/speakmirror-v3')
    await fillContext(user)
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交更新' }))
    expect(await screen.findByText('更新已追加写入')).toBeInTheDocument()
    await waitFor(() => expect(persistedState().projectUpdateRecords).toHaveLength(1))
    const state = persistedState()
    expect(state.projectOverrides[0].historicalUrls).toEqual(expect.arrayContaining([expect.objectContaining({ url: 'https://example.test/products/project-speakmirror' })]))
    expect(state.lifecycleEventAdditions[0].changes[0]).toMatchObject({ before: 'https://example.test/products/project-speakmirror', after: 'https://example.test/products/speakmirror-v3' })
    expect(state.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ userId: 'user-mia', eventId: state.lifecycleEventAdditions[0].id })]))

    await act(async () => { await router.navigate('/project/project-speakmirror') })
    expect(await screen.findByText('公开地址迁移：https://example.test/products/speakmirror-v3')).toBeInTheDocument()
    await act(async () => { await router.navigate('/activity') })
    expect(await screen.findByText('公开地址迁移：https://example.test/products/speakmirror-v3')).toBeInTheDocument()
  }, 10_000)

  it('blocks an ended state until the author explicitly declares it', async () => {
    const user = userEvent.setup()
    renderUpdate('/project/project-speakmirror/update?type=status')
    await screen.findByRole('heading', { name: '更新 口语回声' })
    await user.selectOptions(screen.getByRole('combobox', { name: '新作品状态' }), 'ended')
    await fillContext(user)
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    expect(screen.getByRole('alert')).toHaveTextContent('暂停或结束必须由作者明确勾选声明')
    await user.click(screen.getByRole('checkbox', { name: /我明确声明该作品已经结束/ }))
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交更新' }))
    await waitFor(() => expect(persistedState().projectOverrides[0].accessStatus).toMatchObject({ state: 'known', value: 'ended' }))
    expect(persistedState().lifecycleEventAdditions[0].type).toBe('ended')
  })

  it('routes an unverified user to identity verification or public correction', async () => {
    localStorage.clear(); seedUser(0)
    renderUpdate('/project/project-quizforge/update')
    expect(await screen.findByRole('heading', { name: '没有此作品的更新权限' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '申请作者身份验证' })).toHaveAttribute('href', '/project/project-quizforge/verify-author')
    expect(screen.getByRole('link', { name: '提交公开纠错' })).toHaveAttribute('href', '/about#corrections')
  })

  it('restores an update draft after network failure and retries without duplicate events', async () => {
    const user = userEvent.setup()
    const first = renderUpdate('/project/project-speakmirror/update?type=address&scenario=network_error')
    await screen.findByRole('heading', { name: '更新 口语回声' })
    await user.type(screen.getByRole('textbox', { name: '新公开地址' }), 'https://example.test/products/retry-address')
    await fillContext(user)
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交更新' }))
    expect(await screen.findByText('网络连接不可用，已保留当前内容。')).toBeInTheDocument()
    expect(screen.getByText('VC_NETWORK_UNAVAILABLE')).toBeInTheDocument()
    await waitFor(() => expect(persistedState().projectUpdateDrafts[0]).toMatchObject({ input: { value: 'https://example.test/products/retry-address' }, lastErrorCode: 'VC_NETWORK_UNAVAILABLE' }))
    first.unmount()

    renderUpdate('/project/project-speakmirror/update?type=address')
    expect(await screen.findByRole('textbox', { name: '新公开地址' })).toHaveValue('https://example.test/products/retry-address')
    expect(screen.getByRole('textbox', { name: '来源说明' })).toHaveValue('作者公开发布说明与仓库同步更新。')
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交更新' }))
    expect(await screen.findByText('更新已追加写入')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交更新' }))
    await waitFor(() => expect(persistedState().projectUpdateRecords).toHaveLength(1))
    expect(persistedState().lifecycleEventAdditions).toHaveLength(1)
  }, 10_000)

  it('preserves the draft and redirects when permission expires during submission', async () => {
    const user = userEvent.setup()
    renderUpdate('/project/project-speakmirror/update?type=version&scenario=permission_expired')
    await user.type(await screen.findByRole('textbox', { name: '新版本名称或编号' }), '3.0')
    await fillContext(user)
    await user.click(screen.getByRole('button', { name: '预览确认并提交更新' }))
    await user.click(screen.getByRole('button', { name: '确认提交更新' }))
    expect(await screen.findByText('作者管理权限已失效，当前草稿已保留；请重新完成身份验证。')).toBeInTheDocument()
    expect(screen.getByText('VC_UPDATE_PERMISSION_EXPIRED')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新验证作者权限' })).toHaveAttribute('href', '/project/project-speakmirror/verify-author')
    expect(persistedState().projectUpdateRecords).toHaveLength(0)
    expect(persistedState().projectUpdateDrafts[0].input.value).toBe('3.0')
  })
})
