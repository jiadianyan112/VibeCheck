import { createHash } from 'node:crypto'

import type {
  PostgresAuthorAuthorizationResolver,
  ProjectAuthorAuthorization,
  ProjectAuthorGrant,
} from './author-authorization.js'
import { catalogError } from './errors.js'
import {
  PostgresProjectUpdateStore,
  projectUpdateProjection,
} from './project-update-store.js'
import {
  projectUpdateTypes,
  type CreateProjectUpdateCommand,
  type GetProjectUpdateCommand,
  type PatchProjectUpdateCommand,
  type PreviewProjectUpdateCommand,
  type ProjectUpdateAuthorizationSnapshot,
  type ProjectUpdateBeforeAfter,
  type ProjectUpdateDiffInput,
  type ProjectUpdateProjection,
  type ProjectUpdatePreviewProjection,
  type ProjectUpdateSubmissionProjection,
  type ProjectUpdateWithdrawalProjection,
  type SubmitProjectUpdateCommand,
  type WithdrawProjectUpdateCommand,
  type ProjectUpdateType,
} from './project-update-types.js'

export interface AuthorAuthorizationPort {
  resolveProjectAuthorization(input: Readonly<{
    userId: string
    projectId: string
  }>): Promise<ProjectAuthorAuthorization>
  requireCapability(input: Readonly<{
    userId: string
    projectId: string
    capability: 'project_update.create' | 'project_update.submit'
    fieldPaths?: readonly string[]
  }>): Promise<ProjectAuthorAuthorization>
}

export interface ProjectUpdateStorePort {
  getProjectBase: PostgresProjectUpdateStore['getProjectBase']
  getVersionSnapshot: PostgresProjectUpdateStore['getVersionSnapshot']
  validateDraftBindings: PostgresProjectUpdateStore['validateDraftBindings']
  findCreateReplay: PostgresProjectUpdateStore['findCreateReplay']
  create: PostgresProjectUpdateStore['create']
  getOwned: PostgresProjectUpdateStore['getOwned']
  patch: PostgresProjectUpdateStore['patch']
  submit: PostgresProjectUpdateStore['submit']
  withdraw: PostgresProjectUpdateStore['withdraw']
}

export class ProjectUpdateService {
  private readonly now: () => Date

  constructor(private readonly dependencies: Readonly<{
    store: ProjectUpdateStorePort
    authorization: AuthorAuthorizationPort | PostgresAuthorAuthorizationResolver
    now?: () => Date
  }>) {
    this.now = dependencies.now ?? (() => new Date())
  }

  async create(command: CreateProjectUpdateCommand): Promise<ProjectUpdateProjection> {
    const userId = uuid(command.userId, 'PROJECT_UPDATE_USER_INVALID')
    const projectId = uuid(command.projectId, 'PROJECT_UPDATE_PROJECT_INVALID')
    const baseVersionId = uuid(command.baseVersionId, 'PROJECT_UPDATE_BASE_VERSION_INVALID')
    const updateType = this.updateType(command.updateType)
    const clientRequestId = operationId(command.clientRequestId)
    const requestHash = hashJson({
      project_id: projectId,
      base_version_id: baseVersionId,
      update_type: updateType,
    })
    const replay = await this.dependencies.store.findCreateReplay({ userId, clientRequestId })
    if (replay) {
      if (replay.requestHash !== requestHash) throw catalogError('PROJECT_UPDATE_REQUEST_REUSED', 409)
      return this.withCurrentAuthorization(replay.row, userId)
    }
    const project = await this.dependencies.store.getProjectBase(projectId)
    if (!project) throw catalogError('PROJECT_NOT_FOUND', 404)
    if (project.currentVersionId !== baseVersionId) throw catalogError('PROJECT_UPDATE_BASE_CONFLICT', 409)
    if (project.reviewStatus !== 'published_author') {
      throw catalogError('PROJECT_UPDATE_PROJECT_NOT_AUTHOR_PUBLISHED', 409)
    }
    const authorization = await this.dependencies.authorization.requireCapability({
      userId,
      projectId,
      capability: 'project_update.create',
    })
    const grant = selectGrant(authorization, 'project_update.create', [])
    const row = await this.dependencies.store.create({
      userId,
      projectId,
      baseVersionId,
      originReviewStatus: project.reviewStatus,
      updateType,
      authorizationSnapshot: snapshot(grant),
      clientRequestId,
      requestHash,
      now: this.now(),
    })
    if (row.request_hash !== requestHash) throw catalogError('PROJECT_UPDATE_REQUEST_REUSED', 409)
    return projectUpdateProjection(row, snapshot(grant))
  }

