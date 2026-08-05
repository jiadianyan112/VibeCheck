import type { AppState } from '../../state'
import type { Project, PrototypeUser } from '../../types'

export function buildPersonalCenterData(state: AppState, user: PrototypeUser, projects: readonly Project[]) {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const resolveProjects = (ids: readonly Project['id'][]) => ids.map((id) => byId.get(id)).filter((project): project is Project => Boolean(project))
  const comparisonSessions = state.comparisonSessions
    .filter((session) => session.ownerUserId === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const decisions = state.decisionRecords
    .filter((decision) => decision.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const drafts = state.submissionDrafts
    .filter((draft) => draft.userId === user.id && draft.status === 'draft')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const reviews = state.submissionDrafts
    .filter((draft) => draft.userId === user.id && draft.status !== 'draft')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const verificationRequests = state.verificationRequests
    .filter((request) => request.userId === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const authoredProjects = user.creatorId
    ? projects.filter((project) => project.creatorIds.includes(user.creatorId!) && project.authorLinkStatus === 'linked')
    : []
  const publishedDraftProjects = resolveProjects(
    reviews.flatMap((draft) => draft.publishedProjectId ? [draft.publishedProjectId] : []),
  )
  const myProjects = [...authoredProjects, ...publishedDraftProjects.filter((project) => !authoredProjects.some(({ id }) => id === project.id))]
  const updateDrafts = state.projectUpdateDrafts.filter((draft) => draft.userId === user.id)
  return {
    favoriteProjects: resolveProjects(state.favoriteProjectIds),
    followedProjects: resolveProjects(state.followedProjectIds),
    recentProjects: resolveProjects(state.recentProjectIds),
    comparisonSessions,
    decisions,
    drafts,
    reviews,
    verificationRequests,
    myProjects,
    updateDrafts,
  }
}
