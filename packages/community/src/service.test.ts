import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CommunityError } from './errors.js'
import { CommunityService } from './service.js'
import type { CommunityStore, ProjectInteractionStore } from './store-port.js'
import type {
  CommentProjection,
  CommentReportProjection,
  ProjectInteractionProjection,
} from './types.js'

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

const commentProjection: CommentProjection = Object.freeze({
  comment_id: '30000000-0000-4000-8000-000000000001',
  project_id: projectId,
  parent_comment_id: null,
  body: 'hello',
  moderation_state: 'pending',
  version: 1,
  result: 'created',
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  author_withdrawn_at: null,
})

const reportProjection: CommentReportProjection = Object.freeze({
  report_id: '40000000-0000-4000-8000-000000000001',
  project_id: projectId,
  comment_id: commentProjection.comment_id,
  reason_code: 'spam',
  status: 'open',
  review_work_item_id: '50000000-0000-4000-8000-000000000001',
  note_provided: true,
  version: 1,
  result: 'created',
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  resolved_at: null,
})

class FakeStore implements CommunityStore {
  input: Parameters<ProjectInteractionStore['setProjectInteraction']>[0] | null = null
  createInput: Parameters<CommunityStore['createComment']>[0] | null = null
  reportInput: Parameters<CommunityStore['reportComment']>[0] | null = null

  async setProjectInteraction(
    input: Parameters<ProjectInteractionStore['setProjectInteraction']>[0],
  ): Promise<ProjectInteractionProjection> {
    this.input = input
    return projection
  }

  async createComment(input: Parameters<CommunityStore['createComment']>[0]) {
    this.createInput = input
    return Object.freeze({ ...commentProjection, body: input.body })
  }

  async listComments(input: Parameters<CommunityStore['listComments']>[0]) {
    return Object.freeze({
      items: Object.freeze([]),
      nextAnchor: input.after === null
        ? Object.freeze({ createdAt: now, commentId: commentProjection.comment_id })
        : null,
    })
  }

  async withdrawComment() {
    return Object.freeze({
      ...commentProjection,
      moderation_state: 'author_withdrawn' as const,
      result: 'changed' as const,
      version: 2,
      author_withdrawn_at: now.toISOString(),
    })
  }

  async reportComment(input: Parameters<CommunityStore['reportComment']>[0]) {
    this.reportInput = input
    return reportProjection
  }

  async moderateComment() {
    return commentProjection
  }
}

const communityConfig = Object.freeze({
  enabled: true,
  cursorSecret: 'community-cursor-secret-at-least-thirty-two-characters',
  reportEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  reportEncryptionKeyVersion: 'community-v1',
  commentPageSize: 20,
})

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

describe('CommunityService comments', () => {
  it('normalizes comment text, creates an encrypted report and signs list cursors', async () => {
    const store = new FakeStore()
    const service = new CommunityService({ store, config: communityConfig, now: () => now })
    const created = await service.createComment({
      userId,
      projectId,
      body: '  first\r\nsecond  ',
      parentCommentId: null,
      clientRequestId: 'comment_request_0001',
    })
    assert.equal(created.body, 'first\nsecond')
    assert.equal(store.createInput?.body, 'first\nsecond')
    assert.match(store.createInput?.requestHash ?? '', /^[a-f0-9]{64}$/)

    const firstPage = await service.listComments({ projectId, cursor: null, sort: 'latest' })
    assert.ok(firstPage.next_cursor)
    const secondPage = await service.listComments({
      projectId,
      cursor: firstPage.next_cursor,
      sort: 'latest',
    })
    assert.equal(secondPage.next_cursor, null)
    await failure(
      () => service.listComments({
        projectId,
        cursor: `${firstPage.next_cursor}tampered`,
        sort: 'latest',
      }),
      'COMMENT_CURSOR_INVALID',
      400,
    )

    await service.reportComment({
      userId,
      commentId: commentProjection.comment_id,
      reasonCode: 'spam',
      note: 'private reviewer note',
      clientRequestId: 'report_request_0001',
    })
    assert.equal(store.reportInput?.noteKeyVersion, 'community-v1')
    assert.ok(store.reportInput?.noteCiphertext)
    assert.equal(store.reportInput?.noteCiphertext?.includes(Buffer.from('private reviewer note')), false)
  })

  it('rejects oversized/control text and keeps manual review behind the review workflow', async () => {
    const store = new FakeStore()
    const service = new CommunityService({ store, config: communityConfig })
    await failure(() => service.createComment({
      userId,
      projectId,
      body: 'x'.repeat(2_001),
      parentCommentId: null,
      clientRequestId: 'comment_request_0002',
    }), 'COMMENT_BODY_INVALID', 422)
    await failure(() => service.createComment({
      userId,
      projectId,
      body: 'bad\u0000body',
      parentCommentId: null,
      clientRequestId: 'comment_request_0003',
    }), 'COMMENT_BODY_INVALID', 422)
    await failure(() => service.moderateComment({
      commentId: commentProjection.comment_id,
      expectedVersion: 1,
      resultingState: 'visible',
      decisionId: '60000000-0000-4000-8000-000000000001',
      actorType: 'platform_editor',
      reasonCode: 'approved',
      ruleVersion: null,
    }), 'COMMUNITY_MANUAL_REVIEW_NOT_IMPLEMENTED', 501)
  })
})
