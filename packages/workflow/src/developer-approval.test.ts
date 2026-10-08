import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PoolClient } from 'pg'
import { guardDeveloperApproval } from './developer-approval.js'

function client(claimed: boolean) { return { query: async () => ({ rows: [{ claimed }] }) } as unknown as PoolClient }
const input = { projectId: '11111111-1111-4111-8111-111111111111', linkRole: 'owner', authorRole: 'owner', declaredKind: 'team', profileKind: 'team' }
describe('single developer approval guard', () => {
  it('permits the first reviewed owner of the matching kind', async () => { await guardDeveloperApproval(client(false), input) })
  it('rejects an existing or suspended owner without overwriting the primary relationship', async () => {
    await assert.rejects(guardDeveloperApproval(client(true), input), { code: 'PROJECT_DEVELOPER_ALREADY_CLAIMED' })
  })
  it('rejects manager and co-creator grants and changing a known identity kind', async () => {
    for (const change of [{ linkRole: 'manager' }, { authorRole: 'co_creator' }, { profileKind: 'individual' }, { profileKind: null }]) await assert.rejects(guardDeveloperApproval(client(false), { ...input, ...change }))
  })
})
