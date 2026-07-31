import { projects } from '../mocks'
import type {
  AccessStatus,
  AssetType,
  InputType,
  Project,
  TargetUser,
  UseScenario,
} from '../types'
import { runService, type ServiceOptions } from './runtime'

export interface SearchFilters {
  targetUsers?: TargetUser[]
  scenarios?: UseScenario[]
  inputs?: InputType[]
  statuses?: AccessStatus[]
  assetTypes?: AssetType[]
}

export interface SearchHit {
  project: Project
  score: number
  matchedFields: string[]
}

export interface SearchResponse {
  query: string
  hits: SearchHit[]
  exactCount: number
  isExpanded: boolean
}

function knownValues<T>(fact: { state: 'known'; value: T } | { state: 'unknown' }) {
  return fact.state === 'known' ? fact.value : null
}

function scoreProject(project: Project, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return { score: 1, matchedFields: ['全部作品'] }

  const fields: Array<[string, string]> = [
    ['作品名称', knownValues(project.currentName) ?? ''],
    ['一句话定义', knownValues(project.oneLineDefinition) ?? ''],
    ['核心问题', knownValues(project.coreProblem) ?? ''],
    ['使用场景', (knownValues(project.useScenarios) ?? []).join(' ')],
    ['材料输入', (knownValues(project.mainInputs) ?? []).join(' ')],
    ['练习形式', (knownValues(project.practiceFormats) ?? []).join(' ')],
  ]
  const aliases: Record<string, string> = {
    pdf: 'pdf',
    口语: 'speaking spoken audio',
    背词: 'vocabulary flashcard',
    听写: 'dictation',
    错题: 'mistake',
    模考: 'mock exam',
    出题: 'question generation',
  }
  const expanded = `${normalized} ${Object.entries(aliases)
    .filter(([key]) => normalized.includes(key))
    .map(([, value]) => value)
    .join(' ')}`
  const tokens = expanded.split(/\s+/).filter(Boolean)
  const matchedFields = fields
    .filter(([, value]) => tokens.some((token) => value.toLocaleLowerCase().includes(token)))
    .map(([label]) => label)
  return { score: matchedFields.length, matchedFields }
}

function matchesFilters(project: Project, filters: SearchFilters) {
  const overlaps = <T>(values: T[] | null, selected?: T[]) =>
    !selected?.length || Boolean(values?.some((value) => selected.includes(value)))
  return (
    overlaps(knownValues(project.targetUsers), filters.targetUsers) &&
    overlaps(knownValues(project.useScenarios), filters.scenarios) &&
    overlaps(knownValues(project.mainInputs), filters.inputs) &&
    overlaps(
      project.accessStatus.state === 'known' ? [project.accessStatus.value] : [],
      filters.statuses,
    )
  )
}

export const searchService = {
  search(query: string, filters: SearchFilters = {}, options?: ServiceOptions) {
    return runService(options, () => {
      if (options?.scenario === 'empty_results') {
        return { query, hits: [], exactCount: 0, isExpanded: false }
      }
      const hits = projects
        .filter((project) => matchesFilters(project, filters))
        .map((project) => ({ project, ...scoreProject(project, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.project.id.localeCompare(b.project.id))
      const limited = options?.scenario === 'sparse_results' ? hits.slice(0, 2) : hits
      return {
        query,
        hits: limited,
        exactCount: limited.length,
        isExpanded: false,
      }
    })
  },
}
