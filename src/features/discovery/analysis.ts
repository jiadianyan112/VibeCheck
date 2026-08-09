import type { AssetType, ComparisonIntent, FieldFact, Project, ProjectId, ReusableAsset } from '../../types'

function values<T>(fact: { state: 'known'; value: T[] } | { state: 'unknown' }) {
  return fact.state === 'known' ? fact.value : []
}

function dimensionMatches<T>(actual: T[], expected: T[]) {
  return expected.length === 0 || expected.some((value) => actual.includes(value))
}

function scalar<T>(fact: FieldFact<T> | undefined) {
  return fact?.state === 'known' ? [fact.value] : []
}

function projectAssetTypes(project: Project, assets: readonly ReusableAsset[]) {
  return assets.filter((asset) => asset.projectId === project.id).map((asset) => asset.type)
}

export function projectMatchesIntent(project: Project, intent: ComparisonIntent, assets: readonly ReusableAsset[] = []) {
  if (intent.categoryId && project.categoryId !== intent.categoryId) return false
  if (intent.categoryId === 'personal_site_portfolio') {
    const data = project.categoryData
    if (!data) return false
    return dimensionMatches(scalar(data.siteType), intent.siteTypes ?? [])
      && dimensionMatches(values(data.creatorRoles), intent.creatorRoles ?? [])
      && dimensionMatches(values(data.primaryGoals), intent.primaryGoals ?? [])
      && dimensionMatches(scalar(data.pageModel), intent.pageModels ?? [])
      && dimensionMatches(values(data.visualStyles), intent.visualStyles ?? [])
      && dimensionMatches(projectAssetTypes(project, assets), intent.assetTypes ?? [])
  }
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
  relaxedProjects: Array<{ project: Project; matchedDimensions: number; reason: string }>
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
  const exactProjects = projects.filter((project) => projectMatchesIntent(project, intent, assets))
  const relaxedProjects = projects
    .filter((project) => !exactProjects.includes(project) && (!intent.categoryId || project.categoryId === intent.categoryId))
    .map((project) => {
      const data = project.categoryData
      const dimensions = intent.categoryId === 'personal_site_portfolio' && data ? [
        ['网站类型', scalar(data.siteType), intent.siteTypes ?? []],
        ['作者身份', values(data.creatorRoles), intent.creatorRoles ?? []],
        ['建站目的', values(data.primaryGoals), intent.primaryGoals ?? []],
        ['页面结构', scalar(data.pageModel), intent.pageModels ?? []],
        ['视觉方向', values(data.visualStyles), intent.visualStyles ?? []],
        ['复用资产', projectAssetTypes(project, assets), intent.assetTypes ?? []],
      ] as Array<[string, string[], string[]]> : [
        ['目标用户', values(project.targetUsers), intent.targetUsers],
        ['使用场景', values(project.useScenarios), intent.useScenarios],
        ['材料输入', values(project.mainInputs), intent.inputs],
        ['练习形式', values(project.practiceFormats), intent.practiceFormats],
        ['主要输出', values(project.mainOutputs), intent.outputs],
      ] as Array<[string, string[], string[]]>
      const matched = dimensions.filter(([, actual, expected]) => expected.length > 0 && dimensionMatches(actual, expected)).map(([label]) => label)
      return { project, matchedDimensions: matched.length, reason: matched.length ? `命中${matched.join('、')}，但未满足全部意图维度。` : '未命中已确认维度。' }
    })
    .filter(({ matchedDimensions }) => matchedDimensions > 0)
    .sort((a, b) => b.matchedDimensions - a.matchedDimensions || b.project.lastVerifiedAt.localeCompare(a.project.lastVerifiedAt) || a.project.id.localeCompare(b.project.id))
    .slice(0, 4)
  const exactIds = new Set(exactProjects.map(({ id }) => id))
  const assetsByProject = new Map<ProjectId, ReusableAsset[]>()
  assets.filter((asset) => exactIds.has(asset.projectId)).forEach((asset) => {
    assetsByProject.set(asset.projectId, [...(assetsByProject.get(asset.projectId) ?? []), asset])
  })

  const groupMap = new Map<string, SolutionGroup>()
  exactProjects.forEach((project) => {
    const portfolio = project.categoryData
    const scenario = intent.categoryId === 'personal_site_portfolio' && portfolio ? scalar(portfolio.siteType)[0] ?? 'unknown' : values(project.useScenarios)[0] ?? 'unknown'
    const input = intent.categoryId === 'personal_site_portfolio' && portfolio ? values(portfolio.creatorRoles)[0] ?? 'unknown' : values(project.mainInputs)[0] ?? 'unknown'
    const practice = intent.categoryId === 'personal_site_portfolio' && portfolio ? values(portfolio.primaryGoals)[0] ?? 'unknown' : values(project.practiceFormats)[0] ?? 'unknown'
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
    relaxedProjects,
    solutionGroups: [...groupMap.values()].sort((a, b) => b.projectIds.length - a.projectIds.length || a.id.localeCompare(b.id)),
    statusDistribution: [...statusMap].map(([key, projectIds]) => ({ key, count: projectIds.length, projectIds })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    assetDistribution: [...assetMap].map(([key, projectIds]) => ({ key, count: projectIds.length, projectIds })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    representative: representative ? {
      project: representative,
      reason: `资料完整度为${representative.completenessLevel === 'complete' ? '完整' : '非完整'}、公开复用资产 ${assetsByProject.get(representative.id)?.length ?? 0} 项，并优先采用最近核验记录。`,
    } : null,
  }
}
