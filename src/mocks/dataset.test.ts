import { reusableAssets } from './assets'
import { evidences } from './evidence'
import { lifecycleEvents } from './events'
import { projects } from './projects'
import { projectRelations } from './relations'
import {
  anonymousAssets,
  comparisonSessions,
  decisionRecords,
  notifications,
  submissionDrafts,
  userAssets,
  verificationRequests,
} from './userAssets'

describe('lifecycle and user asset fixtures', () => {
  it('resolves every configured project event and relation', () => {
    const eventIds = new Set(lifecycleEvents.map(({ id }) => id))
    const relationIds = new Set(projectRelations.map(({ id }) => id))
    for (const project of projects) {
      expect(project.eventIds.every((id) => eventIds.has(id))).toBe(true)
      expect(project.relationIds.every((id) => relationIds.has(id))).toBe(true)
    }
  })

  it('resolves evidence referenced by events, relations, and assets', () => {
    const evidenceIds = new Set(evidences.map(({ id }) => id))
    const referenced = [
      ...lifecycleEvents.flatMap(({ evidenceIds: ids }) => ids),
      ...projectRelations.flatMap(({ evidenceIds: ids }) => ids),
      ...reusableAssets.flatMap(({ evidenceIds: ids }) => ids),
    ]
    expect(referenced.every((id) => evidenceIds.has(id))).toBe(true)
  })

  it('requires author or evidence support for paused and ended events', () => {
    const terminalEvents = lifecycleEvents.filter(
      ({ type }) => type === 'paused' || type === 'ended',
    )
    expect(terminalEvents).not.toHaveLength(0)
    expect(
      terminalEvents.every(
        ({ sourceType }) =>
          sourceType === 'verified_author_statement' ||
          sourceType === 'trusted_external_source',
      ),
    ).toBe(true)
  })

  it('includes expired, disputed, and unknown examples', () => {
    expect(projects.some(({ freshnessStatus }) => freshnessStatus === 'expired')).toBe(true)
    expect(evidences.some(({ disputeStatus }) => disputeStatus === 'in_review')).toBe(true)
    expect(
      projects.some(({ modelsUsed }) => modelsUsed.state === 'unknown'),
    ).toBe(true)
  })

  it('supports timeline, relationships, community and personal center data', () => {
    expect(lifecycleEvents.length).toBeGreaterThanOrEqual(12)
    expect(projectRelations.length).toBeGreaterThanOrEqual(4)
    expect(comparisonSessions).toHaveLength(2)
    expect(decisionRecords).toHaveLength(1)
    expect(submissionDrafts).toHaveLength(1)
    expect(verificationRequests).toHaveLength(1)
    expect(notifications.length).toBeGreaterThanOrEqual(3)
    expect(userAssets.length).toBeGreaterThanOrEqual(2)
    expect(anonymousAssets.comparisonSessionIds).toHaveLength(1)
  })
})
