import type {
  AccessStatus,
  AuthorLinkStatus,
  CompletenessLevel,
  Project,
  ReviewStatus,
  UseScenario,
} from '../../types'

export interface AdminProjectFilters {
  query: string
  category: UseScenario | ''
  reviewStatus: ReviewStatus | ''
  accessStatus: AccessStatus | ''
  completeness: CompletenessLevel | ''
  authorLinkStatus: AuthorLinkStatus | ''
  pendingOnly: boolean
  exceptionOnly: boolean
}

export interface AdminProjectQueueRow {
  project: Project
  name: string
  definition: string
  categoryIds: UseScenario[]
  accessStatus: AccessStatus | null
  isPendingReview: boolean
  hasActiveException: boolean
}

export const emptyAdminProjectFilters: AdminProjectFilters = {
  query: '',
  category: '',
  reviewStatus: '',
  accessStatus: '',
  completeness: '',
  authorLinkStatus: '',
  pendingOnly: false,
  exceptionOnly: false,
}

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  draft: '草稿',
  pending_review: '待发布审核',
  changes_requested: '需修改',
  approved: '审核通过',
  rejected: '已拒绝',
  withdrawn: '已撤回',
  published_platform: '平台收录已发布',
  published_author: '作者发布',
  update_pending: '更新待审核',
  restricted: '限制展示',
  archived: '已归档',
  deleted: '已删除',
}

export const authorLinkStatusLabels: Record<AuthorLinkStatus, string> = {
  unlinked: '未关联作者',
  pending: '作者关联待审核',
  linked: '已关联作者',
  failed: '关联失败',
  disputed: '归属争议',
}

const pendingReviewStatuses = new Set<ReviewStatus>([
  'pending_review',
  'update_pending',
])

const activeExceptionStatuses = new Set<AccessStatus>([
  'pending_recheck',
  'partial_abnormal',
  'link_unavailable',
  'suspected_migration',
])

function knownValue<T>(fact: Project[keyof Project], fallback: T): T {
  if (typeof fact === 'object' && fact && 'state' in fact && fact.state === 'known') {
    return fact.value as T
  }
  return fallback
}

export function mergeAdminProjects(
  baseProjects: readonly Project[],
  overrides: readonly Project[],
) {
  const overrideMap = new Map(overrides.map((project) => [project.id, project]))
  const baseIds = new Set(baseProjects.map((project) => project.id))
  return [
    ...baseProjects.map((project) => overrideMap.get(project.id) ?? project),
    ...overrides.filter((project) => !baseIds.has(project.id)),
  ]
}

export function buildAdminProjectQueue(projects: readonly Project[]) {
  return projects.map<AdminProjectQueueRow>((project) => {
    const accessStatus = knownValue<AccessStatus | null>(project.accessStatus, null)
    return {
      project,
      name: knownValue(project.currentName, '名称未知'),
      definition: knownValue(project.oneLineDefinition, '定义未知'),
      categoryIds: knownValue<UseScenario[]>(project.useScenarios, []),
      accessStatus,
      isPendingReview: pendingReviewStatuses.has(project.reviewStatus),
      hasActiveException: accessStatus ? activeExceptionStatuses.has(accessStatus) : false,
    }
  })
}

export function filterAdminProjectQueue(
  rows: readonly AdminProjectQueueRow[],
  filters: AdminProjectFilters,
) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase('zh-CN')
  return rows.filter((row) => {
    if (normalizedQuery) {
      const searchable = [row.name, row.definition, row.project.id, knownValue(row.project.publicUrl, '')]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
      if (!searchable.includes(normalizedQuery)) return false
    }
    if (filters.category && !row.categoryIds.includes(filters.category)) return false
    if (filters.reviewStatus && row.project.reviewStatus !== filters.reviewStatus) return false
    if (filters.accessStatus && row.accessStatus !== filters.accessStatus) return false
    if (filters.completeness && row.project.completenessLevel !== filters.completeness) return false
    if (filters.authorLinkStatus && row.project.authorLinkStatus !== filters.authorLinkStatus) return false
    if (filters.pendingOnly && !row.isPendingReview) return false
    if (filters.exceptionOnly && !row.hasActiveException) return false
    return true
  })
}

export function summarizeAdminProjectQueue(rows: readonly AdminProjectQueueRow[]) {
  return {
    total: rows.length,
    pendingReview: rows.filter((row) => row.isPendingReview).length,
    activeExceptions: rows.filter((row) => row.hasActiveException).length,
    authorAttention: rows.filter((row) => ['pending', 'disputed'].includes(row.project.authorLinkStatus)).length,
    incomplete: rows.filter((row) => row.project.completenessLevel !== 'complete').length,
  }
}
