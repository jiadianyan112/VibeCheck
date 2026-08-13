import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ProjectAuthorAuthorization, ProjectAuthorGrant } from './author-authorization.js'
import { CatalogError } from './errors.js'
import { linkPermissionProfiles } from './link-permission-profile.js'
import { ProjectUpdateService, type AuthorAuthorizationPort, type ProjectUpdateStorePort } from './project-update-service.js'

const userId = '61000000-0000-4000-8000-000000000001'
const projectId = '62000000-0000-4000-8000-000000000001'
const versionId = '63000000-0000-4000-8000-000000000001'
const updateId = '64000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-13T00:00:00.000Z')

const grant: ProjectAuthorGrant = Object.freeze({
  creator_account_link_id: '65000000-0000-4000-8000-000000000001',
  creator_id: '66000000-0000-4000-8000-000000000001',
  author_relation_id: '67000000-0000-4000-8000-000000000001',
  link_role: 'manager',
  permission_profile_id: 'MANAGER_V1',
  permission_profile_version: 1,
  permission_profile_config_hash: linkPermissionProfiles.MANAGER_V1.config_hash,
  author_role: 'maintainer',
  capabilities: linkPermissionProfiles.MANAGER_V1.capabilities,
  field_paths: ['/project_core/current_name'],
  link_version: 1,
  author_relation_version: 1,
})

describe('ProjectUpdateService', () => {
  it('creates an editing draft without modifying the public project', async () => {
    const store = new FakeStore()
    const service = new ProjectUpdateService({ store, authorization: authorization(), now: () => now })
    const projection = await service.create({
      userId,
      projectId,
      updateType: 'description',
      baseVersionId: versionId,
      clientRequestId: 'create-1',
    })
    assert.equal(projection.status, 'editing')
    assert.equal(projection.base_version_id, versionId)
    assert.equal(store.publicSnapshot.project_core.current_name, 'Before')
  })

  it('derives before values from the frozen base and stores only an authorized exact path', async () => {
    const store = new FakeStore()
    const service = new ProjectUpdateService({ store, authorization: authorization(), now: () => now })
    const projection = await service.patch({
      userId,
      updateId,
      expectedVersion: 1,
      diff: [{ field_path: '/project_core/current_name', after_value: 'After' }],
      evidenceDraftIds: [],
      mediaReferenceIds: [],
      operationId: 'patch-0001',
    })
    assert.deepEqual(projection.before_after, [{
      field_path: '/project_core/current_name',
      before_value: 'Before',
      after_value: 'After',
    }])
    assert.equal(store.publicSnapshot.project_core.current_name, 'Before')
    const preview = await service.preview({
      userId,
      updateId,
      expectedVersion: projection.version,
    })
    assert.equal(preview.validation.ready_for_submit, true)
    assert.equal(preview.preview_hash.length, 64)
  })

  it('rejects a field that is outside every single active grant', async () => {
    const store = new FakeStore()
    const service = new ProjectUpdateService({ store, authorization: authorization(), now: () => now })
    await assert.rejects(
      () => service.patch({
        userId,
        updateId,
        expectedVersion: 1,
        diff: [{ field_path: '/project_core/public_url', after_value: 'https://example.test' }],
        evidenceDraftIds: [],
        mediaReferenceIds: [],
        operationId: 'patch-0002',
      }),
      (error: unknown) => error instanceof CatalogError &&
        error.code === 'AUTHOR_CAPABILITY_FORBIDDEN' && error.httpStatus === 403,
    )
  })
})

class FakeStore implements ProjectUpdateStorePort {
  readonly publicSnapshot = { project_core: { current_name: 'Before' }, category_data: {} }
  private row = storedRow()

  async getProjectBase() {
    return { projectId, currentVersionId: versionId, reviewStatus: 'published_author', snapshot: this.publicSnapshot }
  }

  async getVersionSnapshot() { return this.publicSnapshot }
  async validateDraftBindings() { return true }
  async findCreateReplay() { return null }

  async create(input: Parameters<ProjectUpdateStorePort['create']>[0]) {
    this.row = { ...this.row, request_hash: input.requestHash }
    return this.row
  }
  async getOwned() { return this.row }

  async patch(input: Parameters<ProjectUpdateStorePort['patch']>[0]) {
    this.row = {
      ...this.row,
      payload_diff_json: input.diff,
      before_after_json: input.beforeAfter,
      evidence_draft_ids_json: input.evidenceDraftIds,
      media_reference_ids_json: input.mediaReferenceIds,
      authorization_snapshot_json: input.authorizationSnapshot,
      version: String(input.expectedVersion + 1),
      updated_at: input.now,
    }
    return this.row
  }
}

function authorization(): AuthorAuthorizationPort {
  const resolved: ProjectAuthorAuthorization = { user_id: userId, project_id: projectId, grants: [grant] }
  return {
    async resolveProjectAuthorization() { return resolved },
    async requireCapability(input) {
      if ((input.fieldPaths ?? []).some((path) => !grant.field_paths.includes(path))) {
        throw new CatalogError('AUTHOR_CAPABILITY_FORBIDDEN', 403)
      }
      return resolved
    },
  }
}

function storedRow() {
  return {
    update_id: updateId,
    project_id: projectId,
    owner_user_id: userId,
    origin_review_status: 'published_author',
    base_version_id: versionId,
    current_version_id: versionId,
    update_type: 'description' as const,
    category_change_type: null,
    payload_diff_json: [],
    before_after_json: [],
    evidence_draft_ids_json: [],
    media_reference_ids_json: [],
    authorization_snapshot_json: {
      creator_account_link_id: grant.creator_account_link_id,
      creator_id: grant.creator_id,
      author_relation_id: grant.author_relation_id,
      permission_profile_id: grant.permission_profile_id,
      permission_profile_version: 1,
      permission_profile_config_hash: grant.permission_profile_config_hash,
      link_version: 1,
      author_relation_version: 1,
      capabilities: grant.capabilities,
      field_paths: grant.field_paths,
    },
    status: 'editing' as const,
    review_work_item_id: null,
    apply_attempt_count: 0,
    version: '1',
    created_at: now,
    updated_at: now,
    request_hash: '0'.repeat(64),
  }
}