  async get(command: GetProjectUpdateCommand): Promise<ProjectUpdateProjection> {
    const userId = uuid(command.userId, 'PROJECT_UPDATE_USER_INVALID')
    const row = await this.dependencies.store.getOwned(
      userId,
      uuid(command.updateId, 'PROJECT_UPDATE_ID_INVALID'),
    )
    if (!row) throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
    return this.withCurrentAuthorization(row, userId)
  }

  async patch(command: PatchProjectUpdateCommand): Promise<ProjectUpdateProjection> {
    const userId = uuid(command.userId, 'PROJECT_UPDATE_USER_INVALID')
    const updateId = uuid(command.updateId, 'PROJECT_UPDATE_ID_INVALID')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw catalogError('PROJECT_UPDATE_VERSION_INVALID', 422)
    }
    const current = await this.dependencies.store.getOwned(userId, updateId)
    if (!current) throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
    const diff = validateDiff(command.diff)
    const fieldPaths = diff.map((item) => item.field_path)
    const evidenceDraftIds = uuidArray(command.evidenceDraftIds, 50, 'EVIDENCE_DRAFT_IDS_INVALID')
    const mediaReferenceIds = uuidArray(command.mediaReferenceIds, 20, 'MEDIA_REFERENCE_IDS_INVALID')
    if (!await this.dependencies.store.validateDraftBindings({
      userId,
      updateId,
      evidenceDraftIds,
      mediaReferenceIds,
    })) throw catalogError('PROJECT_UPDATE_BINDING_INVALID', 422)
    const authorization = await this.dependencies.authorization.requireCapability({
      userId,
      projectId: current.project_id,
      capability: 'project_update.create',
      fieldPaths,
    })
    const grant = selectGrant(authorization, 'project_update.create', fieldPaths)
    const baseSnapshot = await this.dependencies.store.getVersionSnapshot(
      current.project_id,
      current.base_version_id,
    )
    if (!baseSnapshot) throw catalogError('PROJECT_UPDATE_BASE_NOT_FOUND', 409)
    const beforeAfter = diff.map((item): ProjectUpdateBeforeAfter => Object.freeze({
      field_path: item.field_path,
      before_value: jsonPointerValue(baseSnapshot, item.field_path),
      after_value: item.after_value,
    }))
    const operation = operationId(command.operationId)
    const requestHash = hashJson({
      expected_version: command.expectedVersion,
      diff,
      evidence_draft_ids: evidenceDraftIds,
      media_reference_ids: mediaReferenceIds,
    })
    const row = await this.dependencies.store.patch({
      userId,
      updateId,
      expectedVersion: command.expectedVersion,
      diff,
      beforeAfter,
      evidenceDraftIds,
      mediaReferenceIds,
      authorizationSnapshot: snapshot(grant),
      operationId: operation,
      requestHash,
      now: this.now(),
    })
    return projectUpdateProjection(row, snapshot(grant))
  }

  async preview(command: PreviewProjectUpdateCommand): Promise<ProjectUpdatePreviewProjection> {
    const userId = uuid(command.userId, 'PROJECT_UPDATE_USER_INVALID')
    const updateId = uuid(command.updateId, 'PROJECT_UPDATE_ID_INVALID')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw catalogError('PROJECT_UPDATE_VERSION_INVALID', 422)
    }
    const row = await this.dependencies.store.getOwned(userId, updateId)
    if (!row) throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
    const storedProjection = projectUpdateProjection(row, null)
    const authorization = await this.dependencies.authorization.requireCapability({
      userId,
      projectId: row.project_id,
      capability: 'project_update.create',
      fieldPaths: storedProjection.payload_diff.map((item) => item.field_path),
    })
    const currentGrant = selectGrant(
      authorization,
      'project_update.create',
      storedProjection.payload_diff.map((item) => item.field_path),
    )
    const projection = projectUpdateProjection(row, snapshot(currentGrant))
    if (projection.status !== 'editing') throw catalogError('PROJECT_UPDATE_NOT_EDITABLE', 409)
    if (projection.version !== command.expectedVersion) throw catalogError('PROJECT_UPDATE_VERSION_CONFLICT', 409)
    if (projection.current_version_id !== projection.base_version_id) {
      throw catalogError('PROJECT_UPDATE_BASE_CONFLICT', 409)
    }
    if (projection.before_after.length === 0) throw catalogError('PROJECT_UPDATE_EMPTY', 422)
    if (!await this.dependencies.store.validateDraftBindings({
      userId,
      updateId,
      evidenceDraftIds: projection.evidence_draft_ids,
      mediaReferenceIds: projection.media_reference_ids,
    })) throw catalogError('PROJECT_UPDATE_BINDING_INVALID', 422)
    const authorizationSnapshot = projection.authorization_snapshot
    const previewHash = hashJson({
      update_id: projection.update_id,
      version: projection.version,
      base_version_id: projection.base_version_id,
      before_after: projection.before_after,
      evidence_draft_ids: projection.evidence_draft_ids,
      media_reference_ids: projection.media_reference_ids,
      authorization_snapshot: authorizationSnapshot,
    })
    return Object.freeze({
      update_id: projection.update_id,
      version: projection.version,
      preview_hash: previewHash,
      base_version_id: projection.base_version_id,
      current_version_id: projection.current_version_id,
      before_after: projection.before_after,
      authorization_snapshot: authorizationSnapshot,
      validation: Object.freeze({
        ready_for_submit: true as const,
        changed_field_count: projection.before_after.length,
        evidence_draft_count: projection.evidence_draft_ids.length,
        media_reference_count: projection.media_reference_ids.length,
      }),
    })
  }

  async submit(command: SubmitProjectUpdateCommand): Promise<ProjectUpdateSubmissionProjection> {
    const userId = uuid(command.userId, 'PROJECT_UPDATE_USER_INVALID')
    const updateId = uuid(command.updateId, 'PROJECT_UPDATE_ID_INVALID')
    if (!Number.isSafeInteger(command.version) || command.version < 1) {
      throw catalogError('PROJECT_UPDATE_VERSION_INVALID', 422)
    }
    if (typeof command.previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(command.previewHash)) {
      throw catalogError('PROJECT_UPDATE_PREVIEW_HASH_INVALID', 422)
    }
    const submissionKey = operationId(command.submissionKey)
    const preview = await this.preview({ userId, updateId, expectedVersion: command.version })
    if (preview.preview_hash !== command.previewHash) throw catalogError('PROJECT_UPDATE_PREVIEW_STALE', 409)
    const authorization = await this.dependencies.authorization.requireCapability({
      userId,
      projectId: (await this.requiredOwned(userId, updateId)).project_id,
      capability: 'project_update.submit',
      fieldPaths: preview.before_after.map((item) => item.field_path),
    })
    const grant = selectGrant(
      authorization,
      'project_update.submit',
      preview.before_after.map((item) => item.field_path),
    )
    const requestHash = hashJson({
      version: command.version,
      preview_hash: command.previewHash,
    })
    return this.dependencies.store.submit({
      userId,
      updateId,
      expectedVersion: command.version,
      submissionKey,
      requestHash,
      authorizationSnapshot: snapshot(grant),
      now: this.now(),
    })
  }

  async withdraw(command: WithdrawProjectUpdateCommand): Promise<ProjectUpdateWithdrawalProjection> {
    const userId = uuid(command.userId, 'PROJECT_UPDATE_USER_INVALID')
    const updateId = uuid(command.updateId, 'PROJECT_UPDATE_ID_INVALID')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw catalogError('PROJECT_UPDATE_VERSION_INVALID', 422)
    }
    const operation = operationId(command.operationId)
    const reasonCode = command.reasonCode === null ? 'owner_withdrawn' : reason(command.reasonCode)
    return this.dependencies.store.withdraw({
      userId,
      updateId,
      expectedVersion: command.expectedVersion,
      operationId: operation,
      reasonCode,
      requestHash: hashJson({ expected_version: command.expectedVersion, reason_code: reasonCode }),
      now: this.now(),
    })
  }

  private async withCurrentAuthorization(
    row: Awaited<ReturnType<PostgresProjectUpdateStore['getOwned']>> & object,
    userId: string,
  ): Promise<ProjectUpdateProjection> {
    const authorization = await this.dependencies.authorization.resolveProjectAuthorization({
      userId,
      projectId: row.project_id,
    })
    const grant = authorization.grants.find((candidate) => (
      candidate.capabilities.includes('project_update.create')
    ))
    return projectUpdateProjection(row, grant ? snapshot(grant) : null)
  }

  private async requiredOwned(userId: string, updateId: string) {
    const row = await this.dependencies.store.getOwned(userId, updateId)
    if (!row) throw catalogError('PROJECT_UPDATE_NOT_FOUND', 404)
    return row
  }

  private updateType(value: string): ProjectUpdateType {
    if (!projectUpdateTypes.includes(value as ProjectUpdateType)) {
      throw catalogError('PROJECT_UPDATE_TYPE_INVALID', 422)
    }
    return value as ProjectUpdateType
  }
}

