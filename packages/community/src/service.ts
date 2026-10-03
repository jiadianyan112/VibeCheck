import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { CommunityConfig } from '@vibecheck/config'

import { encryptCommunityText } from './crypto.js'
import { communityError } from './errors.js'
import type { CommunityStore, ProjectInteractionStore } from './store-port.js'
import {
  projectInteractionTypes,
  commentModerationStates,
  type CommentPage,
  type CommentProjection,
  type CommentReportProjection,
  type CreateCommentCommand,
  type CreateExperienceCommand,
  type ExperiencePage,
  type ExperienceProjection,
  type FavoriteProjectInteractionsPage,
  type GetProjectInteractionsCommand,
  type ListFavoriteProjectInteractionsCommand,
  type ListExperiencesCommand,
  type ReplyToExperienceCommand,
  type ListCommentsCommand,
  type ModerateCommentCommand,
  type ProjectInteractionProjection,
  type ProjectInteractionsProjection,
  type ProjectInteractionType,
  type ReportCommentCommand,
  type SetProjectInteractionCommand,
  type WithdrawCommentCommand,
} from './types.js'

export interface CommunityServiceDependencies {
  readonly store: ProjectInteractionStore
  readonly config?: CommunityConfig
  readonly now?: () => Date
}

export class CommunityService {
  private readonly now: () => Date

  constructor(private readonly dependencies: CommunityServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  createComment(command: CreateCommentCommand): Promise<CommentProjection> {
    const store = this.commentStore()
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const projectId = this.uuid(command.projectId, 'PROJECT_ID_INVALID')
    const parentCommentId = command.parentCommentId === null
      ? null
      : this.uuid(command.parentCommentId, 'PARENT_COMMENT_ID_INVALID')
    const body = this.normalizedText(command.body, 2_000, 'COMMENT_BODY_INVALID')
    const clientRequestId = this.requestId(command.clientRequestId)
    const requestHash = this.hash({ projectId, parentCommentId, body })
    return store.createComment({
      userId, projectId, parentCommentId, body, clientRequestId, requestHash, now: this.now(),
    })
  }

  createExperience(command: CreateExperienceCommand): Promise<ExperienceProjection> {
    const store = this.commentStore()
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const projectId = this.uuid(command.projectId, 'PROJECT_ID_INVALID')
    const task = this.normalizedText(command.task, 500, 'EXPERIENCE_TASK_INVALID')
    const outcome = this.normalizedText(command.outcome, 1000, 'EXPERIENCE_OUTCOME_INVALID')
    const scenario = command.scenario === null || command.scenario.trim() === '' ? null : this.normalizedText(command.scenario, 500, 'EXPERIENCE_SCENARIO_INVALID')
    const limitation = command.limitation === null || command.limitation.trim() === '' ? null : this.normalizedText(command.limitation, 500, 'EXPERIENCE_LIMITATION_INVALID')
    if (!Array.isArray(command.screenshotMediaResourceIds) || command.screenshotMediaResourceIds.length > 3 || new Set(command.screenshotMediaResourceIds).size !== command.screenshotMediaResourceIds.length) {
      throw communityError('EXPERIENCE_SCREENSHOTS_INVALID', 422)
    }
    const screenshotMediaResourceIds = Object.freeze(command.screenshotMediaResourceIds.map(id => this.uuid(id, 'EXPERIENCE_SCREENSHOTS_INVALID')))
    const clientRequestId = this.requestId(command.clientRequestId)
    return store.createExperience({
      userId, projectId, task, outcome, scenario, limitation, screenshotMediaResourceIds,
      clientRequestId,
      requestHash: this.hash({ projectId, task, outcome, scenario, limitation, screenshotMediaResourceIds }),
      now: this.now(),
    })
  }

  async listExperiences(command: ListExperiencesCommand): Promise<ExperiencePage> {
    const store = this.commentStore()
    const projectId = this.uuid(command.projectId, 'PROJECT_ID_INVALID')
    const config = this.commentConfig()
    const after = command.cursor === null ? null : this.decodeCursor(command.cursor, projectId, config.cursorSecret)
    const page = await store.listExperiences({ projectId, after, limit: config.commentPageSize })
    return Object.freeze({
      items: page.items,
      next_cursor: page.nextAnchor === null ? null : this.encodeCursor(page.nextAnchor, projectId, config.cursorSecret),
    })
  }

  replyToExperience(command: ReplyToExperienceCommand): Promise<CommentProjection> {
    const store = this.commentStore()
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const experienceId = this.uuid(command.experienceId, 'EXPERIENCE_ID_INVALID')
    const body = this.normalizedText(command.body, 2_000, 'COMMENT_BODY_INVALID')
    const clientRequestId = this.requestId(command.clientRequestId)
    return store.replyToExperience({ userId, experienceId, body, clientRequestId, requestHash: this.hash({ experienceId, body }), now: this.now() })
  }

  async listComments(command: ListCommentsCommand): Promise<CommentPage> {
    const store = this.commentStore()
    const config = this.commentConfig()
    const projectId = this.uuid(command.projectId, 'PROJECT_ID_INVALID')
    if (command.sort !== null && command.sort !== 'latest') {
      throw communityError('COMMENT_SORT_INVALID', 422)
    }
    const after = command.cursor === null
      ? null
      : this.decodeCursor(command.cursor, projectId, config.cursorSecret)
    const page = await store.listComments({ projectId, after, limit: config.commentPageSize })
    return Object.freeze({
      items: page.items,
      next_cursor: page.nextAnchor === null
        ? null
        : this.encodeCursor(page.nextAnchor, projectId, config.cursorSecret),
    })
  }

  withdrawComment(command: WithdrawCommentCommand): Promise<CommentProjection> {
    const store = this.commentStore()
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const commentId = this.uuid(command.commentId, 'COMMENT_ID_INVALID')
    this.version(command.expectedVersion)
    const operationId = this.requestId(command.operationId)
    return store.withdrawComment({
      userId,
      commentId,
      expectedVersion: command.expectedVersion,
      operationId,
      requestHash: this.hash({ commentId, expectedVersion: command.expectedVersion }),
      now: this.now(),
    })
  }

  reportComment(command: ReportCommentCommand): Promise<CommentReportProjection> {
    const store = this.commentStore()
    const config = this.commentConfig()
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const commentId = this.uuid(command.commentId, 'COMMENT_ID_INVALID')
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(command.reasonCode)) {
      throw communityError('REPORT_REASON_INVALID', 422)
    }
    const note = command.note === null || command.note.trim() === ''
      ? null
      : this.normalizedText(command.note, 1_000, 'REPORT_NOTE_INVALID')
    const clientRequestId = this.requestId(command.clientRequestId)
    const requestHash = this.hash({ commentId, reasonCode: command.reasonCode, note })
    return store.reportComment({
      userId,
      commentId,
      reasonCode: command.reasonCode,
      noteCiphertext: note === null
        ? null
        : encryptCommunityText(config.reportEncryptionKey, note),
      noteKeyVersion: note === null ? null : config.reportEncryptionKeyVersion,
      clientRequestId,
      requestHash,
      now: this.now(),
    })
  }

