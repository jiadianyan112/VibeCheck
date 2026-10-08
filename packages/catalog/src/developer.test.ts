import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveProjectDeveloper } from './developer.js'

const record = { kind: 'team', display_name: '微光', avatar_url: null, website_url: 'https://example.com', creator_id: '11111111-1111-4111-8111-111111111111', relation_status: 'active', link_status: 'active', link_role: 'owner', verification_status: 'verified', creator_status: 'canonical' }

describe('project-scoped developer identity', () => {
  it('keeps declaration unverified and unknown historical records empty', () => {
    assert.equal(resolveProjectDeveloper(null, undefined, 'unlinked'), null)
    assert.deepEqual(resolveProjectDeveloper(null, { kind: 'individual', displayName: '小林' }, 'unlinked'), { kind: 'individual', display_name: '小林', avatar_url: null, website_url: null, creator_id: null, verification_status: 'unverified' })
  })
  it('requires an effective owner link, relation, canonical identity and this-project verification', () => {
    assert.equal(resolveProjectDeveloper(record, undefined, 'linked')?.verification_status, 'verified')
    for (const change of [{ link_status: 'suspended' }, { link_role: 'manager' }, { verification_status: 'failed' }, { creator_status: 'merged' }]) {
      assert.notEqual(resolveProjectDeveloper({ ...record, ...change }, undefined, 'linked')?.verification_status, 'verified')
    }
  })
  it('uses grey disputed status while never returning private proof or account data', () => {
    const result = resolveProjectDeveloper({ ...record, relation_status: 'suspended', applicant_user_id: 'secret', material_ids: ['private'] }, undefined, 'disputed')
    assert.equal(result?.verification_status, 'disputed')
    assert.equal(JSON.stringify(result).includes('secret'), false)
    assert.equal(JSON.stringify(result).includes('private'), false)
  })
  it('does not expose a replaced relation as current developer', () => {
    assert.equal(resolveProjectDeveloper({ ...record, relation_status: 'replaced' }, undefined, 'failed'), null)
  })
})
