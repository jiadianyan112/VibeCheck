import { adminReviewDrafts, projects, prototypeUsers, verificationRequests } from '../../mocks'
import {
  applyIdentityWorkflow,
  applyPublicationWorkflow,
  isAdminWorkflowAllowed,
  mergeDuplicateProjects,
  restrictProjectDisplay,
  reviewProjectStatus,
} from './workflows'

const editor = prototypeUsers.find((user) => user.role === 'editor')!
const admin = prototypeUsers.find((user) => user.role === 'admin')!

describe('T50 admin workflows', () => {
  it('reviews a submission with a required reason and stable audit output', () => {
    const draft = adminReviewDrafts.find((item) => item.status === 'pending_review')!
    const first = applyPublicationWorkflow(draft, 'approve', editor, '公开页面与提交字段一致。')
    const retry = applyPublicationWorkflow(draft, 'approve', editor, '公开页面与提交字段一致。')
    expect(first.submissionDraft).toMatchObject({ status: 'approved', reviewMessages: { submission: '公开页面与提交字段一致。' } })
    expect(first.projects?.[0]?.id).toBe(first.submissionDraft?.publishedProjectId)
    expect(first.notifications?.[0]).toMatchObject({ userId: draft.userId, type: 'submission_reviewed' })
    expect(retry.log.id).toBe(first.log.id)
    expect(applyPublicationWorkflow(draft, 'return', editor, '需要补充来源。').submissionDraft?.status).toBe('changes_requested')
    expect(applyPublicationWorkflow(draft, 'reject', editor, '不符合收录范围。').submissionDraft?.status).toBe('rejected')
    expect(applyPublicationWorkflow(draft, 'dispute', admin, '存在冲突主张。').submissionDraft?.status).toBe('restricted')
    expect(() => applyPublicationWorkflow(draft, 'reject', editor, '')).toThrow('VC_ADMIN_WORKFLOW_REASON_REQUIRED')
    expect(() => applyPublicationWorkflow(draft, 'dispute', editor, '归属冲突。')).toThrow('VC_ADMIN_WORKFLOW_FORBIDDEN')
  })

  it('merges duplicate histories under a stable main id and archives the secondary record', () => {
    const main = projects[0]!
    const duplicate = projects[1]!
    const result = mergeDuplicateProjects(main, duplicate, admin, '公开地址、定义和核心流程指向同一作品。')
    expect(result.alias).toEqual({ from: duplicate.id, to: main.id })
    expect(result.projects?.[0]).toMatchObject({ id: main.id })
    expect(result.projects?.[0]?.historicalUrls).toEqual(expect.arrayContaining([expect.objectContaining({ url: duplicate.publicUrl.state === 'known' ? duplicate.publicUrl.value : '' })]))
    expect(result.projects?.[0]?.assetIds).toEqual(expect.arrayContaining(duplicate.assetIds))
    expect(result.projects?.[1]).toMatchObject({ id: duplicate.id, reviewStatus: 'archived' })
    expect(() => mergeDuplicateProjects(main, duplicate, editor, '疑似重复。')).toThrow('VC_ADMIN_WORKFLOW_FORBIDDEN')
  })

  it('reviews identity without copying private material into public logs', () => {
    const request = verificationRequests[0]!
    const project = projects.find((item) => item.id === request.projectId)!
    const result = applyIdentityWorkflow(request, project, 'verified', admin, '公开主页与目标地址形成双向关联。')
    expect(result.verificationRequest).toMatchObject({ status: 'verified', privateMaterialReference: request.privateMaterialReference })
    expect(result.projects?.[0]).toMatchObject({ authorLinkStatus: 'linked' })
    expect(JSON.stringify(result.log)).not.toContain(request.privateMaterialReference)
    expect(result.notifications?.[0]).toMatchObject({ userId: request.userId, type: 'verification_reviewed' })
    expect(isAdminWorkflowAllowed('identity_changes_requested', 'editor')).toBe(true)
    expect(isAdminWorkflowAllowed('identity_verified', 'editor')).toBe(false)
  })

  it('queues the first URL anomaly without changing access status, then lets an admin confirm it', () => {
    const project = projects.find((item) => item.httpCheckStatus === 'timeout')!
    const before = project.accessStatus
    const first = reviewProjectStatus(project, 'ended', 0, editor, '首次超时，等待独立复查。')
    expect(first.projects?.[0]?.accessStatus).toEqual(before)
    expect(first.projects?.[0]).toMatchObject({ reviewStatus: 'update_pending' })
    expect(first.lifecycleEvents).toEqual([])
    expect(first.statusReview?.count).toBe(1)
    expect(() => reviewProjectStatus(project, 'ended', 1, editor, '第二次仍异常。')).toThrow('VC_ADMIN_WORKFLOW_FORBIDDEN')
    const confirmed = reviewProjectStatus(first.projects![0]!, 'ended', 1, admin, '两次独立检查后确认结束。')
    expect(confirmed.projects?.[0]?.accessStatus).toMatchObject({ state: 'known', value: 'ended' })
    expect(confirmed.lifecycleEvents?.[0]).toMatchObject({ type: 'ended', changes: [expect.objectContaining({ after: 'ended' })] })
  })

  it('restricts display without deleting the record', () => {
    const result = restrictProjectDisplay(projects[0]!, admin, '公开材料存在高风险争议。')
    expect(result.projects?.[0]).toMatchObject({ id: projects[0]!.id, reviewStatus: 'restricted' })
    expect(result.log).toMatchObject({ action: 'display_restricted', projectId: projects[0]!.id })
  })
})
