import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Pool } from 'pg'

import { CatalogError } from './errors.js'
import {
  authorContentP0V1FieldPaths,
  computeLinkPermissionProfileHash,
  linkPermissionProfiles,
  validateLinkPermissionProfileDeployment,
} from './link-permission-profile.js'

describe('LinkPermissionProfile deployment baseline', () => {
  it('matches both frozen JCS hashes over the same 43 exact field paths', () => {
    assert.equal(authorContentP0V1FieldPaths.length, 43)
    assert.equal(new Set(authorContentP0V1FieldPaths).size, 43)
    assert.equal(
      linkPermissionProfiles.OWNER_V1.config_hash,
      '8d9ca77abf8c83611d8eed83bba8318807db6d9c4bd69d6d93f1c83014c69a7c',
    )
    assert.equal(
      linkPermissionProfiles.MANAGER_V1.config_hash,
      '72f2b162c65ff2d145cb9f38407653b18906e067dd3c43afda8c1a524f56165d',
    )
    assert.equal(computeLinkPermissionProfileHash({
      ...linkPermissionProfiles.OWNER_V1,
      capabilities: [...linkPermissionProfiles.OWNER_V1.capabilities].reverse(),
      field_path_ceiling: [...authorContentP0V1FieldPaths].reverse(),
    }), linkPermissionProfiles.OWNER_V1.config_hash)
  })

  it('fails closed when a deployed row drifts even if it keeps the expected hash text', async () => {
    const rows = Object.values(linkPermissionProfiles).map((profile) => ({
      profile_id: profile.profile_id,
      profile_family: profile.profile_family,
      profile_version: profile.profile_version,
      capabilities_json: [...profile.capabilities],
      field_path_ceiling_json: [...profile.field_path_ceiling],
      config_hash: profile.config_hash,
    }))
    rows[0]!.capabilities_json = ['project_update.create']
    const pool = {
      async query() { return { rows } },
    } as unknown as Pool
    await assert.rejects(
      () => validateLinkPermissionProfileDeployment(pool),
      (error: unknown) => error instanceof CatalogError &&
        error.code === 'LINK_PERMISSION_PROFILE_INVALID' && error.httpStatus === 503,
    )
  })
})
