import type { Creator, LifecycleEvent, Project, ProjectRelation, ReusableAsset } from '../../types'

const reusedRelationTypes = new Set<ProjectRelation['type']>(['uses_asset', 'inspired_by', 'fork', 'remix', 'derivative'])

export function buildCreatorProfile(
  creator: Creator,
  projects: readonly Project[],
  events: readonly LifecycleEvent[],
  assets: readonly ReusableAsset[],
  relations: readonly ProjectRelation[],
) {
  const declaredIds = new Set([...creator.publishedProjectIds, ...creator.linkedProjectIds])
  const belongsToCreator = (project: Project) => declaredIds.has(project.id) && project.creatorIds.includes(creator.id)
  const verifiedProjects = projects.filter((project) => belongsToCreator(project) && project.authorLinkStatus === 'linked')
  const pendingProjects = projects.filter((project) => belongsToCreator(project) && project.authorLinkStatus === 'pending')
  const verifiedIds = new Set(verifiedProjects.map((project) => project.id))
  const recentEvents = events
    .filter((event) => verifiedIds.has(event.projectId))
    .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))
  const openAssets = assets.filter((asset) => verifiedIds.has(asset.projectId) && asset.availabilityStatus !== 'removed')
  const reusedByRelations = relations.filter((relation) =>
    reusedRelationTypes.has(relation.type) && verifiedIds.has(relation.targetProjectId),
  )
  return { verifiedProjects, pendingProjects, recentEvents, openAssets, reusedByRelations }
}

export const relationConfirmationLabels: Record<ProjectRelation['confirmationStatus'], string> = {
  pending: '关系待确认',
  one_party_confirmed: '单方已确认，待另一方确认',
  both_parties_confirmed: '双方已确认',
  platform_confirmed: '平台已确认',
  disputed: '关系存在争议',
}
