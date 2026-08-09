import { projectId, userId } from '../../types'
import type { UrlCheckResult } from '../../services'
import { canContinueAfterUrlCheck, createUrlCheckDraft } from './urlCheck'

const passingResult: UrlCheckResult = {
  normalizedUrl: 'https://example.test/tool',
  duplicateProjectId: null,
  canCreateDraft: true,
  checks: [
    { key: 'format', status: 'passed', message: 'ok' },
    { key: 'safety', status: 'passed', message: 'ok' },
    { key: 'access', status: 'passed', message: 'ok' },
    { key: 'duplicate', status: 'passed', message: 'ok' },
    { key: 'category', status: 'passed', message: 'ok' },
  ],
}

describe('submission URL check draft', () => {
  it('creates a stable, private-owner draft for the same checked URL', () => {
    const first = createUrlCheckDraft(passingResult, userId('user-mia'))
    const second = createUrlCheckDraft(passingResult, userId('user-mia'))
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      userId: userId('user-mia'),
      step: 'url',
      status: 'draft',
      fields: { publicUrl: passingResult.normalizedUrl },
      duplicateProjectId: null,
    })
    expect(canContinueAfterUrlCheck(passingResult)).toBe(true)
  })

  it('marks an access-timeout draft as requiring a retry', () => {
    const timeoutResult: UrlCheckResult = {
      ...passingResult,
      checks: passingResult.checks.map((check) =>
        check.key === 'access'
          ? { ...check, status: 'warning', message: 'timeout' }
          : check,
      ),
      duplicateProjectId: projectId('project-existing'),
    }
    const draft = createUrlCheckDraft(timeoutResult, userId('user-mia'))
    expect(draft.validationErrors.publicUrl).toContain('超时')
    expect(canContinueAfterUrlCheck(timeoutResult)).toBe(false)
  })

  it('keeps category choice in a distinct portfolio draft', () => {
    const learning = createUrlCheckDraft(passingResult, userId('user-mia'))
    const portfolio = createUrlCheckDraft(passingResult, userId('user-mia'), undefined, 'personal_site_portfolio')
    expect(portfolio.id).not.toBe(learning.id)
    expect(portfolio.fields.categoryId).toBe('personal_site_portfolio')
    expect(portfolio.originalExtraction.categoryId).toBe('personal_site_portfolio')
  })
})
