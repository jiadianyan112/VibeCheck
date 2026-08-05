import { applyVerificationReview } from '../authorVerification/verification'
import { applySubmissionReview, publishedEventFromSubmission, publishedProjectFromSubmission } from '../submission/review'
import {
  lifecycleEventId,
  notificationId,
  type AccessStatus,
  type AdminWorkflowAction,
  type AdminWorkflowLog,
  type AuthorVerificationRequest,
  type AuthorVerificationStatus,
  type AuthorLinkStatus,
  type FieldFact,
  type LifecycleEvent,
  type Notification,
  type Project,
  type ProjectId,
  type PrototypeUser,
  type ReviewStatus,
  type SubmissionDraft,
  type UserRole,
} from '../../types'

export type PublicationDecision = 'approve' | 'return' | 'reject' | 'dispute'
export type IdentityDecision = Extract<AuthorVerificationStatus, 'verified' | 'changes_requested' | 'failed' | 'disputed'>

export interface AdminWorkflowMutation {
  projects?: Project[]
  submissionDraft?: SubmissionDraft
  verificationRequest?: AuthorVerificationRequest
  notifications?: Notification[]
  lifecycleEvents?: LifecycleEvent[]
  alias?: { from: ProjectId; to: ProjectId }
  statusReview?: { projectId: ProjectId; count: number }
  log: AdminWorkflowLog
}

const highRiskActions = new Set<AdminWorkflowAction>([
  'publication_disputed',
  'duplicate_merged',
  'display_restricted',
  'identity_verified',
  'identity_failed',
  'identity_disputed',
  'status_confirmed',
])

function stableHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function requireReason(reason: string) {
  if (!reason.trim()) throw new Error('VC_ADMIN_WORKFLOW_REASON_REQUIRED')
  return reason.trim()
}

export function isAdminWorkflowAllowed(action: AdminWorkflowAction, role: UserRole) {
  if (role !== 'editor' && role !== 'admin') return false
  return role === 'admin' || !highRiskActions.has(action)
}

function requirePermission(action: AdminWorkflowAction, actor: PrototypeUser) {
  if (!isAdminWorkflowAllowed(action, actor.role)) throw new Error('VC_ADMIN_WORKFLOW_FORBIDDEN')
}

function workflowLog({
  action,
  actor,
  targetId,
  projectId,
  beforeValue,
  afterValue,
  reason,
  now,
}: {
  action: AdminWorkflowAction
  actor: PrototypeUser
  targetId: string
  projectId: ProjectId | null
  beforeValue: unknown
  afterValue: unknown
  reason: string
  now: string
}): AdminWorkflowLog {
  const normalizedReason = requireReason(reason)
  const signature = stableHash(JSON.stringify([action, targetId, beforeValue, afterValue, normalizedReason]))
  return {
    id: `workflow-${action}-${signature}`,
    actorUserId: actor.id,
    action,
    targetId,
    projectId,
    beforeValue,
    afterValue,
    reason: normalizedReason,
    createdAt: now,
  }
}

const publicationActions: Record<PublicationDecision, AdminWorkflowAction> = {
  approve: 'publication_approved',
  return: 'publication_returned',
  reject: 'publication_rejected',
  dispute: 'publication_disputed',
}

const publicationStatuses: Record<PublicationDecision, ReviewStatus> = {
  approve: 'approved',
  return: 'changes_requested',
  reject: 'rejected',
  dispute: 'restricted',
}

