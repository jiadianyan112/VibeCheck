import type { AssetType, ComparisonIntent, Project, ProjectId, ReusableAsset } from '../../types'

function values<T>(fact: { state: 'known'; value: T[] } | { state: 'unknown' }) {
  return fact.state === 'known' ? fact.value : []
}

function dimensionMatches<T>(actual: T[], expected: T[]) {
  return expected.length === 0 || expected.some((value) => actual.includes(value))
}

export function projectMatchesIntent(project: Project, intent: ComparisonIntent) {
  return dimensionMatches(values(project.targetUsers), intent.targetUsers)
    && dimensionMatches(values(project.useScenarios), intent.useScenarios)
    && dimensionMatches(values(project.mainInputs), intent.inputs)
    && dimensionMatches(values(project.practiceFormats), intent.practiceFormats)
    && dimensionMatches(values(project.mainOutputs), intent.outputs)
}

export interface AnalysisDistribution<Key extends string> {
  key: Key
  count: number
  projectIds: ProjectId[]
}

export interface SolutionGroup {
  id: string
  scenario: string
  input: string
  practice: string
  projectIds: ProjectId[]
}

export interface DiscoveryAnalysis {
  exactProjects: Project[]
  solutionGroups: SolutionGroup[]
  statusDistribution: AnalysisDistribution<string>[]
  assetDistribution: AnalysisDistribution<AssetType | 'none'>[]
  representative: { project: Project; reason: string } | null
}

export function buildDiscoveryAnalysis(
  projects: readonly Project[],
  assets: readonly ReusableAsset[],
  intent: ComparisonIntent,
): DiscoveryAnalysis {
  const exactProjects = projects.filter((project) => projectMatchesIntent(project, intent))
  const exactIds = new Set(exactProjects.map(({ id }) => id))
  const assetsByProject = new Map<ProjectId, ReusableAsset[]>()
  assets.filter((asset) => exactIds.has(asset.projectId)).forEach((asset) => {
    assetsByProject.set(asset.projectId, [...(assetsByProject.get(asset.projectId) ?? []), asset])
  })

  const groupMap = new Map<string, SolutionGroup>()
  exactProjects.forEach((project) => {
    const scenario = values(project.useScenarios)[0] ?? 'unknown'
    const input = values(project.mainInputs)[0] ?? 'unknown'
    const practice = values(project.practiceFormats)[0] ?? 'unknown'
    const id = `${scenario}:${input}:${practice}`
    const group = groupMap.get(id) ?? { id, scenario, input, practice, projectIds: [] }
    group.projectIds.push(project.id)
    groupMap.set(id, group)
  })

  const statusMap = new Map<string, ProjectId[]>()
  exactProjects.forEach((project) => {
    const status = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
    statusMap.set(status, [...(statusMap.get(status) ?? []), project.id])
  })

  const assetMap = new Map<AssetType | 'none', ProjectId[]>()
  exactProjects.forEach((project) => {
    const types = [...new Set((assetsByProject.get(project.id) ?? []).map(({ type }) => type))]
    ;(types.length ? types : ['none' as const]).forEach((type) => {
      assetMap.set(type, [...(assetMap.get(type) ?? []), project.id])
    })
  })

  const representative = [...exactProjects].sort((a, b) => {
    const score = (project: Project) => (project.completenessLevel === 'complete' ? 4 : 0)
      + (assetsByProject.get(project.id)?.length ? 2 : 0)
      + (project.freshnessStatus === 'valid' ? 1 : 0)
    return score(b) - score(a) || b.lastVerifiedAt.localeCompare(a.lastVerifiedAt) || a.id.localeCompare(b.id)
  })[0] ?? null

  return {
    exactProjects,
    solutionGroups: [...groupMap.values()].sort((a, b) => b.projectIds.length - a.projectIds.length || a.id.localeCompare(b.id)),
    statusDistribution: [...statusMap].map(([key, projectIds]) => ({ key, count: projectIds.length, projectIds })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    assetDistribution: [...assetMap].map(([key, projectIds]) => ({ key, count: projectIds.length, projectIds })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    representative: representative ? {
      project: representative,
      reason: `资料完整度为${representative.completenessLevel === 'complete' ? '完整' : '非完整'}、公开复用资产 ${assetsByProject.get(representative.id)?.length ?? 0} 项，并优先采用最近核验记录。`,
    } : null,
  }
}
