import { assetId, submissionDraftId, userId, type SubmissionDraft } from '../../types'
import { applySubmissionReview, publishedEventFromSubmission, publishedProjectFromSubmission, resumeSubmission, withdrawSubmission } from './review'

const draft: SubmissionDraft = {
  id: submissionDraftId('draft-review-stable'),
  userId: userId('user-mia'),
  status: 'draft',
  step: 'preview',
  fields: {
    currentName: '稳定发布测试',
    publicUrl: 'https://example.test/stable',
    screenshotUrl: null,
    accessStatus: 'normal',
    repositoryUrl: null,
    oneLineDefinition: '验证审核单与发布事件保持稳定。',
    targetUsers: ['university_students'],
    coreProblem: '避免重复发布记录',
    useScenarios: ['daily_practice'],
    mainInputs: ['plain_text'],
    mainOutputs: ['practice_set'],
    coreFlow: [{ id: 'one', order: 1, label: '提交', description: '' }],
  },
  originalExtraction: {},
  assetIds: [assetId('asset-test')],
  duplicateProjectId: null,
  validationErrors: {},
  reviewMessages: {},
  submittedFields: null,
  submittedAssetIds: [],
  supplementalMaterial: '',
  publishedProjectId: null,
  publishedEventId: null,
  createdAt: '2026-07-31T10:00:00+08:00',
  updatedAt: '2026-07-31T10:20:00+08:00',
  submittedAt: null,
  withdrawnAt: null,
}

describe('submission review lifecycle', () => {
  it('keeps one frozen submitted version and stable publish identifiers', () => {
    const pending = applySubmissionReview(draft, 'pending_review')
    const locallyEdited = { ...pending, fields: { ...pending.fields, currentName: '未送审的本地改名' } }
    const approved = applySubmissionReview(locallyEdited, 'approved', '2026-08-01T09:00:00+08:00')
    const approvedAgain = applySubmissionReview(approved, 'approved', '2026-08-02T09:00:00+08:00')

    expect(approved.submittedFields?.currentName).toBe('稳定发布测试')
    expect(approved.submittedAt).toBe(pending.submittedAt)
    expect(approvedAgain.publishedProjectId).toBe(approved.publishedProjectId)
    expect(approvedAgain.publishedEventId).toBe(approved.publishedEventId)
    expect(publishedProjectFromSubmission(approved)?.id).toBe(approved.publishedProjectId)
    expect(publishedEventFromSubmission(approved)?.projectId).toBe(approved.publishedProjectId)
  })

  it('provides field-level changes, rejection reason, withdrawal and resumption', () => {
    const requested = applySubmissionReview(draft, 'changes_requested')
    expect(requested.reviewMessages.oneLineDefinition).toMatch(/目标用户/)
    expect(requested.reviewMessages.repositoryUrl).toMatch(/公开仓库/)
    expect(applySubmissionReview(draft, 'rejected').reviewMessages.submission).toMatch(/无法收录/)

    const withdrawn = withdrawSubmission(requested)
    expect(withdrawn.status).toBe('withdrawn')
    expect(withdrawn.submittedFields).not.toBeNull()
    const resumed = resumeSubmission(withdrawn)
    expect(resumed).toMatchObject({ status: 'draft', step: 'preview', submittedFields: null, submittedAt: null })
  })

  it('keeps unsubmitted portfolio classifications unknown instead of inventing defaults', () => {
    const portfolioDraft: SubmissionDraft = {
      ...draft,
      id: submissionDraftId('draft-review-portfolio'),
      fields: {
        currentName: '最小作品集',
        publicUrl: 'https://example.test/portfolio',
        oneLineDefinition: '展示开发项目与公开联系方式。',
        categoryId: 'personal_site_portfolio',
        creatorRoles: ['developer'],
        primaryGoals: ['showcase_projects'],
        coreModules: ['hero', 'projects', 'contact'],
        accessStatus: 'normal',
      },
      assetIds: [],
    }
    const published = publishedProjectFromSubmission(applySubmissionReview(portfolioDraft, 'approved', '2026-08-01T09:00:00+08:00'))
    expect(published?.categoryData?.creatorRoles).toMatchObject({ state: 'known', value: ['developer'] })
    expect(published?.categoryData?.coreModules).toMatchObject({ state: 'known', value: ['hero', 'projects', 'contact'] })
    expect(published?.categoryData?.siteType.state).toBe('unknown')
    expect(published?.categoryData?.visualStyles.state).toBe('unknown')
    expect(published?.assetIds).toEqual([])
  })
})
