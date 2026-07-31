import { projectById } from '../../mocks'
import type { ServiceScenarioId } from '../../services'
import type { ProjectId } from '../../types'

const recordSourceLabels = {
  platform_editor: '平台编辑收录',
  public_discovery: '公开页面发现',
  author_submission: '作者主动发布',
  user_submission: '社区用户提交',
} as const

const authorLinkLabels = {
  unlinked: '尚未关联作者',
  pending: '作者关联审核中',
  linked: '已关联验证作者',
  failed: '作者关联未通过',
  disputed: '作者归属存在争议',
} as const

export interface DuplicateProjectSummary {
  id: ProjectId
  name: string
  publicUrl: string
  authorLinkLabel: string
  sourceLabel: string
}

export function getDuplicateProjectSummary(id: ProjectId): DuplicateProjectSummary | null {
  const project = projectById.get(id)
  if (!project) return null
  return {
    id: project.id,
    name: project.currentName.state === 'known' ? project.currentName.value : '名称未知的已有作品',
    publicUrl: project.publicUrl.state === 'known' ? project.publicUrl.value : '公开地址未知',
    authorLinkLabel: authorLinkLabels[project.authorLinkStatus],
    sourceLabel: recordSourceLabels[project.recordSource],
  }
}

function contextParams(url: string, scenario: ServiceScenarioId) {
  return new URLSearchParams({
    from: 'submit',
    submissionUrl: url,
    submissionScenario: scenario,
  })
}

export function duplicateDetailPath(id: ProjectId, url: string, scenario: ServiceScenarioId) {
  return `/project/${id}?${contextParams(url, scenario)}`
}

export function duplicateVerificationPath(id: ProjectId, url: string, scenario: ServiceScenarioId) {
  return `/project/${id}/verify-author?${contextParams(url, scenario)}`
}

export function submissionReturnPath(url: string, scenario: ServiceScenarioId) {
  return `/submit?${new URLSearchParams({ resumeUrl: url, scenario }).toString()}`
}
