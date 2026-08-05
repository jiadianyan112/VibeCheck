import { projectId, userId } from '../../types'
import { verificationService } from '../../services'
import { applyVerificationReview, authorManagementState, createVerificationRequest } from './verification'

function draftRequest() {
  return createVerificationRequest({
    projectId: projectId('project-quizforge'),
    userId: userId('user-mia'),
    method: 'repository',
    materialSummary: '公开仓库 README 指向作品地址。',
    privateMaterialReference: 'private://verification/secret-reference',
  })
}

describe('author verification lifecycle', () => {
  it('keeps one stable request and append-only status history', () => {
    const draft = draftRequest()
    const pending = applyVerificationReview(draft, 'pending')
    const repeated = applyVerificationReview(pending, 'pending', '2026-08-01T10:00:00+08:00')
    const verified = applyVerificationReview(repeated, 'verified', '2026-08-01T11:00:00+08:00')

    expect(verified.id).toBe(draft.id)
    expect(repeated.statusHistory).toHaveLength(2)
    expect(verified.statusHistory.map((item) => item.status)).toEqual(['draft', 'pending', 'verified'])
    expect(authorManagementState(verified)).toEqual({ linked: true, canEdit: true, highRiskEditingFrozen: false })
  })

  it('freezes high-risk editing during a dispute without deleting materials or history', () => {
    const pending = applyVerificationReview(draftRequest(), 'pending')
    const disputed = applyVerificationReview(pending, 'disputed')
    expect(authorManagementState(disputed)).toEqual({ linked: false, canEdit: false, highRiskEditingFrozen: true })
    expect(disputed.privateMaterialReference).toBe('private://verification/secret-reference')
    expect(disputed.statusHistory).toHaveLength(3)
  })

  it('provides fixed pending, changes, success, failure and dispute review scenarios', async () => {
    const request = draftRequest()
    const scenarios = [
      ['default', 'pending'],
      ['review_changes_requested', 'changes_requested'],
      ['review_approved', 'verified'],
      ['review_rejected', 'failed'],
      ['verification_disputed', 'disputed'],
    ] as const
    const results = await Promise.all(scenarios.map(([scenario]) => verificationService.submit(request, { scenario, delayMs: 0 })))
    expect(results.map((result) => result.ok ? result.data.status : 'error')).toEqual(scenarios.map(([, status]) => status))
  })
})