export function applyPublicationWorkflow(
  draft: SubmissionDraft,
  decision: PublicationDecision,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T20:00:00+08:00',
): AdminWorkflowMutation {
  const action = publicationActions[decision]
  requirePermission(action, actor)
  const normalizedReason = requireReason(reason)
  const status = publicationStatuses[decision]
  const reviewed = decision === 'dispute'
    ? {
        ...draft,
        status,
        step: 'preview' as const,
        submittedFields: draft.submittedFields ?? structuredClone(draft.fields),
        submittedAssetIds: draft.submittedFields ? draft.submittedAssetIds : [...draft.assetIds],
        submittedAt: draft.submittedAt ?? now,
        withdrawnAt: null,
        updatedAt: now,
      }
    : applySubmissionReview(draft, status as Extract<ReviewStatus, 'changes_requested' | 'approved' | 'rejected'>, now)
  const nextDraft = { ...reviewed, reviewMessages: { submission: normalizedReason } }
  const project = publishedProjectFromSubmission(nextDraft)
  const event = publishedEventFromSubmission(nextDraft)
  const notification: Notification = {
    id: notificationId(`notification-${nextDraft.id}-${action}`),
    userId: nextDraft.userId,
    type: 'submission_reviewed',
    title: `作品发布审核：${decision === 'approve' ? '已通过' : decision === 'return' ? '需补充' : decision === 'reject' ? '未通过' : '争议复核中'}`,
    body: normalizedReason,
    targetPath: `/submit/new?draft=${nextDraft.id}`,
    projectId: project?.id ?? nextDraft.publishedProjectId,
    eventId: event?.id ?? null,
    isRead: false,
    createdAt: now,
  }
  return {
    submissionDraft: nextDraft,
    projects: project ? [project] : [],
    lifecycleEvents: event ? [event] : [],
    notifications: [notification],
    log: workflowLog({ action, actor, targetId: nextDraft.id, projectId: project?.id ?? null, beforeValue: draft.status, afterValue: nextDraft.status, reason, now }),
  }
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)]
}

export function mergeDuplicateProjects(
  main: Project,
  duplicate: Project,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T20:10:00+08:00',
): AdminWorkflowMutation {
  requirePermission('duplicate_merged', actor)
  if (main.id === duplicate.id) throw new Error('VC_DUPLICATE_MAIN_REQUIRED')
  const duplicateName = duplicate.currentName.state === 'known' ? duplicate.currentName.value : null
  const duplicateUrl = duplicate.publicUrl.state === 'known' ? duplicate.publicUrl.value : null
  const mergedMain: Project = {
    ...main,
    historicalNames: unique([
      ...main.historicalNames.map((item) => JSON.stringify(item)),
      ...duplicate.historicalNames.map((item) => JSON.stringify(item)),
      ...(duplicateName ? [JSON.stringify({ name: duplicateName, effectiveFrom: duplicate.createdAt.slice(0, 10), effectiveTo: now.slice(0, 10) })] : []),
    ]).map((item) => JSON.parse(item)),
    historicalUrls: unique([
      ...main.historicalUrls.map((item) => JSON.stringify(item)),
      ...duplicate.historicalUrls.map((item) => JSON.stringify(item)),
      ...(duplicateUrl ? [JSON.stringify({ url: duplicateUrl, effectiveFrom: duplicate.createdAt.slice(0, 10), effectiveTo: now.slice(0, 10) })] : []),
    ]).map((item) => JSON.parse(item)),
    versionIds: unique([...main.versionIds, ...duplicate.versionIds]),
    eventIds: unique([...main.eventIds, ...duplicate.eventIds]),
    assetIds: unique([...main.assetIds, ...duplicate.assetIds]),
    relationIds: unique([...main.relationIds, ...duplicate.relationIds]),
    creatorIds: unique([...main.creatorIds, ...duplicate.creatorIds]),
    interactionSummary: duplicate.reviewStatus === 'archived' ? main.interactionSummary : {
      favoriteCount: main.interactionSummary.favoriteCount + duplicate.interactionSummary.favoriteCount,
      likeCount: main.interactionSummary.likeCount + duplicate.interactionSummary.likeCount,
      commentCount: main.interactionSummary.commentCount + duplicate.interactionSummary.commentCount,
      followerCount: main.interactionSummary.followerCount + duplicate.interactionSummary.followerCount,
    },
  }
  const archivedDuplicate = { ...duplicate, reviewStatus: 'archived' as const }
  return {
    projects: [mergedMain, archivedDuplicate],
    alias: { from: duplicate.id, to: main.id },
    log: workflowLog({ action: 'duplicate_merged', actor, targetId: duplicate.id, projectId: main.id, beforeValue: { mainId: main.id, duplicateId: duplicate.id }, afterValue: { stableId: main.id, alias: duplicate.id }, reason, now }),
  }
}

export function restrictProjectDisplay(
  project: Project,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T20:15:00+08:00',
): AdminWorkflowMutation {
  requirePermission('display_restricted', actor)
  const restricted = { ...project, reviewStatus: 'restricted' as const }
  return {
    projects: [restricted],
    log: workflowLog({ action: 'display_restricted', actor, targetId: project.id, projectId: project.id, beforeValue: project.reviewStatus, afterValue: restricted.reviewStatus, reason, now }),
  }
}

