import { decisionRecordId, comparisonSessionId, projectId, assetId, type AffectedField, type AssetId, type ComparisonSessionId, type DecisionAction, type DecisionRecord, type ProjectId, type UserId } from '../../types'

export interface DecisionDraft {
  id: DecisionRecord['id']
  sessionId: ComparisonSessionId
  projectIds: ProjectId[]
  action: DecisionAction
  affectedFields: AffectedField[]
  reason: string
  assetIds: AssetId[]
  createdAt: string
}

export function createDecisionDraft({ sessionId, projectIds, action, affectedFields, reason, assetIds, now = new Date().toISOString() }: Omit<DecisionDraft, 'id' | 'createdAt'> & { now?: string }): DecisionDraft {
  return {
    id: decisionRecordId(`decision-local-${sessionId.replace('comparison-', '')}-${now.replace(/\D/g, '')}`),
    sessionId,
    projectIds: [...projectIds],
    action,
    affectedFields: [...new Set(affectedFields)],
    reason: reason.trim(),
    assetIds: [...new Set(assetIds)],
    createdAt: now,
  }
}

export function completeDecisionDraft(draft: DecisionDraft, userId: UserId): DecisionRecord {
  return { ...draft, userId, visibility: 'private' }
}

export function serializeDecisionDraft(draft: DecisionDraft): Record<string, string> {
  return {
    id: draft.id,
    sessionId: draft.sessionId,
    projectIds: JSON.stringify(draft.projectIds),
    action: draft.action,
    affectedFields: JSON.stringify(draft.affectedFields),
    reason: draft.reason,
    assetIds: JSON.stringify(draft.assetIds),
    createdAt: draft.createdAt,
  }
}

export function deserializeDecisionDraft(payload: Record<string, string>): DecisionDraft | null {
  try {
    const projectIds = JSON.parse(payload.projectIds ?? '[]') as string[]
    const affectedFields = JSON.parse(payload.affectedFields ?? '[]') as AffectedField[]
    const assetIds = JSON.parse(payload.assetIds ?? '[]') as string[]
    if (!payload.id || !payload.sessionId || !payload.action || !payload.reason || !payload.createdAt || !Array.isArray(projectIds) || !Array.isArray(affectedFields) || !Array.isArray(assetIds)) return null
    if (!['continue', 'adjust', 'reuse', 'pause'].includes(payload.action)) return null
    return {
      id: decisionRecordId(payload.id),
      sessionId: comparisonSessionId(payload.sessionId),
      projectIds: projectIds.map(projectId),
      action: payload.action as DecisionAction,
      affectedFields,
      reason: payload.reason,
      assetIds: assetIds.map(assetId),
      createdAt: payload.createdAt,
    }
  } catch {
    return null
  }
}
