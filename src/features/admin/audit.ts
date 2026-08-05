import type { AdminAuditLog, Evidence, Project, PrototypeUser } from '../../types'

const auditedProjectFields: Array<keyof Project> = [
  'currentName',
  'originalPlatform',
  'oneLineDefinition',
  'coreProblem',
  'targetUsers',
  'useScenarios',
  'mainInputs',
  'mainOutputs',
  'practiceFormats',
  'feedbackMethods',
  'differentiation',
  'coreFeatures',
  'secondaryFeatures',
  'techStack',
  'modelsUsed',
  'deploymentPlatform',
  'developmentCycle',
]

function stableHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function factValue(value: unknown) {
  if (value && typeof value === 'object' && 'state' in value) {
    const fact = value as { state: string; value?: unknown; reason?: string }
    return fact.state === 'known' ? fact.value : { unknown: fact.reason }
  }
  return value
}

export function createAdminFieldAuditLogs(
  before: Project,
  after: Project,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T19:00:00+08:00',
) {
  if (!reason.trim()) throw new Error('VC_ADMIN_CHANGE_REASON_REQUIRED')
  return auditedProjectFields.flatMap<AdminAuditLog>((fieldKey) => {
    const beforeValue = factValue(before[fieldKey])
    const afterValue = factValue(after[fieldKey])
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return []
    const signature = stableHash(JSON.stringify([before.id, fieldKey, beforeValue, afterValue, reason.trim()]))
    return [{
      id: `admin-log-${before.id}-${fieldKey}-${signature}`,
      projectId: before.id,
      actorUserId: actor.id,
      action: 'field_update',
      fieldKey,
      evidenceId: null,
      beforeValue,
      afterValue,
      reason: reason.trim(),
      createdAt: now,
    }]
  })
}

export function reviewEvidence(
  evidence: Evidence,
  reviewStatus: NonNullable<Evidence['reviewStatus']>,
  actor: PrototypeUser,
  reason: string,
  now = '2026-08-05T19:05:00+08:00',
) {
  if (!reason.trim()) throw new Error('VC_EVIDENCE_REVIEW_REASON_REQUIRED')
  const beforeStatus = evidence.reviewStatus ?? 'current'
  const next: Evidence = {
    ...evidence,
    reviewStatus,
    disputeStatus: reviewStatus === 'disputed'
      ? 'in_review'
      : reviewStatus === 'insufficient'
        ? 'insufficient_evidence'
        : evidence.disputeStatus,
  }
  const signature = stableHash(JSON.stringify([evidence.id, beforeStatus, reviewStatus, reason.trim()]))
  const log: AdminAuditLog = {
    id: `admin-log-${evidence.id}-${signature}`,
    projectId: evidence.supports.projectId,
    actorUserId: actor.id,
    action: 'evidence_review',
    fieldKey: evidence.supports.fieldKey ?? 'project',
    evidenceId: evidence.id,
    beforeValue: beforeStatus,
    afterValue: reviewStatus,
    reason: reason.trim(),
    createdAt: now,
  }
  return { evidence: next, log }
}

export function mergeEvidenceRecords(
  base: readonly Evidence[],
  overrides: readonly Evidence[],
) {
  const overrideMap = new Map(overrides.map((evidence) => [evidence.id, evidence]))
  const baseIds = new Set(base.map((evidence) => evidence.id))
  return [
    ...base.map((evidence) => overrideMap.get(evidence.id) ?? evidence),
    ...overrides.filter((evidence) => !baseIds.has(evidence.id)),
  ]
}
