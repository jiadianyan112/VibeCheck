import {
  assetId,
  lifecycleEventId,
  notificationId,
  projectUpdateRecordId,
  versionId,
  type AccessStatus,
  type AssetType,
  type AuthorVerificationRequest,
  type FieldFact,
  type LifecycleEvent,
  type Notification,
  type Project,
  type ProjectUpdateRecord,
  type ProjectUpdateSourceType,
  type ProjectUpdateType,
  type PrototypeUser,
  type ReusableAsset,
  type UserAssets,
} from '../../types'
import { authorManagementState, latestVerificationFor } from '../authorVerification'

export const projectUpdateTypeLabels: Record<ProjectUpdateType, string> = {
  version: '版本更新',
  address: '公开地址迁移',
  status: '作品状态',
  asset: '复用资产',
  description: '产品说明',
}

export const projectUpdateSourceLabels: Record<ProjectUpdateSourceType, string> = {
  author_statement: '作者声明',
  public_page: '公开页面',
  repository: '代码仓库',
  release_notes: '发布说明',
}

export interface ProjectUpdateInput {
  type: ProjectUpdateType
  value: string
  sourceType: ProjectUpdateSourceType
  sourceSummary: string
  impactScope: string
  terminalDeclared: boolean
  assetName: string
  assetType: AssetType
  assetLicense: string
}

function stableHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function updatedFact<T>(fact: FieldFact<T>, value: T, now: string): FieldFact<T> {
  return { state: 'known', value, evidenceIds: fact.evidenceIds, freshness: 'valid', lastVerifiedAt: now, disputeStatus: 'none', confidence: fact.confidence }
}

export function canUserUpdateProject(project: Project, user: PrototypeUser | null, requests: AuthorVerificationRequest[]) {
  if (!user) return { allowed: false, disputed: false }
  const request = latestVerificationFor(requests, project.id, user.id)
  const management = authorManagementState(request)
  const linkedCreator = Boolean(user.creatorId && project.creatorIds.includes(user.creatorId))
  return { allowed: (linkedCreator || management.canEdit) && !management.highRiskEditingFrozen, disputed: management.highRiskEditingFrozen }
}

export function applyProjectUpdate(
  project: Project,
  user: PrototypeUser,
  input: ProjectUpdateInput,
  now = '2026-07-31T12:00:00+08:00',
): { project: Project; event: LifecycleEvent; record: ProjectUpdateRecord; asset?: ReusableAsset } {
  const value = input.value.trim()
  if (!input.sourceSummary.trim() || !input.impactScope.trim()) throw new Error('VC_UPDATE_CONTEXT_REQUIRED')
  if ((input.type === 'status' && (value === 'paused' || value === 'ended')) && !input.terminalDeclared) throw new Error('VC_TERMINAL_DECLARATION_REQUIRED')

  let next = { ...project }
  let beforeValue: unknown = null
  let afterValue: unknown = value
  let eventType: LifecycleEvent['type'] = 'version_updated'
  let summary = `${projectUpdateTypeLabels[input.type]}：${value}`
  let asset: ReusableAsset | undefined

  if (input.type === 'version') {
    beforeValue = project.versionIds.at(-1) ?? null
    const id = versionId(`version-update-${project.id}-${stableHash(value)}`)
    afterValue = id
    next = { ...next, versionIds: project.versionIds.includes(id) ? project.versionIds : [...project.versionIds, id] }
  }
  if (input.type === 'address') {
    beforeValue = project.publicUrl.state === 'known' ? project.publicUrl.value : null
    eventType = 'domain_migrated'
    next = {
      ...next,
      publicUrl: updatedFact(project.publicUrl, value, now),
      historicalUrls: beforeValue && beforeValue !== value && !project.historicalUrls.some((item) => item.url === beforeValue)
        ? [...project.historicalUrls, { url: String(beforeValue), effectiveFrom: project.publicUrl.lastVerifiedAt ?? project.firstSeenAt, effectiveTo: now }]
        : project.historicalUrls,
    }
  }
  if (input.type === 'status') {
    beforeValue = project.accessStatus.state === 'known' ? project.accessStatus.value : 'unknown'
    afterValue = value as AccessStatus
    eventType = value === 'paused' ? 'paused' : value === 'ended' ? 'ended' : value === 'recovered' || value === 'normal' ? 'recovered' : 'version_updated'
    summary = value === 'paused' ? '作者明确声明作品暂停。' : value === 'ended' ? '作者明确声明作品结束。' : `作者更新作品状态为 ${value}。`
    next = { ...next, accessStatus: updatedFact(project.accessStatus, value as AccessStatus, now), statusNote: updatedFact(project.statusNote, input.sourceSummary.trim(), now) }
  }
  if (input.type === 'description') {
    beforeValue = project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : null
    eventType = 'product_pivoted'
    next = { ...next, oneLineDefinition: updatedFact(project.oneLineDefinition, value, now) }
  }
  if (input.type === 'asset') {
    beforeValue = null
    const id = assetId(`asset-update-${project.id}-${stableHash(`${input.assetName}|${value}`)}`)
    afterValue = id
    eventType = 'asset_added'
    summary = `新增复用资产：${input.assetName.trim()}`
    asset = {
      id,
      projectId: project.id,
      type: input.assetType,
      name: input.assetName.trim(),
      description: input.sourceSummary.trim(),
      url: value,
      license: input.assetLicense.trim() || null,
      price: { type: 'unknown' },
      availabilityStatus: 'available',
      lastVerifiedAt: now,
      evidenceIds: [],
    }
    next = { ...next, assetIds: project.assetIds.includes(id) ? project.assetIds : [...project.assetIds, id] }
  }

  const signature = stableHash(JSON.stringify([input.type, afterValue, input.sourceType, input.sourceSummary, input.impactScope]))
  const eventId = lifecycleEventId(`event-update-${project.id}-${signature}`)
  const event: LifecycleEvent = {
    id: eventId,
    projectId: project.id,
    type: eventType,
    happenedAt: now,
    isEstimatedDate: false,
    summary,
    sourceType: 'verified_author_statement',
    evidenceIds: [],
    changes: [{ fieldKey: input.type, before: beforeValue, after: afterValue }],
    disputeStatus: 'none',
  }
  next = { ...next, eventIds: next.eventIds.includes(eventId) ? next.eventIds : [...next.eventIds, eventId], lastVerifiedAt: now, maintenanceSignal: 'author_updated' }
  const record: ProjectUpdateRecord = {
    id: projectUpdateRecordId(`project-update-${project.id}-${signature}`),
    projectId: project.id,
    userId: user.id,
    type: input.type,
    beforeValue,
    afterValue,
    sourceType: input.sourceType,
    sourceSummary: input.sourceSummary.trim(),
    impactScope: input.impactScope.trim(),
    eventId,
    createdAt: now,
  }
  return { project: next, event, record, asset }
}

export function followerNotifications(
  project: Project,
  event: LifecycleEvent,
  updater: PrototypeUser,
  assets: UserAssets[],
  now = event.happenedAt,
): Notification[] {
  const name = project.currentName.state === 'known' ? project.currentName.value : '你关注的作品'
  return assets
    .filter((item) => item.userId !== updater.id && item.followedProjectIds.includes(project.id))
    .map((item) => ({
      id: notificationId(`notification-${event.id}-${item.userId}`),
      userId: item.userId,
      type: 'project_updated' as const,
      title: `${name}有新更新`,
      body: event.summary,
      targetPath: `/project/${project.id}#${event.id}`,
      projectId: project.id,
      eventId: event.id,
      isRead: false,
      createdAt: now,
    }))
}
