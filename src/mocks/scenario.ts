import { serviceScenarioIds, type ServiceScenarioId } from '../services/runtime'

export const prototypeScenarioIds = [
  'default',
  'search_insufficient',
  'platform_included',
  'field_unknown',
  'link_anomaly',
  'comparison_insufficient',
  'publication_duplicate',
  'extraction_partial',
  'identity_pending',
  'login_return',
  'service_error',
  'external_link_risk',
] as const

export type PrototypeScenarioId = (typeof prototypeScenarioIds)[number]
export type PrototypeScenarioGroup = '发现' | '可信状态' | '比较' | '发布' | '身份与登录' | '服务异常'

export interface PrototypeScenario {
  id: PrototypeScenarioId
  label: string
  description: string
  group: PrototypeScenarioGroup
  path: string
  requiresUser?: boolean
}

export const scenarioExtractionDraftId = 'draft-scenario-extraction-partial'

export const prototypeScenarios: PrototypeScenario[] = [
  { id: 'search_insufficient', label: '搜索结果不足', description: 'PDF 搜索只返回两个固定结果。', group: '发现', path: '/search?q=PDF&prototypeScenario=search_insufficient' },
  { id: 'platform_included', label: '平台收录', description: '平台收录但尚未关联作者。', group: '可信状态', path: '/project/project-pdfquizlab?prototypeScenario=platform_included' },
  { id: 'field_unknown', label: '字段未知', description: '未知与过期字段保留原因。', group: '可信状态', path: '/project/project-learntrack?prototypeScenario=field_unknown' },
  { id: 'link_anomaly', label: '链接异常', description: '链接不可用但不推断作品结束。', group: '可信状态', path: '/project/project-dailydrill?prototypeScenario=link_anomaly' },
  { id: 'comparison_insufficient', label: '比较数量不足', description: '只有一个作品，正式比较不可继续。', group: '比较', path: '/compare/comparison-anonymous-pdf?prototypeScenario=comparison_insufficient' },
  { id: 'publication_duplicate', label: '发布重复', description: '发现已有档案，默认不新建作品。', group: '发布', path: '/submit?prototypeScenario=publication_duplicate&resumeUrl=https%3A%2F%2Fexample.test%2Fscenario-duplicate&autoCheck=1', requiresUser: true },
  { id: 'extraction_partial', label: '自动提取失败', description: '部分字段未提取，原始值和手填入口保留。', group: '发布', path: `/submit/new?draft=${scenarioExtractionDraftId}&step=prefill&prototypeScenario=extraction_partial`, requiresUser: true },
  { id: 'identity_pending', label: '身份审核中', description: '人工审核进行中，不展示虚构倒计时。', group: '身份与登录', path: '/project/project-pdfquizlab/verify-author?prototypeScenario=identity_pending', requiresUser: true },
  { id: 'login_return', label: '登录回跳', description: '登录后返回带筛选的原页面。', group: '身份与登录', path: '/auth?return_to=%2Fsearch%3Fq%3DPDF%26status%3Dnormal&prototypeScenario=login_return' },
  { id: 'service_error', label: '服务错误', description: '稳定错误码与原位重试入口。', group: '服务异常', path: '/search?q=PDF&prototypeScenario=service_error' },
  { id: 'external_link_risk', label: '外链风险', description: '安全检查阻止继续且不创建草稿。', group: '服务异常', path: '/submit?prototypeScenario=external_link_risk&resumeUrl=https%3A%2F%2Funsafe.example%2Fscenario&autoCheck=1', requiresUser: true },
]

export const defaultScenario: PrototypeScenario = {
  id: 'default',
  label: '默认场景',
  description: '清除场景数据并返回作品广场。',
  group: '发现',
  path: '/projects',
}

const scenarioServiceMap: Partial<Record<PrototypeScenarioId, ServiceScenarioId>> = {
  search_insufficient: 'sparse_results',
  publication_duplicate: 'duplicate_project',
  extraction_partial: 'extraction_partial',
  service_error: 'service_error',
  external_link_risk: 'external_link_risk',
}

export function prototypeScenarioFromParams(params: URLSearchParams) {
  const value = params.get('prototypeScenario')
  return prototypeScenarioIds.find((scenario) => scenario === value) ?? 'default'
}

export function resolveServiceScenario(params: URLSearchParams, fallback: ServiceScenarioId): ServiceScenarioId {
  const prototypeScenario = prototypeScenarioFromParams(params)
  const mapped = scenarioServiceMap[prototypeScenario]
  if (mapped) return mapped
  const legacy = params.get('scenario') as ServiceScenarioId | null
  return legacy && serviceScenarioIds.includes(legacy) ? legacy : fallback
}