function selectGrant(
  authorization: ProjectAuthorAuthorization,
  capability: 'project_update.create' | 'project_update.submit',
  fieldPaths: readonly string[],
): ProjectAuthorGrant {
  const grant = authorization.grants.find((candidate) => (
    candidate.capabilities.includes(capability) &&
    fieldPaths.every((fieldPath) => candidate.field_paths.includes(fieldPath))
  ))
  if (!grant) throw catalogError('AUTHOR_CAPABILITY_FORBIDDEN', 403)
  return grant
}

function snapshot(grant: ProjectAuthorGrant): ProjectUpdateAuthorizationSnapshot {
  return Object.freeze({
    creator_account_link_id: grant.creator_account_link_id,
    creator_id: grant.creator_id,
    author_relation_id: grant.author_relation_id,
    permission_profile_id: grant.permission_profile_id,
    permission_profile_version: grant.permission_profile_version,
    permission_profile_config_hash: grant.permission_profile_config_hash,
    link_version: grant.link_version,
    author_relation_version: grant.author_relation_version,
    capabilities: grant.capabilities,
    field_paths: grant.field_paths,
  })
}

function validateDiff(value: readonly ProjectUpdateDiffInput[]): readonly ProjectUpdateDiffInput[] {
  if (!Array.isArray(value) || value.length > 43) throw catalogError('PROJECT_UPDATE_DIFF_INVALID', 422)
  const paths = new Set<string>()
  const normalized = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw catalogError('PROJECT_UPDATE_DIFF_INVALID', 422)
    }
    const keys = Object.keys(item)
    if (keys.length !== 2 || !keys.includes('field_path') || !keys.includes('after_value')) {
      throw catalogError('PROJECT_UPDATE_DIFF_INVALID', 422)
    }
    if (typeof item.field_path !== 'string' || !item.field_path.startsWith('/')) {
      throw catalogError('PROJECT_UPDATE_FIELD_PATH_INVALID', 422)
    }
    if (paths.has(item.field_path)) throw catalogError('PROJECT_UPDATE_FIELD_PATH_DUPLICATE', 422)
    paths.add(item.field_path)
    assertJsonValue(item.after_value)
    return Object.freeze({ field_path: item.field_path, after_value: item.after_value })
  })
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 128 * 1024) {
    throw catalogError('PROJECT_UPDATE_DIFF_TOO_LARGE', 422)
  }
  return Object.freeze(normalized)
}

function jsonPointerValue(snapshotValue: unknown, pointer: string): unknown {
  let current = snapshotValue
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(key in current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return current === undefined ? null : current
}

function assertJsonValue(value: unknown): void {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('not json')
    JSON.parse(encoded)
  } catch {
    throw catalogError('PROJECT_UPDATE_VALUE_INVALID', 422)
  }
}

function uuidArray(values: readonly string[], maximum: number, code: string): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) throw catalogError(code, 422)
  const normalized = values.map((value) => uuid(value, code))
  if (new Set(normalized).size !== normalized.length) throw catalogError(code, 422)
  return Object.freeze(normalized)
}

function uuid(value: string, code: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw catalogError(code, 422)
  }
  return value.toLowerCase()
}

function operationId(value: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) {
    throw catalogError('PROJECT_UPDATE_OPERATION_ID_INVALID', 422)
  }
  return value
}

function reason(value: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw catalogError('PROJECT_UPDATE_REASON_INVALID', 422)
  }
  return value
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}
