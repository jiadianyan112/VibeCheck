import {
  creators,
  evidences,
  lifecycleEvents,
  projectRelations,
  projects,
  reusableAssets,
} from '../mocks'
import type {
  Creator,
  Evidence,
  LifecycleEvent,
  Project,
  ProjectId,
  ProjectRelation,
  ReusableAsset,
} from '../types'
import { notFound, runService, type ServiceOptions } from './runtime'
import type { ServiceResult } from './result'
import { mapCatalogCard, mapCatalogProject } from './catalogProjectAdapter'
import type { ProjectCardProjection, ProjectProjection } from '@vibecheck/catalog'

export interface ProjectBundle {
  project: Project
  relatedProjects: Project[]
  creators: Creator[]
  events: LifecycleEvent[]
  assets: ReusableAsset[]
  relations: ProjectRelation[]
  evidences: Evidence[]
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const serverProjectId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function catalogGet<T>(path: string, signal?: AbortSignal): Promise<ServiceResult<T>> {
  try {
    const response = await fetch(`${apiBase}${path}`, { signal, headers: { accept: 'application/json' } })
    if (response.status === 404) return notFound('VC_PROJECT_NOT_FOUND', '未找到对应作品档案。')
    if (!response.ok) return { ok: false, error: { code: 'VC_CATALOG_UNAVAILABLE', kind: 'server', message: '作品目录暂时不可用，请稍后重试。', retryable: true } }
    return { ok: true, data: await response.json() as T }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, error: { code: 'VC_REQUEST_ABORTED', kind: 'aborted', message: '请求已取消。', retryable: false } }
    return { ok: false, error: { code: 'VC_NETWORK_UNAVAILABLE', kind: 'network', message: '无法连接作品目录，请检查网络后重试。', retryable: true } }
  }
}

async function listPublishedProjects(signal?: AbortSignal): Promise<ServiceResult<Project[]>> {
  const items: Project[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: '50' })
    if (cursor) params.set('cursor', cursor)
    const page: ServiceResult<{ items: ProjectCardProjection[]; next_cursor: string | null }> = await catalogGet(`/api/v1/projects?${params}`, signal)
    if (!page.ok) return page
    items.push(...page.data.items.map(mapCatalogCard))
    cursor = page.data.next_cursor
  } while (cursor)
  return { ok: true, data: items }
}

export const projectService = {
  list(options?: ServiceOptions) {
    if (import.meta.env.PROD && (!options?.scenario || options.scenario === 'default')) return listPublishedProjects(options?.signal)
    return runService(options, () => options?.scenario === 'empty_results' ? [] : projects)
  },

  listEvents(options?: ServiceOptions) {
    return runService(options, () => options?.scenario === 'empty_results' ? [] : lifecycleEvents)
  },

  listAssets(options?: ServiceOptions) {
    return runService(options, () => options?.scenario === 'empty_results' ? [] : reusableAssets)
  },

  listEvidence(options?: ServiceOptions) {
    return runService(options, () => options?.scenario === 'empty_results' ? [] : evidences)
  },

  async getById(
    id: ProjectId,
    options?: ServiceOptions,
  ): Promise<ServiceResult<Project>> {
    if (import.meta.env.PROD && serverProjectId.test(id) && (!options?.scenario || options.scenario === 'default')) {
      const response = await catalogGet<ProjectProjection>(`/api/v1/projects/${encodeURIComponent(id)}`, options?.signal)
      return response.ok ? { ok: true, data: mapCatalogProject(response.data) } : response
    }
    const result = await runService(options, () =>
      projects.find((project) => project.id === id),
    )
    if (!result.ok) return result
    if (!result.data) return notFound('VC_PROJECT_NOT_FOUND', '未找到对应作品档案。')
    return { ok: true, data: result.data }
  },

  async getBundle(
    id: ProjectId,
    options?: ServiceOptions,
  ): Promise<ServiceResult<ProjectBundle>> {
    if (import.meta.env.PROD && serverProjectId.test(id) && (!options?.scenario || options.scenario === 'default')) {
      const response = await catalogGet<ProjectProjection>(`/api/v1/projects/${encodeURIComponent(id)}`, options?.signal)
      if (!response.ok) return response
      return { ok: true, data: {
        project: mapCatalogProject(response.data), relatedProjects: [], creators: [], events: [], assets: [], relations: [], evidences: [],
      } }
    }
    const result = await runService(options, () => {
      const project = projects.find((item) => item.id === id)
      if (!project) return null
      const relations = projectRelations.filter(
        (relation) => relation.sourceProjectId === id || relation.targetProjectId === id,
      )
      const relatedIds = new Set(relations.flatMap((relation) => [relation.sourceProjectId, relation.targetProjectId]).filter((projectId) => projectId !== id))
      const evidenceIds = new Set([
        ...project.currentName.evidenceIds,
        ...project.oneLineDefinition.evidenceIds,
        ...lifecycleEvents
          .filter((event) => event.projectId === id)
          .flatMap((event) => event.evidenceIds),
      ])
      return {
        project,
        relatedProjects: projects.filter((item) => relatedIds.has(item.id)),
        creators: creators.filter((creator) => project.creatorIds.includes(creator.id)),
        events: lifecycleEvents.filter((event) => event.projectId === id),
        assets: reusableAssets.filter((asset) => asset.projectId === id),
        relations,
        evidences: evidences.filter((evidence) => evidenceIds.has(evidence.id)),
      }
    })
    if (!result.ok) return result
    if (!result.data) return notFound('VC_PROJECT_NOT_FOUND', '未找到对应作品档案。')
    return { ok: true, data: result.data }
  },
}
