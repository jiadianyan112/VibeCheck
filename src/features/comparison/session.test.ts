import { comparisonSessionId, projectId, userId } from '../../types'
import { addComparisonProject, createComparisonSession, mergeComparisonProjects, removeComparisonProject, reorderComparisonProject, replaceComparisonProject, saveComparisonSession } from './session'

const ids = ['one', 'two', 'three', 'four', 'five', 'six'].map((value) => projectId(`project-${value}`))
const now = '2026-07-31T10:00:00+08:00'

describe('comparison session model', () => {
  it('creates a shareable session with unique capped projects', () => {
    const session = createComparisonSession({
      id: comparisonSessionId('comparison-test'),
      projectIds: [ids[0]!, ids[0]!, ...ids.slice(1)],
      sourcePath: '/discover/result',
      now,
    })
    expect(session.id).toBe(comparisonSessionId('comparison-test'))
    expect(session.projectIds).toEqual(ids.slice(0, 5))
    expect(session.ownerUserId).toBeNull()
  })

  it('uses one duplicate and maximum rule across add, replace and merge', () => {
    let session = createComparisonSession({ projectIds: ids.slice(0, 4), sourcePath: '/projects', now })
    session = addComparisonProject(session, ids[0]!)
    expect(session.projectIds).toHaveLength(4)
    session = addComparisonProject(session, ids[4]!)
    session = addComparisonProject(session, ids[5]!)
    expect(session.projectIds).toEqual(ids.slice(0, 5))
    expect(replaceComparisonProject(session, ids[0]!, ids[1]!).projectIds).toEqual(session.projectIds)
    expect(mergeComparisonProjects(session, [ids[5]!], userId('user-test')).projectIds).toEqual(ids.slice(0, 5))
  })

  it('removes, replaces, reorders and saves without losing session identity', () => {
    const original = createComparisonSession({ id: comparisonSessionId('comparison-actions'), projectIds: ids.slice(0, 3), sourcePath: '/search', now })
    const removed = removeComparisonProject(original, ids[1]!, '2026-07-31T10:01:00+08:00')
    const replaced = replaceComparisonProject(removed, ids[2]!, ids[3]!, '2026-07-31T10:02:00+08:00')
    const reordered = reorderComparisonProject(replaced, ids[3]!, -1, '2026-07-31T10:03:00+08:00')
    const saved = saveComparisonSession(reordered, userId('user-test'), '2026-07-31T10:04:00+08:00')
    expect(saved.id).toBe(original.id)
    expect(saved.projectIds).toEqual([ids[3], ids[0]])
    expect(saved.savedAt).toBe('2026-07-31T10:04:00+08:00')
    expect(saved.ownerUserId).toBe(userId('user-test'))
  })
})
