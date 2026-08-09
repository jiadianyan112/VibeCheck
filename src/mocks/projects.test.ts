import { reusableAssets } from './assets'
import { creators } from './creators'
import { projects } from './projects'

describe('stable project and creator fixtures', () => {
  it('contains the minimum stable dataset with unique ids', () => {
    expect(projects).toHaveLength(28)
    expect(creators).toHaveLength(14)
    expect(new Set(projects.map(({ id }) => id)).size).toBe(projects.length)
    expect(new Set(creators.map(({ id }) => id)).size).toBe(creators.length)
  })

  it('adds 16 portfolio fixtures without changing the 12 learning fixtures', () => {
    const learning = projects.filter((project) => project.categoryId === 'ai_learning_quiz')
    const portfolios = projects.filter((project) => project.categoryId === 'personal_site_portfolio')
    expect(learning).toHaveLength(12)
    expect(portfolios).toHaveLength(16)
    expect(new Set(portfolios.map((project) => project.categoryGroup)).size).toBe(8)
    for (const group of new Set(portfolios.map((project) => project.categoryGroup))) expect(portfolios.filter((project) => project.categoryGroup === group)).toHaveLength(2)
    expect(portfolios.every((project) => project.categorySchemaVersion === 'portfolio.v1' && project.categoryData)).toBe(true)
    expect(portfolios.every((project) => project.accessStatus.state !== 'known' || project.accessStatus.value !== 'login_required')).toBe(true)
    expect(portfolios.filter((project) => project.repositoryUrl.state === 'known' && project.repositoryUrl.value).length).toBeGreaterThanOrEqual(6)
    expect(portfolios.filter((project) => project.assetIds.length > 0).length).toBeGreaterThanOrEqual(8)
    const tools = portfolios.flatMap((project) => project.aiCodingTools.state === 'known' ? project.aiCodingTools.value : [])
    expect(Math.max(...[...new Set(tools)].map((tool) => tools.filter((value) => value === tool).length))).toBeLessThanOrEqual(6)
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
