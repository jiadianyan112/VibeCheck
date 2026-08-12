import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CommunityError } from './errors.js'
import { CommunityService } from './service.js'
import type { ProjectInteractionStore } from './store-port.js'
import type { ProjectInteractionProjection } from './types.js'

const userId = '10000000-0000-4000-8000-000000000001'
const projectId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-13T00:00:00.000Z')

const projection: ProjectInteractionProjection = Object.freeze({
  project_id: projectId,
  result: 'changed',
  states: Object.freeze({ favorite: true, like: false, follow: true }),
  counts: Object.freeze({ favorite_count: 1, like_count: 0, follower_count: 1 }),
  count_deltas: Object.freeze({ favorite_count: 1, like_count: 0, follower_count: 1 }),
  change_sources: Object.freeze({ favorite: 'follow_cascade', like: null, follow: 'explicit' }),
  updated_at: now.toISOString(),
})

class FakeStore implements ProjectInteractionStore {
  input: Parameters<ProjectInteractionStore['setProjectInteraction']>[0] | null = null

  async setProjectInteraction(
    input: Parameters<ProjectInteractionStore['setProjectInteraction']>[0],
  ): Promise<ProjectInteractionProjection> {
    this.input = input
    return projection
  }
}

async function failure(
  run: () => Promise<unknown> | unknown,
  code: string,
  status: number,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof CommunityError)
    assert.equal(error.code, code)
    assert.equal(error.httpStatus, status)
    return
  }
  assert.fail('Expected CommunityError')
}

describe('CommunityService interactions', () => {
  it('normalizes a project final-state write and binds a payload hash', async () => {
    const store = new FakeStore()
    const service = new CommunityService({ store, now: () => now })
    const result = await service.setProjectInteraction({
      userId: userId.toUpperCase(),
      projectId: projectId.toUpperCase(),
      targetType: 'project',
      interactionType: 'follow',
      state: true,
      clientRequestId: 'request_0001',
    })
    assert.equal(result, projection)
    assert.equal(store.input?.userId, userId)
    assert.equal(store.input?.projectId, projectId)
    assert.equal(store.input?.interactionType, 'follow')
    assert.match(store.input?.requestHash ?? '', /^[a-f0-9]{64}$/)
    assert.equal(store.input?.now, now)
  })

  it('rejects non-project targets, unknown interactions and weak request ids', async () => {
    const store = new FakeStore()
    const service = new CommunityService({ store })
    const base = {
      userId,
      projectId,
      targetType: 'project',
      interactionType: 'favorite',
      state: true,
      clientRequestId: 'request_0001',
    }
    await failure(
      () => service.setProjectInteraction({ ...base, targetType: 'creator' }),
      'INTERACTION_TARGET_TYPE_INVALID',
      422,
    )
    await failure(
      () => service.setProjectInteraction({ ...base, interactionType: 'comment' }),
      'INTERACTION_TYPE_INVALID',
      422,
    )
    await failure(
      () => service.setProjectInteraction({ ...base, clientRequestId: 'short' }),
      'CLIENT_REQUEST_ID_INVALID',
      422,
    )
    assert.equal(store.input, null)
  })
})
