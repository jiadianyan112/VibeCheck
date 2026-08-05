import { adminReviewDrafts, projects, prototypeUsers, verificationRequests } from '../../mocks'
import { appReducer, createInitialAppState } from '../../state'
import { applyIdentityWorkflow, applyPublicationWorkflow, mergeDuplicateProjects, reviewProjectStatus } from './workflows'
import { checkAdminConsistency } from './consistency'

const admin = prototypeUsers.find((user) => user.role === 'admin')!

describe('T51 admin consistency checks', () => {
  it('verifies synchronized publication, identity, status, event, notification and stable id changes', () => {
    let state = createInitialAppState()
    state = appReducer(state, { type: 'ADMIN_WORKFLOW_APPLY', mutation: applyPublicationWorkflow(adminReviewDrafts[0]!, 'approve', admin, '公开页面与提交版本一致。') })
    const verification = verificationRequests[0]!
    state = appReducer(state, { type: 'ADMIN_WORKFLOW_APPLY', mutation: applyIdentityWorkflow(verification, projects.find((project) => project.id === verification.projectId)!, 'verified', admin, '公开主页与作品地址相互关联。') })
    const statusProject = projects.find((project) => project.httpCheckStatus === 'timeout')!
    const firstStatus = reviewProjectStatus(statusProject, 'ended', 0, admin, '首次异常，仅进入待复查。')
    state = appReducer(state, { type: 'ADMIN_WORKFLOW_APPLY', mutation: firstStatus })
    state = appReducer(state, { type: 'ADMIN_WORKFLOW_APPLY', mutation: reviewProjectStatus(firstStatus.projects![0]!, 'ended', 1, admin, '第二次独立检查确认结束。') })
    state = appReducer(state, { type: 'ADMIN_WORKFLOW_APPLY', mutation: mergeDuplicateProjects(projects[0]!, projects[1]!, admin, '核对为同一作品。') })
    expect(checkAdminConsistency(state, projects)).toMatchObject({ ok: true, issues: [] })
  })

  it('reports duplicate records and missing cross-surface synchronization', () => {
    let state = createInitialAppState()
    const publication = applyPublicationWorkflow(adminReviewDrafts[0]!, 'approve', admin, '审核通过。')
    state = appReducer(state, { type: 'ADMIN_WORKFLOW_APPLY', mutation: publication })
    state = {
      ...state,
      lifecycleEventAdditions: [],
      notifications: publication.notifications ? [publication.notifications[0]!, publication.notifications[0]!] : [],
    }
    const result = checkAdminConsistency(state, projects)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['duplicate_notification', 'publication_sync']))
  })
})
