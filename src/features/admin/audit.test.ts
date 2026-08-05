import { evidences, projects, prototypeUsers } from '../../mocks'
import { adminProjectDraftFrom, saveAdminProjectDraft } from './projectEditor'
import { createAdminFieldAuditLogs, mergeEvidenceRecords, reviewEvidence } from './audit'

describe('admin audit history', () => {
  it('records actor, before, after and reason for every changed field', () => {
    const before = projects[0]!
    const draft = { ...adminProjectDraftFrom(before), currentName: '题练工坊 · 已核对', coreFeatures: '导入\n反馈' }
    const after = saveAdminProjectDraft(before, draft, false).project!
    const logs = createAdminFieldAuditLogs(before, after, prototypeUsers[2]!, '根据公开页逐字段核对。')
    expect(logs).toHaveLength(2)
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorUserId: 'user-editor', fieldKey: 'currentName', beforeValue: '题练工坊', afterValue: '题练工坊 · 已核对', reason: '根据公开页逐字段核对。' }),
      expect.objectContaining({ fieldKey: 'coreFeatures', beforeValue: ['材料导入', '练习生成', '即时反馈'], afterValue: ['导入', '反馈'] }),
    ]))
    expect(() => createAdminFieldAuditLogs(before, after, prototypeUsers[2]!, '')).toThrow('VC_ADMIN_CHANGE_REASON_REQUIRED')
  })

  it('marks evidence without replacing its stable id or source and creates an append-only log', () => {
    const original = evidences[0]!
    const result = reviewEvidence(original, 'disputed', prototypeUsers[2]!, '公开页与仓库说明冲突。')
    expect(result.evidence).toMatchObject({ id: original.id, sourceUrl: original.sourceUrl, reviewStatus: 'disputed', disputeStatus: 'in_review' })
    expect(result.log).toMatchObject({ action: 'evidence_review', evidenceId: original.id, beforeValue: 'current', afterValue: 'disputed' })
    expect(mergeEvidenceRecords(evidences, [result.evidence])).toHaveLength(evidences.length)
  })
})
