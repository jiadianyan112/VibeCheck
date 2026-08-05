import { projects } from '../../mocks'
import { adminProjectDraftFrom, saveAdminProjectDraft } from './projectEditor'

describe('admin project editor', () => {
  const project = projects[0]!

  it('updates allowed content fields while preserving protected lifecycle fields and fact metadata', () => {
    const draft = { ...adminProjectDraftFrom(project), currentName: '题练工坊 · 编辑版', coreFeatures: '材料导入\n分层练习' }
    const result = saveAdminProjectDraft(project, draft, false)
    expect(result.errors).toEqual({})
    expect(result.project?.currentName).toMatchObject({ state: 'known', value: '题练工坊 · 编辑版', evidenceIds: project.currentName.evidenceIds })
    expect(result.project?.coreFeatures).toMatchObject({ state: 'known', value: ['材料导入', '分层练习'] })
    expect(result.project?.publicUrl).toBe(project.publicUrl)
    expect(result.project?.accessStatus).toBe(project.accessStatus)
    expect(result.project?.historicalUrls).toBe(project.historicalUrls)
    expect(result.project?.eventIds).toBe(project.eventIds)
  })

  it('keeps the source platform read-only for editors but editable for administrators', () => {
    const draft = { ...adminProjectDraftFrom(project), originalPlatform: '管理员核对后的来源' }
    expect(saveAdminProjectDraft(project, draft, false).project?.originalPlatform).toBe(project.originalPlatform)
    expect(saveAdminProjectDraft(project, draft, true).project?.originalPlatform).toMatchObject({ value: '管理员核对后的来源' })
  })

  it('returns field-level validation messages without a partial save', () => {
    const draft = { ...adminProjectDraftFrom(project), currentName: '', targetUsers: [] }
    const result = saveAdminProjectDraft(project, draft, false)
    expect(result.project).toBeNull()
    expect(result.errors).toMatchObject({ currentName: '作品名称不能为空。', targetUsers: '至少选择一个目标用户。' })
  })
})