const identityActions: Record<IdentityDecision, AdminWorkflowAction> = {
  verified: 'identity_verified',
  changes_requested: 'identity_changes_requested',
  failed: 'identity_failed',
  disputed: 'identity_disputed',
}

export function applyIdentityWorkflow(
  request: AuthorVerificationRequest,
  project: Project,
  decision: IdentityDecision,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T20:20:00+08:00',
): AdminWorkflowMutation {
  const action = identityActions[decision]
  requirePermission(action, actor)
  const normalizedReason = requireReason(reason)
  const reviewed = applyVerificationReview(request, decision, now)
  const verificationRequest = {
    ...reviewed,
    reviewMessage: normalizedReason,
    statusHistory: reviewed.statusHistory.map((item, index, values) => index === values.length - 1 ? { ...item, message: normalizedReason } : item),
  }
  const authorLinkStatus: AuthorLinkStatus = decision === 'verified' ? 'linked' : decision === 'changes_requested' ? 'pending' : decision
  const nextProject = { ...project, authorLinkStatus }
  const notification: Notification = {
    id: notificationId(`notification-${request.id}-${action}`),
    userId: request.userId,
    type: 'verification_reviewed',
    title: `作者身份审核：${decision === 'verified' ? '已通过' : decision === 'changes_requested' ? '需补充' : decision === 'failed' ? '未通过' : '归属争议'}`,
    body: normalizedReason,
    targetPath: `/project/${project.id}/verify-author`,
    projectId: project.id,
    eventId: null,
    isRead: false,
    createdAt: now,
  }
  return {
    verificationRequest,
    projects: [nextProject],
    notifications: [notification],
    log: workflowLog({ action, actor, targetId: request.id, projectId: project.id, beforeValue: request.status, afterValue: decision, reason, now }),
  }
}

function knownAccessStatus(project: Project, value: AccessStatus, now: string): FieldFact<AccessStatus> {
  return {
    state: 'known',
    value,
    evidenceIds: project.accessStatus.evidenceIds,
    freshness: 'valid',
    lastVerifiedAt: now,
    disputeStatus: 'none',
    confidence: 'high',
  }
}

function statusEventType(status: AccessStatus): LifecycleEvent['type'] {
  if (status === 'recovered' || status === 'normal') return 'recovered'
  if (status === 'paused') return 'paused'
  if (status === 'ended') return 'ended'
  if (status === 'suspected_migration') return 'domain_migrated'
  return 'link_abnormal'
}

export function reviewProjectStatus(
  project: Project,
  targetStatus: AccessStatus,
  previousReviewCount: number,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T20:30:00+08:00',
): AdminWorkflowMutation {
  const firstObservation = previousReviewCount < 1
  const action: AdminWorkflowAction = firstObservation ? 'status_recheck_queued' : 'status_confirmed'
  requirePermission(action, actor)
  const beforeStatus = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
  const nextProject: Project = firstObservation
    ? { ...project, reviewStatus: 'update_pending' }
    : { ...project, accessStatus: knownAccessStatus(project, targetStatus, now), lastVerifiedAt: now, reviewStatus: project.authorLinkStatus === 'linked' ? 'published_author' : 'published_platform' }
  const event: LifecycleEvent | null = firstObservation ? null : {
    id: lifecycleEventId(`event-status-review-${project.id}-${previousReviewCount + 1}-${stableHash(reason.trim())}`),
    projectId: project.id,
    type: statusEventType(targetStatus),
    happenedAt: now,
    isEstimatedDate: false,
    summary: requireReason(reason),
    sourceType: 'platform_verified_fact',
    evidenceIds: project.accessStatus.evidenceIds,
    changes: [{ fieldKey: 'accessStatus', before: beforeStatus, after: targetStatus }],
    disputeStatus: 'none',
  }
  return {
    projects: [nextProject],
    lifecycleEvents: event ? [event] : [],
    statusReview: { projectId: project.id, count: previousReviewCount + 1 },
    log: workflowLog({ action, actor, targetId: project.id, projectId: project.id, beforeValue: beforeStatus, afterValue: firstObservation ? 'pending_recheck' : targetStatus, reason, now }),
  }
}
