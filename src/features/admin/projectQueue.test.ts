import { projects } from '../../mocks'
import { projectId } from '../../types'
import {
  buildAdminProjectQueue,
  emptyAdminProjectFilters,
  filterAdminProjectQueue,
  mergeAdminProjects,
  summarizeAdminProjectQueue,
} from './projectQueue'

describe('admin project queue', () => {
  const rows = buildAdminProjectQueue(projects)

  it('derives reproducible work signals from the public project records', () => {
    const summary = summarizeAdminProjectQueue(rows)
    expect(summary.total).toBe(projects.length)
    expect(summary.pendingReview).toBe(1)
    expect(summary.activeExceptions).toBeGreaterThanOrEqual(3)
    expect(rows.find(({ project }) => project.id === projectId('project-dictaflow'))).toMatchObject({ isPendingReview: true, hasActiveException: true })
  })

  it('combines filters without mutating the shared dataset', () => {
    const result = filterAdminProjectQueue(rows, {
      ...emptyAdminProjectFilters,
      category: 'speaking_mock_exam',
      accessStatus: 'ended',
      authorLinkStatus: 'linked',
    })
    expect(result.map(({ name }) => name)).toEqual(['EchoScore'])
    expect(projects).toHaveLength(rows.length)
  })

  it('lets state overrides replace a base record while preserving stable ids', () => {
    const original = projects[0]!
    const override = { ...original, completenessLevel: 'limited' as const }
    const merged = mergeAdminProjects(projects, [override])
    expect(merged).toHaveLength(projects.length)
    expect(merged.find(({ id }) => id === original.id)).toBe(override)
  })
})
