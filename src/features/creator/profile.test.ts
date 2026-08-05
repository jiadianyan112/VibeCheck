import { creators, lifecycleEvents, projectRelations, projects, reusableAssets } from '../../mocks'
import { creatorId, projectId } from '../../types'
import { buildCreatorProfile, relationConfirmationLabels } from './profile'

describe('creator profile aggregation', () => {
  it('includes only mutually linked works and their public activity and assets', () => {
    const creator = creators.find(({ id }) => id === creatorId('creator-zhou'))!
    const profile = buildCreatorProfile(creator, projects, lifecycleEvents, reusableAssets, projectRelations)
    expect(profile.verifiedProjects.map(({ id }) => id)).toEqual([
      projectId('project-speakmirror'),
      projectId('project-lexideck'),
    ])
    expect(profile.recentEvents.every((event) => profile.verifiedProjects.some((project) => project.id === event.projectId))).toBe(true)
    expect(profile.openAssets).toHaveLength(2)
  })

  it('never assigns an unlinked platform record from a creator claim alone', () => {
    const lab = creators.find(({ id }) => id === creatorId('creator-lab'))!
    const claimed = { ...lab, linkedProjectIds: [projectId('project-pdfquizlab')] }
    const profile = buildCreatorProfile(claimed, projects, lifecycleEvents, reusableAssets, projectRelations)
    expect(profile.verifiedProjects).toEqual([])
    expect(profile.pendingProjects).toEqual([])
  })

  it('shows reuse confirmation as a state instead of a settled claim', () => {
    const creator = creators.find(({ id }) => id === creatorId('creator-qiao'))!
    const profile = buildCreatorProfile(creator, projects, lifecycleEvents, reusableAssets, projectRelations)
    expect(profile.reusedByRelations).toHaveLength(1)
    expect(relationConfirmationLabels[profile.reusedByRelations[0]!.confirmationStatus]).toBe('单方已确认，待另一方确认')
  })
})
