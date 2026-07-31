import { comparisonSessionId, type ComparisonIntent, type ComparisonSession, type ComparisonSessionId, type ProjectId, type UserId } from '../../types'

export function normalizeComparisonIds(ids: readonly ProjectId[]) {
  return [...new Set(ids)].slice(0, 5)
}

export function createComparisonSession({ id, projectIds, sourcePath, ownerUserId = null, intent = null, now = new Date().toISOString() }: { id?: ComparisonSessionId; projectIds: readonly ProjectId[]; sourcePath: string; ownerUserId?: UserId | null; intent?: ComparisonIntent | null; now?: string }): ComparisonSession {
  return { id: id ?? comparisonSessionId(`comparison-local-${Date.now()}`), ownerUserId, intent, projectIds: normalizeComparisonIds(projectIds), sourcePath, decisionId: null, createdAt: now, updatedAt: now, savedAt: null }
}

export function updateComparisonProjects(session: ComparisonSession, projectIds: readonly ProjectId[], now = new Date().toISOString()): ComparisonSession {
  return { ...session, projectIds: normalizeComparisonIds(projectIds), updatedAt: now }
}

export function addComparisonProject(session: ComparisonSession, projectId: ProjectId, now?: string) {
  if (session.projectIds.includes(projectId) || session.projectIds.length >= 5) return session
  return updateComparisonProjects(session, [...session.projectIds, projectId], now)
}

export function removeComparisonProject(session: ComparisonSession, projectId: ProjectId, now?: string) {
  return updateComparisonProjects(session, session.projectIds.filter((id) => id !== projectId), now)
}

export function replaceComparisonProject(session: ComparisonSession, removeId: ProjectId, addId: ProjectId, now?: string) {
  if (session.projectIds.includes(addId)) return session
  return updateComparisonProjects(session, session.projectIds.map((id) => id === removeId ? addId : id), now)
}

export function reorderComparisonProject(session: ComparisonSession, projectId: ProjectId, direction: -1 | 1, now?: string) {
  const from = session.projectIds.indexOf(projectId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= session.projectIds.length) return session
  const projectIds = [...session.projectIds]
  ;[projectIds[from], projectIds[to]] = [projectIds[to]!, projectIds[from]!]
  return updateComparisonProjects(session, projectIds, now)
}

export function saveComparisonSession(session: ComparisonSession, ownerUserId: UserId | null, now = new Date().toISOString()): ComparisonSession {
  return { ...session, ownerUserId, savedAt: now, updatedAt: now }
}

export function mergeComparisonProjects(session: ComparisonSession, projectIds: readonly ProjectId[], ownerUserId: UserId, now?: string) {
  return { ...updateComparisonProjects(session, [...session.projectIds, ...projectIds], now), ownerUserId }
}
