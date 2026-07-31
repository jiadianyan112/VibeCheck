import { reusableAssets } from './assets'
import { creators } from './creators'
import { projects } from './projects'

describe('stable project and creator fixtures', () => {
  it('contains the minimum stable dataset with unique ids', () => {
    expect(projects).toHaveLength(12)
    expect(creators).toHaveLength(6)
    expect(new Set(projects.map(({ id }) => id)).size).toBe(projects.length)
    expect(new Set(creators.map(({ id }) => id)).size).toBe(creators.length)
  })

  it('covers all eight initial learning scenarios', () => {
    const scenarios = new Set(
      projects.flatMap((project) =>
        project.useScenarios.state === 'known' ? project.useScenarios.value : [],
      ),
    )
    expect(scenarios).toEqual(
      new Set([
        'question_generation',
        'daily_practice',
        'mock_exam',
        'vocabulary_memory',
        'speaking_mock_exam',
        'dictation_training',
        'mistake_review',
        'knowledge_reinforcement',
      ]),
    )
  })

  it('provides three comparable PDF projects and three speaking projects', () => {
    const pdfProjects = projects.filter(
      (project) =>
        project.mainInputs.state === 'known' &&
        project.mainInputs.value.includes('pdf'),
    )
    const speakingProjects = projects.filter(
      (project) =>
        project.useScenarios.state === 'known' &&
        project.useScenarios.value.includes('speaking_mock_exam'),
    )
    expect(pdfProjects.length).toBeGreaterThanOrEqual(3)
    expect(speakingProjects.length).toBeGreaterThanOrEqual(3)
  })

  it('covers required access and author-link states', () => {
    const accessStates = new Set(
      projects.flatMap((project) =>
        project.accessStatus.state === 'known' ? [project.accessStatus.value] : [],
      ),
    )
    expect(accessStates).toEqual(
      expect.objectContaining(
        new Set([
          'normal',
          'login_required',
          'partial_abnormal',
          'link_unavailable',
          'suspected_migration',
          'paused',
          'ended',
          'unknown',
        ]),
      ),
    )
    expect(projects.filter(({ authorLinkStatus }) => authorLinkStatus === 'unlinked').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps reusable value for an ended project', () => {
    const endedProject = projects.find(
      (project) =>
        project.accessStatus.state === 'known' && project.accessStatus.value === 'ended',
    )
    expect(endedProject).toBeDefined()
    expect(
      reusableAssets.some(
        (asset) =>
          asset.projectId === endedProject?.id &&
          asset.availabilityStatus === 'available',
      ),
    ).toBe(true)
  })
})
