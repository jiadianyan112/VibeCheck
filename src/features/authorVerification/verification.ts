import {
  verificationRequestId,
  type AuthorVerificationRequest,
  type AuthorVerificationStatus,
  type ProjectId,
  type UserId,
  type VerificationMethod,
} from '../../types'

export const verificationMethodLabels: Record<VerificationMethod, string> = {
  domain_control: '域名控制',
  repository: '代码仓库',
  original_account: '原发布账号',
  public_profile: '公开主页',
  manual_material: '其他材料',
}

export const verificationStatusLabels: Record<AuthorVerificationStatus, string> = {
  draft: '草稿',
  pending: '待人工审核',
  changes_requested: '需补充材料',
  verified: '验证成功',
  failed: '验证失败',
  disputed: '归属争议',
  withdrawn: '已撤回',
}

export function stableVerificationRequestId(project: ProjectId, user: UserId) {
  return verificationRequestId(`verification-${user}-${project}`)
}

export function createVerificationRequest({
  projectId,
  userId,
  method,
  materialSummary,
  privateMaterialReference,
  now = '2026-07-31T11:00:00+08:00',
}: {
  projectId: ProjectId
  userId: UserId
  method: VerificationMethod
  materialSummary: string
  privateMaterialReference: string
  now?: string
}): AuthorVerificationRequest {
  return {
    id: stableVerificationRequestId(projectId, userId),
    projectId,
    userId,
    method,
    status: 'draft',
    materialSummary: materialSummary.trim(),
    privateMaterialReference: privateMaterialReference.trim(),
    reviewMessage: null,
    statusHistory: [{ status: 'draft', happenedAt: now, message: null }],
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    resolvedAt: null,
  }
}

const defaultReviewMessages: Partial<Record<AuthorVerificationStatus, string>> = {
  changes_requested: '请补充材料与目标作品之间的公开关联，原材料已保留。',
  verified: '身份材料已通过人工审核，已开放该作品的作者管理权限。',
  failed: '当前材料不足以证明对该作品的管理归属。',
  disputed: '检测到相互冲突的归属主张，高风险编辑已冻结，等待人工处理。',
}

export function applyVerificationReview(
  request: AuthorVerificationRequest,
  status: Extract<AuthorVerificationStatus, 'pending' | 'changes_requested' | 'verified' | 'failed' | 'disputed'>,
  now = '2026-07-31T11:10:00+08:00',
): AuthorVerificationRequest {
  const message = defaultReviewMessages[status] ?? null
  const previous = request.statusHistory.at(-1)
  const statusHistory = previous?.status === status
    ? request.statusHistory
    : [...request.statusHistory, { status, happenedAt: now, message }]
  return {
    ...request,
    status,
    reviewMessage: message,
    statusHistory,
    submittedAt: request.submittedAt ?? now,
    resolvedAt: status === 'verified' || status === 'failed' ? now : null,
    updatedAt: now,
  }
}

export function latestVerificationFor(
  requests: AuthorVerificationRequest[],
  projectId: ProjectId,
  userId: UserId | undefined,
) {
  if (!userId) return null
  return requests
    .filter((request) => request.projectId === projectId && request.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
}

export function authorManagementState(request: AuthorVerificationRequest | null) {
  return {
    linked: request?.status === 'verified',
    canEdit: request?.status === 'verified',
    highRiskEditingFrozen: request?.status === 'disputed',
  }
}
