import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Pool } from 'pg'

import { PostgresAuthorAuthorizationResolver } from './author-authorization.js'
import { CatalogError } from './errors.js'
import { linkPermissionProfiles } from './link-permission-profile.js'

const baseRow = {
  creator_account_link_id: '11111111-1111-4111-8111-111111111111',
  creator_id: '22222222-2222-4222-8222-222222222222',
  author_relation_id: '33333333-3333-4333-8333-333333333333',
  link_role: 'manager',
  permission_profile_id: 'MANAGER_V1',
  permission_profile_version: 1,
  permission_profile_config_hash: linkPermissionProfiles.MANAGER_V1.config_hash,
  author_role: 'maintainer',
  capabilities_json: [...linkPermissionProfiles.MANAGER_V1.capabilities],
  field_path_ceiling_json: [...linkPermissionProfiles.MANAGER_V1.field_path_ceiling],
  field_permissions_json: ['/project_core/current_name', '/not/deployed'],
  link_version: '2',
  author_relation_version: '3',
}

describe('PostgresAuthorAuthorizationResolver', () => {
  it('intersects the exact profile ceiling with active relation fields', async () => {
    const resolver = resolverWithRows([baseRow])
    const authorization = await resolver.requireCapability({
      userId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      capability: 'project_update.create',
      fieldPaths: ['/project_core/current_name'],
    })
    assert.deepEqual(authorization.grants[0]?.field_paths, ['/project_core/current_name'])
    assert.equal(authorization.grants[0]?.link_version, 2)
  })

  it('does not treat a role as authority when no complete active chain exists', async () => {
    const resolver = resolverWithRows([])
    await assert.rejects(
      () => resolver.requireCapability({
        userId: '44444444-4444-4444-8444-444444444444',
        projectId: '55555555-5555-4555-8555-555555555555',
        capability: 'project_update.create',
      }),
      forbidden,
    )
  })

  it('fails closed when a stored profile projection drifts', async () => {
    const resolver = resolverWithRows([{ ...baseRow, capabilities_json: ['project_update.create'] }])
    await assert.rejects(
      () => resolver.resolveProjectAuthorization({ userId: 'u', projectId: 'p' }),
      (error: unknown) => error instanceof CatalogError &&
        error.code === 'AUTHOR_AUTHORIZATION_CONFIGURATION_INVALID' && error.httpStatus === 503,
    )
  })
})

function resolverWithRows(rows: readonly unknown[]): PostgresAuthorAuthorizationResolver {
  return new PostgresAuthorAuthorizationResolver({
    async query() { return { rows } },
  } as unknown as Pool)
}

function forbidden(error: unknown): boolean {
  return error instanceof CatalogError &&
    error.code === 'AUTHOR_CAPABILITY_FORBIDDEN' && error.httpStatus === 403
}
