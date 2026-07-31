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

export interface ProjectBundle {
  project: Project
  relatedProjects: Project[]
  creators: Creator[]
  events: LifecycleEvent[]
  assets: ReusableAsset[]
  relations: ProjectRelation[]
  evidences: Evidence[]
}

export const projectService = {
  list(options?: ServiceOptions) {
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
