import { createLoginAction } from '../auth/session'
import { projects, prototypeUsers } from '../../mocks'
import { appReducer, createInitialAppState } from '../../state'
import { buildPersonalCenterData } from './dashboard'

describe('personal center selector', () => {
  it('derives the registered user history from shared state without copying fixtures', () => {
    const user = prototypeUsers[0]!
    const state = appReducer(createInitialAppState(), createLoginAction(user))
    const data = buildPersonalCenterData(state, user, projects)
    expect(data.favoriteProjects).toHaveLength(state.favoriteProjectIds.length)
    expect(data.followedProjects).toHaveLength(state.followedProjectIds.length)
    expect(data.comparisonSessions).toHaveLength(1)
    expect(data.decisions).toHaveLength(1)
    expect(data.drafts).toHaveLength(1)
    expect(data.verificationRequests).toHaveLength(1)
  })

  it('derives author-owned projects only from linked creator relationships', () => {
    const author = prototypeUsers[1]!
    const state = appReducer(createInitialAppState(), createLoginAction(author))
    const data = buildPersonalCenterData(state, author, projects)
    expect(data.myProjects.map((project) => project.id)).toEqual(['project-speakmirror', 'project-lexideck'])
  })
})
