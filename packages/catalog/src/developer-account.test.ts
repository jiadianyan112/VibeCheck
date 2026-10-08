import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Pool } from 'pg'
import { DeveloperAccountService } from './developer-account.js'
import type { CatalogService } from './service.js'
import type { PostgresAuthorAuthorizationResolver } from './author-authorization.js'

const userId = '10000000-0000-4000-8000-000000000001'
const projectId = '10000000-0000-4000-8000-000000000002'
const rows = [0, 1].map(i => ({ project_id: i ? '10000000-0000-4000-8000-000000000003' : projectId, current_name: 'Work', updated_at: new Date('2026-10-08T00:00:00Z'), review_status: 'published_platform', verification_id: null, verification_status: null }))
function service() {
  return new DeveloperAccountService({ pool: { query: async () => ({ rows }) } as unknown as Pool, catalog: { getProject: async () => ({ developer: { kind: 'individual', display_name: 'Dev', avatar_url: null, website_url: null, creator_id: null, verification_status: 'unverified' } }) } as unknown as CatalogService, authorization: { resolveProjectAuthorization: async () => ({ grants: [{ capabilities: ['project_update.create'] }] }) } as unknown as PostgresAuthorAuthorizationResolver, cursorSecret: 'a'.repeat(32) })
}
describe('account developer projects', () => {
  it('does not grant updates to unverified platform publications', async () => {
    const page = await service().list({ userId, limit: 1, cursor: null, projectId: null })
    assert.equal(page.items[0]?.can_manage, false)
    assert.ok(page.next_cursor)
    assert.equal('owner_user_id' in page.items[0]!, false)
  })
  it('rejects tampered cursors and using another account cursor', async () => {
    const instance = service()
    const page = await instance.list({ userId, limit: 1, cursor: null, projectId: null })
    await assert.rejects(instance.list({ userId, limit: 1, cursor: `${page.next_cursor}x`, projectId: null }))
    await assert.rejects(instance.list({ userId: '20000000-0000-4000-8000-000000000001', limit: 1, cursor: page.next_cursor, projectId: null }))
  })
})
