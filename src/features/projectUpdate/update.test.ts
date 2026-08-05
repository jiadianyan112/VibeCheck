import { projects, prototypeUsers, userAssets } from '../../mocks'
import { applyProjectUpdate, canUserUpdateProject, followerNotifications, type ProjectUpdateInput } from './update'

const project = projects.find((item) => item.id === 'project-speakmirror')!
const author = prototypeUsers.find((user) => user.id === 'user-zhou')!

function input(overrides: Partial<ProjectUpdateInput>): ProjectUpdateInput {
  return { type: 'version', value: '2.2', sourceType: 'release_notes', sourceSummary: '公开发布说明', impactScope: '详情与使用者', terminalDeclared: false, assetName: '', assetType: 'source_code', assetLicense: '', ...overrides }
}

describe('project update lifecycle', () => {
  it('keeps address history and writes the same before-after change to an append-only event', () => {
    const oldUrl = project.publicUrl.state === 'known' ? project.publicUrl.value : null
    const result = applyProjectUpdate(project, author, input({ type: 'address', value: 'https://example.test/products/speakmirror-new' }))
    expect(result.project.publicUrl).toMatchObject({ state: 'known', value: 'https://example.test/products/speakmirror-new' })
    expect(result.project.historicalUrls.at(-1)).toMatchObject({ url: oldUrl, effectiveTo: '2026-07-31T12:00:00+08:00' })
    expect(result.event).toMatchObject({ type: 'domain_migrated', changes: [{ fieldKey: 'address', before: oldUrl, after: 'https://example.test/products/speakmirror-new' }] })
  })

  it('requires an explicit author declaration for paused and ended states', () => {
    expect(() => applyProjectUpdate(project, author, input({ type: 'status', value: 'ended' }))).toThrow('VC_TERMINAL_DECLARATION_REQUIRED')
    const result = applyProjectUpdate(project, author, input({ type: 'status', value: 'ended', terminalDeclared: true }))
    expect(result.event.type).toBe('ended')
    expect(result.project.accessStatus).toMatchObject({ state: 'known', value: 'ended' })
  })

  it('creates version, description and asset events plus notifications for followers', () => {
    const version = applyProjectUpdate(project, author, input({ type: 'version', value: '2.2' }))
    const description = applyProjectUpdate(project, author, input({ type: 'description', value: '新的公开说明' }))
    const asset = applyProjectUpdate(project, author, input({ type: 'asset', value: 'https://example.test/assets/new', assetName: '口语评分组件', assetType: 'component' }))
    expect(version.event.type).toBe('version_updated')
    expect(description.event.type).toBe('product_pivoted')
    expect(asset.event.type).toBe('asset_added')
    expect(asset.asset).toMatchObject({ name: '口语评分组件', projectId: project.id })
    expect(followerNotifications(version.project, version.event, author, userAssets)).toEqual([expect.objectContaining({ userId: 'user-mia', eventId: version.event.id })])
    expect(canUserUpdateProject(project, author, [])).toEqual({ allowed: true, disputed: false })
  })
})