  moderateComment(command: ModerateCommentCommand): Promise<CommentProjection> {
    const store = this.commentStore()
    const commentId = this.uuid(command.commentId, 'COMMENT_ID_INVALID')
    const decisionId = this.uuid(command.decisionId, 'DECISION_ID_INVALID')
    this.version(command.expectedVersion)
    if (
      !['system', 'platform_editor', 'admin'].includes(command.actorType) ||
      !commentModerationStates.includes(command.resultingState)
    ) throw communityError('COMMUNITY_MANUAL_REVIEW_NOT_IMPLEMENTED', 501)
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(command.reasonCode)) {
      throw communityError('MODERATION_REASON_INVALID', 422)
    }
    if (
      command.ruleVersion !== null &&
      !/^[A-Za-z0-9._-]{1,64}$/.test(command.ruleVersion)
    ) throw communityError('MODERATION_RULE_VERSION_INVALID', 422)
    let reviewContext: { actorUserId: string; workItemId: string; claimTokenHash: Buffer } | undefined
    if (command.actorType !== 'system') {
      if (!command.reviewContext || !/^[A-Za-z0-9_-]{43}$/.test(command.reviewContext.claimToken)) throw communityError('COMMENT_REVIEW_CLAIM_REQUIRED', 403)
      reviewContext = { actorUserId: this.uuid(command.reviewContext.actorUserId, 'USER_ID_INVALID'), workItemId: this.uuid(command.reviewContext.workItemId, 'WORK_ITEM_ID_INVALID'), claimTokenHash: createHash('sha256').update(command.reviewContext.claimToken).digest() }
    }
    const { reviewContext: _rawReviewContext, ...moderation } = command
    void _rawReviewContext
    return store.moderateComment({
      ...moderation,
      ...(reviewContext ? { reviewContext } : {}),
      commentId,
      decisionId,
      requestHash: this.hash({
        commentId,
        expectedVersion: command.expectedVersion,
        resultingState: command.resultingState,
        actorType: command.actorType,
        reasonCode: command.reasonCode,
        ruleVersion: command.ruleVersion,
        actorUserId: reviewContext?.actorUserId ?? null,
        workItemId: reviewContext?.workItemId ?? null,
      }),
      now: this.now(),
    })
  }

  setProjectInteraction(
    command: SetProjectInteractionCommand,
  ): Promise<ProjectInteractionProjection> {
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    const projectId = this.uuid(command.projectId, 'PROJECT_ID_INVALID')
    if (command.targetType !== 'project') throw communityError('INTERACTION_TARGET_TYPE_INVALID', 422)
    if (!projectInteractionTypes.includes(command.interactionType as ProjectInteractionType)) {
      throw communityError('INTERACTION_TYPE_INVALID', 422)
    }
    if (typeof command.state !== 'boolean') throw communityError('INTERACTION_STATE_INVALID', 422)
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(command.clientRequestId)) {
      throw communityError('CLIENT_REQUEST_ID_INVALID', 422)
    }
    const interactionType = command.interactionType as ProjectInteractionType
    const requestHash = createHash('sha256').update(JSON.stringify({
      project_id: projectId,
      target_type: 'project',
      interaction_type: interactionType,
      state: command.state,
    })).digest('hex')
    return this.dependencies.store.setProjectInteraction({
      userId,
      projectId,
      interactionType,
      state: command.state,
      clientRequestId: command.clientRequestId,
      requestHash,
      now: this.now(),
    })
  }

  async getProjectInteractions(
    command: GetProjectInteractionsCommand,
  ): Promise<ProjectInteractionsProjection> {
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    if (!Array.isArray(command.projectIds) || command.projectIds.length < 1 || command.projectIds.length > 100) {
      throw communityError('PROJECT_IDS_INVALID', 422)
    }
    const projectIds: string[] = []
    const seen = new Set<string>()
    for (const projectId of command.projectIds) {
      const normalized = this.uuid(projectId, 'PROJECT_ID_INVALID')
      if (!seen.has(normalized)) {
        seen.add(normalized)
        projectIds.push(normalized)
      }
    }
    const store = this.dependencies.store as Partial<ProjectInteractionStore>
    if (typeof store.getProjectInteractions !== 'function') {
      throw communityError('COMMUNITY_INTERACTION_READ_STORE_UNAVAILABLE', 503, true)
    }
    return store.getProjectInteractions({
      userId,
      projectIds: Object.freeze(projectIds),
    })
  }

  async listFavoriteProjectInteractions(
    command: ListFavoriteProjectInteractionsCommand,
  ): Promise<FavoriteProjectInteractionsPage> {
    const userId = this.uuid(command.userId, 'USER_ID_INVALID')
    if (!Number.isSafeInteger(command.limit) || command.limit < 1 || command.limit > 100) {
      throw communityError('FAVORITE_LIMIT_INVALID', 422)
    }
    const config = this.commentConfig()
    const store = this.dependencies.store as Partial<ProjectInteractionStore>
    if (typeof store.getFavoriteProjectInteractions !== 'function') {
      throw communityError('COMMUNITY_INTERACTION_COLLECTION_STORE_UNAVAILABLE', 503, true)
    }
    const after = command.cursor === null
      ? null
      : this.decodeFavoriteCursor(command.cursor, userId, config.cursorSecret)
    const page = await store.getFavoriteProjectInteractions({
      userId,
      after,
      limit: command.limit,
    })
    return Object.freeze({
      items: page.items,
      next_cursor: page.nextAnchor === null
        ? null
        : this.encodeFavoriteCursor(page.nextAnchor, userId, config.cursorSecret),
    })
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw communityError(code, 422)
    }
    return value.toLowerCase()
  }

  private commentStore(): CommunityStore {
    this.commentConfig()
    const store = this.dependencies.store as Partial<CommunityStore>
    if (
      typeof store.createComment !== 'function' || typeof store.listComments !== 'function' ||
      typeof store.createExperience !== 'function' || typeof store.listExperiences !== 'function' ||
      typeof store.replyToExperience !== 'function' ||
      typeof store.withdrawComment !== 'function' || typeof store.reportComment !== 'function' ||
      typeof store.moderateComment !== 'function'
    ) throw communityError('COMMUNITY_COMMENT_STORE_UNAVAILABLE', 503, true)
    return store as CommunityStore
  }

  private commentConfig(): CommunityConfig {
    const config = this.dependencies.config
    if (!config?.enabled) throw communityError('COMMUNITY_COMMENT_SERVICE_UNAVAILABLE', 503, true)
    return config
  }

  private normalizedText(value: string, maximum: number, code: string): string {
    if (typeof value !== 'string') throw communityError(code, 422)
    const normalized = value.replace(/\r\n?/g, '\n').trim()
    const length = [...normalized].length
    if (
      length < 1 || length > maximum ||
      [...normalized].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return (codePoint < 32 && codePoint !== 9 && codePoint !== 10) || codePoint === 127
      })
    ) throw communityError(code, 422)
    return normalized
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
      throw communityError('CLIENT_REQUEST_ID_INVALID', 422)
    }
    return value
  }

  private version(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw communityError('COMMENT_VERSION_INVALID', 422)
    }
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }

  private encodeCursor(
    anchor: { readonly createdAt: Date; readonly commentId: string },
    projectId: string,
    secret: string,
  ): string {
    const payload = Buffer.from(JSON.stringify({
      project_id: projectId,
      created_at: anchor.createdAt.toISOString(),
      comment_id: anchor.commentId,
    }), 'utf8').toString('base64url')
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
  }

  private encodeFavoriteCursor(
    anchor: { readonly updatedAt: string; readonly projectId: string },
    userId: string,
    secret: string,
  ): string {
    const payload = Buffer.from(JSON.stringify({
      scope: 'favorite_projects',
      user_id: userId,
      updated_at: anchor.updatedAt,
      project_id: anchor.projectId,
    }), 'utf8').toString('base64url')
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
  }

  private decodeFavoriteCursor(
    cursor: string,
    userId: string,
    secret: string,
  ): { readonly updatedAt: string; readonly projectId: string } {
    const [payload, suppliedSignature, ...rest] = cursor.split('.')
    if (!payload || !suppliedSignature || rest.length > 0 || cursor.length > 1_024) {
      throw communityError('FAVORITE_CURSOR_INVALID', 400)
    }
    const expected = Buffer.from(
      createHmac('sha256', secret).update(payload).digest('base64url'), 'utf8',
    )
    const supplied = Buffer.from(suppliedSignature, 'utf8')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw communityError('FAVORITE_CURSOR_INVALID', 400)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      throw communityError('FAVORITE_CURSOR_INVALID', 400)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw communityError('FAVORITE_CURSOR_INVALID', 400)
    }
    const record = parsed as Record<string, unknown>
    const updatedAt = new Date(String(record.updated_at))
    if (
      record.scope !== 'favorite_projects' || record.user_id !== userId ||
      typeof record.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(record.updated_at) || Number.isNaN(updatedAt.getTime()) || typeof record.project_id !== 'string'
    ) throw communityError('FAVORITE_CURSOR_INVALID', 400)
    return Object.freeze({
      updatedAt: record.updated_at as string,
      projectId: this.uuid(record.project_id, 'FAVORITE_CURSOR_INVALID'),
    })
  }

  private decodeCursor(cursor: string, projectId: string, secret: string) {
    const [payload, suppliedSignature, ...rest] = cursor.split('.')
    if (!payload || !suppliedSignature || rest.length > 0 || cursor.length > 1_024) {
      throw communityError('COMMENT_CURSOR_INVALID', 400)
    }
    const expected = Buffer.from(
      createHmac('sha256', secret).update(payload).digest('base64url'), 'utf8',
    )
    const supplied = Buffer.from(suppliedSignature, 'utf8')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw communityError('COMMENT_CURSOR_INVALID', 400)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      throw communityError('COMMENT_CURSOR_INVALID', 400)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw communityError('COMMENT_CURSOR_INVALID', 400)
    }
    const record = parsed as Record<string, unknown>
    const createdAt = new Date(String(record.created_at))
    if (
      record.project_id !== projectId || Number.isNaN(createdAt.getTime()) ||
      typeof record.comment_id !== 'string'
    ) throw communityError('COMMENT_CURSOR_INVALID', 400)
    return Object.freeze({
      createdAt,
      commentId: this.uuid(record.comment_id, 'COMMENT_CURSOR_INVALID'),
    })
  }
}
