import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type {
  AnalyticsBatchReceipt,
  AnalyticsBrowserContext,
  IngestClientBatchCommand,
} from '@vibecheck/analytics'
import type {
  AssetPage,
  AssetResolutionCommand,
  AssetResolutionProjection,
  CreatorProjection,
  EventPage,
  ProjectListProjection,
  ProjectProjection,
  CreateProjectUpdateCommand,
  GetProjectUpdateCommand,
  PatchProjectUpdateCommand,
  PreviewProjectUpdateCommand,
  SubmitProjectUpdateCommand,
  WithdrawProjectUpdateCommand,
  ProjectUpdatePreviewProjection,
  ProjectUpdateProjection,
} from '@vibecheck/catalog'
import {
  ComparisonError,
  type CancelComparisonMergeConflictCommand,
  type ComparisonMutationProjection,
  type ComparisonProjection,
  type ComparisonSubject,
  type GetComparisonMergeConflictCommand,
  type PrepareComparisonLoginMergeCommand,
  type PutComparisonCommand,
  type ResolveComparisonMergeConflictCommand,
  type SetComparisonSavedAfterLoginReplayCommand,
  type SetComparisonSavedCommand,
} from '@vibecheck/comparison'
import type {
  CommentPage,
  CommentProjection,
  CommentReportProjection,
  CreateCommentCommand,
  ListCommentsCommand,
  NotificationPage,
  NotificationReadProjection,
  ProjectInteractionProjection,
  ReportCommentCommand,
  SetProjectInteractionCommand,
  WithdrawCommentCommand,
} from '@vibecheck/community'
import type { ServiceConfig } from '@vibecheck/config'
import {
  IdentityError,
  type CancelPendingActionCommand,
  type CompletePendingActionExecutionCommand,
  type CreatePendingActionCommand,
  type GetPendingActionCommand,
  type GetPendingActionExecutionCommand,
  type PendingActionExecutionProjection,
  type PendingActionProjection,
  type SessionProjection,
  type StartChallengeCommand,
  type VerifyChallengeCommand,
} from '@vibecheck/identity'
import type {
  ApplicantMaterialSummary,
  CompleteMaterialCommand,
  CompleteMaterialProjection,
  GetMaterialCommand,
  PrepareMaterialCommand,
  PrepareMaterialProjection,
  RevokeMaterialCommand,
  RevokeMaterialProjection,
} from '@vibecheck/private-material'
import type { SearchCommand, SearchProjection, SearchSubject } from '@vibecheck/search'
import type {
  CheckSubmissionUrlCommand,
  CreateSubmissionDraftCommand,
  CreateSubmissionRevisionDraftCommand,
  GetSubmissionDraftCommand,
  PatchSubmissionDraftCommand,
  PreviewSubmissionDraftCommand,
  SubmitSubmissionDraftCommand,
  WithdrawSubmissionCommand,
  SubmissionDraftProjection,
  SubmissionPreviewProjection,
  SubmissionProjection,
  SubmissionWithdrawalProjection,
  SubmissionUrlCheckProjection,
} from '@vibecheck/submission'
import type {
  AdminOperationConfirmProjection,
  AdminOperationPreviewProjection,
  ClaimReviewWorkItemCommand,
  ConfirmAdminOperationCommand,
  DecideReviewCommand,
  HeartbeatReviewWorkItemCommand,
  ListReviewWorkItemsCommand,
  PreviewAdminOperationCommand,
  ReleaseReviewWorkItemCommand,
  ReviewDecisionProjection,
  ReviewClaimProjection,
  ReviewWorkItemPage,
  ReviewWorkItemProjection,
  CreateVerificationRequestCommand,
  GetVerificationRequestCommand,
  PatchVerificationRequestCommand,
  VerificationRequestProjection,
} from '@vibecheck/workflow'

import {
  close,
  createApiServer,
  type ApiCatalogService,
  type ApiAnalyticsService,
  type ApiAdminOperationSecurityService,
  type ApiReviewDecisionService,
  type ApiAssetResolutionService,
  type ApiComparisonService,
  type ApiCommunityService,
  type ApiNotificationService,
  type ApiIdentityService,
  type ApiPendingActionService,
  type ApiPendingActionExecutor,
  type ApiProjectUpdateService,
  type ApiVerificationRequestService,
  type ApiOwnershipCaseService,
  type ApiPrivateMaterialService,
  type ApiSearchService,
  type ApiSubmissionService,
  type ApiWorkflowService,
} from './server.js'

const config: ServiceConfig = Object.freeze({
  serviceName: 'vibecheck-api',
  environment: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'fatal',
  databaseUrl: 'postgresql://unused',
  databaseSsl: false,
  webOrigins: Object.freeze(['https://web.example']),
  gitCommit: 'test-commit',
  workerPollIntervalMs: 1_000,
  workerBatchSize: 25,
})

async function start(
  checkReadiness: () => Promise<void>,
  identity?: ApiIdentityService,
  staticDirectory?: string,
  catalog?: ApiCatalogService,
  search?: ApiSearchService,
  assetResolver?: ApiAssetResolutionService,
  comparison?: ApiComparisonService,
  pendingActions?: ApiPendingActionService,
  community?: ApiCommunityService,
  pendingActionExecutor?: ApiPendingActionExecutor,
  analytics?: ApiAnalyticsService,
  submission?: ApiSubmissionService,
  workflow?: ApiWorkflowService,
  adminOperations?: ApiAdminOperationSecurityService,
  reviewDecisions?: ApiReviewDecisionService,
  notifications?: ApiNotificationService,
  projectUpdates?: ApiProjectUpdateService,
  verificationRequests?: ApiVerificationRequestService,
  privateMaterials?: ApiPrivateMaterialService,
  ownershipCases?: ApiOwnershipCaseService,
): Promise<{
  readonly baseUrl: string
  readonly stop: () => Promise<void>
}> {
  const server = createApiServer(config, {
    checkReadiness,
    ...(identity
      ? {
          identity,
          authCookieSecure: false,
        }
      : {}),
    ...((identity || search || assetResolver || comparison || pendingActions || community || analytics || submission || workflow || adminOperations || reviewDecisions || notifications || projectUpdates || verificationRequests || privateMaterials || ownershipCases)
      ? { anonymousCookieSecret: 'test-anonymous-cookie-secret-at-least-32-bytes' }
      : {}),
    ...(staticDirectory ? { staticDirectory } : {}),
    ...(catalog
      ? {
          catalog,
          catalogDefaultPageSize: 24,
          catalogMaximumPageSize: 50,
        }
      : {}),
    ...(search ? { search } : {}),
    ...(assetResolver ? { assetResolver } : {}),
    ...(comparison ? { comparison } : {}),
    ...(pendingActions ? { pendingActions } : {}),
    ...(community ? { community } : {}),
    ...(pendingActionExecutor ? { pendingActionExecutor } : {}),
    ...(analytics ? { analytics } : {}),
    ...(submission ? { submission } : {}),
    ...(workflow ? { workflow } : {}),
    ...(adminOperations ? { adminOperations } : {}),
    ...(reviewDecisions ? { reviewDecisions } : {}),
    ...(notifications ? { notifications } : {}),
    ...(projectUpdates ? { projectUpdates } : {}),
    ...(verificationRequests ? { verificationRequests } : {}),
    ...(privateMaterials ? { privateMaterials } : {}),
    ...(ownershipCases ? { ownershipCases } : {}),
    now: () => new Date('2026-08-10T00:00:00.000Z'),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => close(server),
  }
}

class FakeAnalyticsService implements ApiAnalyticsService {
  issuedContext: AnalyticsBrowserContext | null = null
  ingestCommand: IngestClientBatchCommand | null = null

  issueSession(context: AnalyticsBrowserContext): string {
    this.issuedContext = context
    return 'v1.1786611600.opaque-binding.valid-signature'
  }

  async ingestClientBatch(command: IngestClientBatchCommand): Promise<AnalyticsBatchReceipt> {
    this.ingestCommand = command
    const events = command.body.events as readonly Readonly<Record<string, unknown>>[]
    return Object.freeze({
      receipt_id: 'a1000000-0000-4000-8000-000000000001',
      items: Object.freeze(events.map((event) => Object.freeze({
        event_id: String(event.event_id),
        status: 'accepted' as const,
      }))),
    })
  }
}

function comparisonProjection(
  comparisonId: string,
  orderedProjectIds: readonly string[],
  mutationResult?: ComparisonMutationProjection['mutation_result'],
): ComparisonProjection | ComparisonMutationProjection {
  const projection: ComparisonProjection = Object.freeze({
    comparison_id: comparisonId,
    comparison_version: 1,
    category_id: 'personal_site_portfolio',
    category_schema_version: 'portfolio.v1',
    ordered_project_ids: Object.freeze([...orderedProjectIds]),
    items: Object.freeze([]),
    valid_count: orderedProjectIds.length,
    invalid_count: 0,
    dimension_groups: Object.freeze(['audience', 'problem', 'workflow', 'capabilities']),
    dimension_groups_viewed: Object.freeze([]),
    visible_duration_ms: 0,
    saved_at: null,
    completed_at: null,
    expires_at: '2026-08-17T00:00:00.000Z',
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  })
  return mutationResult === undefined
    ? projection
    : Object.freeze({ ...projection, mutation_result: mutationResult })
}

class FakeComparisonService implements ApiComparisonService {
  getSubject: ComparisonSubject | null = null
  putCommand: PutComparisonCommand | null = null
  saveCommand: SetComparisonSavedCommand | null = null
  prepareMergeCommand: PrepareComparisonLoginMergeCommand | null = null
  getMergeCommand: GetComparisonMergeConflictCommand | null = null
  resolveMergeCommand: ResolveComparisonMergeConflictCommand | null = null
  cancelMergeCommand: CancelComparisonMergeConflictCommand | null = null

  getSaveCommand(): SetComparisonSavedCommand | null {
    return this.saveCommand
  }

  getResolveMergeCommand(): ResolveComparisonMergeConflictCommand | null {
    return this.resolveMergeCommand
  }

  async getComparison(
    comparisonId: string,
    subject: ComparisonSubject,
  ): Promise<ComparisonProjection> {
    this.getSubject = subject
    return comparisonProjection(comparisonId, [])
  }

  async putComparison(command: PutComparisonCommand): Promise<ComparisonMutationProjection> {
    this.putCommand = command
    if (command.orderedProjectIds.length > 5) {
      throw new ComparisonError('COMPARISON_ITEM_LIMIT_EXCEEDED', 409, false, undefined, {
        maximum_count: 5,
        requested_count: command.orderedProjectIds.length,
      })
    }
    return comparisonProjection(
      command.comparisonId,
      command.orderedProjectIds,
      'created',
    ) as ComparisonMutationProjection
  }

  async setSaved(command: SetComparisonSavedCommand): Promise<ComparisonProjection> {
    this.saveCommand = command
    return Object.freeze({
      ...comparisonProjection(command.comparisonId, []),
      saved_at: command.state ? '2026-08-10T00:00:00.000Z' : null,
    })
  }

  async setSavedAfterLoginReplay(
    command: SetComparisonSavedAfterLoginReplayCommand,
  ): Promise<ComparisonProjection> {
    return comparisonProjection(command.sourceComparisonId, [])
  }

  async prepareLoginMerge(command: PrepareComparisonLoginMergeCommand) {
    this.prepareMergeCommand = command
    return Object.freeze({
      result: 'not_required' as const,
      comparison_id: null,
      comparison_version: null,
      conflict_id: null,
      conflict_version: null,
      expires_at: null,
      operation_id: command.operationId,
    })
  }

  async getMergeConflict(command: GetComparisonMergeConflictCommand) {
    this.getMergeCommand = command
    return Object.freeze({
      conflict_id: command.conflictId,
      identity_link_id: '88888888-8888-4888-8888-888888888888',
      account_comparison_id: '61000000-0000-4000-8000-000000000011',
      account_comparison_version: 1,
      anonymous_comparison_id: '61000000-0000-4000-8000-000000000012',
      anonymous_comparison_version: 1,
      candidate_project_ids: Object.freeze([]),
      candidate_projects: Object.freeze([]),
      selected_project_ids: null,
      status: 'pending' as const,
      pending_action_id: null,
      version: 1,
      expires_at: '2026-08-10T00:05:00.000Z',
      resolved_at: null,
      cancelled_at: null,
    })
  }

  async resolveMergeConflict(command: ResolveComparisonMergeConflictCommand) {
    this.resolveMergeCommand = command
    return Object.freeze({
      conflict_id: command.conflictId,
      status: 'resolved' as const,
      conflict_version: command.expectedConflictVersion + 1,
      comparison_id: '61000000-0000-4000-8000-000000000011',
      comparison_version: command.accountVersion + 1,
      selected_project_ids: Object.freeze([...command.selectedProjectIds]),
      resolved_at: '2026-08-10T00:00:00.000Z',
    })
  }

  async cancelMergeConflict(command: CancelComparisonMergeConflictCommand) {
    this.cancelMergeCommand = command
    return Object.freeze({
      conflict_id: command.conflictId,
      status: 'cancelled' as const,
      conflict_version: command.expectedConflictVersion + 1,
      cancelled_at: '2026-08-10T00:00:00.000Z',
      pending_action_status: null,
    })
  }
}

class FakeCommunityService implements ApiCommunityService {
  command: SetProjectInteractionCommand | null = null
  createCommand: CreateCommentCommand | null = null
  listCommand: ListCommentsCommand | null = null
  reportCommand: ReportCommentCommand | null = null
  withdrawCommand: WithdrawCommentCommand | null = null

  async setProjectInteraction(
    command: SetProjectInteractionCommand,
  ): Promise<ProjectInteractionProjection> {
    this.command = command
    return Object.freeze({
      project_id: command.projectId,
      result: 'changed',
      states: Object.freeze({ favorite: true, like: false, follow: true }),
      counts: Object.freeze({ favorite_count: 2, like_count: 1, follower_count: 1 }),
      count_deltas: Object.freeze({ favorite_count: 1, like_count: 0, follower_count: 1 }),
      change_sources: Object.freeze({
        favorite: 'follow_cascade', like: null, follow: 'explicit',
      }),
      updated_at: '2026-08-10T00:00:00.000Z',
    })
  }

  async createComment(command: CreateCommentCommand): Promise<CommentProjection> {
    this.createCommand = command
    return Object.freeze({
      comment_id: '71000000-0000-4000-8000-000000000001',
      project_id: command.projectId,
      parent_comment_id: command.parentCommentId,
      body: command.body.trim(),
      moderation_state: 'pending',
      version: 1,
      result: 'created',
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      author_withdrawn_at: null,
    })
  }

  async listComments(command: ListCommentsCommand): Promise<CommentPage> {
    this.listCommand = command
    return Object.freeze({ items: Object.freeze([]), next_cursor: null })
  }

  async reportComment(command: ReportCommentCommand): Promise<CommentReportProjection> {
    this.reportCommand = command
    return Object.freeze({
      report_id: '72000000-0000-4000-8000-000000000001',
      project_id: '10000000-0000-4000-8000-000000000001',
      comment_id: command.commentId,
      reason_code: command.reasonCode,
      status: 'open',
      review_work_item_id: '73000000-0000-4000-8000-000000000001',
      note_provided: command.note !== null,
      version: 1,
      result: 'created',
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      resolved_at: null,
    })
  }

  async withdrawComment(command: WithdrawCommentCommand): Promise<CommentProjection> {
    this.withdrawCommand = command
    return Object.freeze({
      comment_id: command.commentId,
      project_id: '10000000-0000-4000-8000-000000000001',
      parent_comment_id: null,
      body: 'comment body',
      moderation_state: 'author_withdrawn',
      version: command.expectedVersion + 1,
      result: 'changed',
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      author_withdrawn_at: '2026-08-10T00:00:00.000Z',
    })
  }
}

class FakeNotificationService implements ApiNotificationService {
  listInput: Parameters<ApiNotificationService['list']>[0] | null = null
  readInput: Parameters<ApiNotificationService['setRead']>[0] | null = null

  async list(input: Parameters<ApiNotificationService['list']>[0]): Promise<NotificationPage> {
    this.listInput = input
    return Object.freeze({
      items: Object.freeze([Object.freeze({
        notification_id: '74000000-0000-4000-8000-000000000001',
        type: 'submission_published' as const,
        title: '作品已发布',
        body_summary: '测试作品 已通过审核并公开。',
        target_type: 'project' as const,
        target_id: '10000000-0000-4000-8000-000000000001',
        event_id: '75000000-0000-4000-8000-000000000001',
        read_at: null,
        created_at: '2026-08-10T00:00:00.000Z',
      })]),
      next_cursor: null,
      unread_count: 1,
    })
  }

  async setRead(
    input: Parameters<ApiNotificationService['setRead']>[0],
  ): Promise<NotificationReadProjection> {
    this.readInput = input
    return Object.freeze({
      read: true,
      changed_count: input.notificationIds === null ? 2 : input.notificationIds.length,
      unread_count: 0,
      read_at: '2026-08-10T00:00:00.000Z',
    })
  }
}

class FakeProjectUpdateService implements ApiProjectUpdateService {
  createCommand: CreateProjectUpdateCommand | null = null
  getCommand: GetProjectUpdateCommand | null = null
  patchCommand: PatchProjectUpdateCommand | null = null
  previewCommand: PreviewProjectUpdateCommand | null = null
  submitCommand: SubmitProjectUpdateCommand | null = null
  withdrawCommand: WithdrawProjectUpdateCommand | null = null

  getCreateCommand(): CreateProjectUpdateCommand | null { return this.createCommand }
  getPatchCommand(): PatchProjectUpdateCommand | null { return this.patchCommand }

  async create(command: CreateProjectUpdateCommand): Promise<ProjectUpdateProjection> {
    this.createCommand = command
    return projectUpdateProjection(command.userId, command.projectId, command.baseVersionId, 1, [])
  }

  async get(command: GetProjectUpdateCommand): Promise<ProjectUpdateProjection> {
    this.getCommand = command
    return projectUpdateProjection(command.userId, '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001', 1, [])
  }

  async patch(command: PatchProjectUpdateCommand): Promise<ProjectUpdateProjection> {
    this.patchCommand = command
    return projectUpdateProjection(command.userId, '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001', command.expectedVersion + 1, command.diff)
  }

  async preview(command: PreviewProjectUpdateCommand): Promise<ProjectUpdatePreviewProjection> {
    this.previewCommand = command
    return Object.freeze({
      update_id: command.updateId,
      version: command.expectedVersion,
      preview_hash: 'a'.repeat(64),
      base_version_id: '63000000-0000-4000-8000-000000000001',
      current_version_id: '63000000-0000-4000-8000-000000000001',
      before_after: Object.freeze([]),
      authorization_snapshot: authorizationSnapshot,
      validation: Object.freeze({
        ready_for_submit: true,
        changed_field_count: 1,
        evidence_draft_count: 0,
        media_reference_count: 0,
      }),
    })
  }

  async submit(command: SubmitProjectUpdateCommand) {
    this.submitCommand = command
    return Object.freeze({
      update_id: command.updateId,
      status: 'update_pending' as const,
      version: command.version + 1,
      review_work_item_id: '68000000-0000-4000-8000-000000000001',
      work_item_status: 'queued' as const,
      submitted_at: '2026-08-10T00:00:00.000Z',
    })
  }

  async withdraw(command: WithdrawProjectUpdateCommand) {
    this.withdrawCommand = command
    return Object.freeze({
      update_id: command.updateId,
      from_status: 'update_pending' as const,
      status: 'withdrawn' as const,
      version: command.expectedVersion + 1,
      review_work_item_id: '68000000-0000-4000-8000-000000000001',
      work_item_status: 'cancelled' as const,
      withdrawn_at: '2026-08-10T00:01:00.000Z',
    })
  }
}

class FakeVerificationRequestService implements ApiVerificationRequestService {
  createCommand: (CreateVerificationRequestCommand & { readonly requestId?: string }) | null = null
  getCommand: GetVerificationRequestCommand | null = null
  patchCommand: (PatchVerificationRequestCommand & { readonly requestId?: string }) | null = null
  submitCommand: import('@vibecheck/workflow').SubmitVerificationRequestCommand | null = null
  supplementCommand: import('@vibecheck/workflow').SupplementVerificationRequestCommand | null = null
  withdrawCommand: import('@vibecheck/workflow').WithdrawVerificationRequestCommand | null = null

  getCreateCommand() { return this.createCommand }
  getGetCommand() { return this.getCommand }
  getPatchCommand() { return this.patchCommand }

  async create(command: CreateVerificationRequestCommand & { readonly requestId?: string }) {
    this.createCommand = command
    return verificationProjection(1)
  }

  async get(command: GetVerificationRequestCommand) {
    this.getCommand = command
    return verificationProjection(1)
  }

  async patch(command: PatchVerificationRequestCommand & { readonly requestId?: string }) {
    this.patchCommand = command
    return verificationProjection(command.expectedVersion + 1)
  }

  async submit(command: import('@vibecheck/workflow').SubmitVerificationRequestCommand) {
    this.submitCommand=command
    return verificationProjection(command.expectedVersion + 1)
  }

  async supplement(command: import('@vibecheck/workflow').SupplementVerificationRequestCommand) {
    this.supplementCommand=command
    return verificationProjection(command.expectedVersion + 1)
  }

  async withdraw(command: import('@vibecheck/workflow').WithdrawVerificationRequestCommand) {
    this.withdrawCommand=command
    return verificationProjection(command.expectedVersion + 1)
  }
  async getForReviewer(command:import('@vibecheck/workflow').ReviewVerificationRequestCommand){
    return Object.freeze({viewer_schema:'reviewer' as const,verification_id:command.verificationId,
      project_id:'62000000-0000-4000-8000-000000000001',creator_resolution_mode:'create_new_creator' as const,
      creator_account_link_id:null,target_creator_id:null,new_creator_profile_input:{display_name:'Creator'},
      requested_link_role:'owner' as const,link_policy_snapshot:Object.freeze({
        ...verificationProjection(1).provisional_link_policy!,observed_owner_link_id:null,
        observed_owner_link_version:null,reused_link_id:null,reused_link_version:null}),
      method:'official_domain_control',public_summary:'I control the official project domain.',
      material_ids:Object.freeze(['6a000000-0000-4000-8000-000000000001']),evidence_refs:Object.freeze([]),
      submission_revision:1,status:'pending' as const,review_work_item_id:'6b000000-0000-4000-8000-000000000001',version:3})
  }
}

function verificationProjection(version: number): VerificationRequestProjection {
  return Object.freeze({
    verification_id: '69000000-0000-4000-8000-000000000001',
    project_id: '62000000-0000-4000-8000-000000000001',
    creator_resolution_mode: 'create_new_creator',
    creator_account_link_id: null,
    target_creator_id: null,
    new_creator_profile_input: Object.freeze({ display_name: 'Creator' }),
    requested_link_role: 'owner',
    provisional_link_policy: Object.freeze({
      policy_version: 'creator_link.v1',
      target_creator_aggregate_version: null,
      owner_link_set_version: null,
      allowed_link_roles: Object.freeze(['owner'] as const),
      default_link_role: 'owner',
      allowed_permission_profile_refs: Object.freeze([Object.freeze({
        profile_id: 'OWNER_V1', profile_version: 1 as const, config_hash: 'a'.repeat(64),
      })]),
    }),
    link_policy_snapshot: null,
    method: version === 1 ? null : 'official_domain_control',
    public_summary: version === 1 ? null : 'I control the official project domain.',
    material_summaries: Object.freeze([]),
    status: 'draft',
    status_history: Object.freeze([Object.freeze({ status: 'draft', at: '2026-08-10T00:00:00.000Z' })]),
    latest_public_review_message: null,
    supersedes_verification_id: null,
    resulting_creator_id: null,
    resulting_link_id: null,
    resulting_author_relation_id: null,
    resulting_profile_version_id: null,
    approved_link_role: null,
    approved_permission_profile_ref: null,
    version,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  })
}

class FakePrivateMaterialService implements ApiPrivateMaterialService {
  prepareCommand: PrepareMaterialCommand | null = null
  getCommand: GetMaterialCommand | null = null
  completeCommand: CompleteMaterialCommand | null = null
  revokeCommand: RevokeMaterialCommand | null = null

  getPrepareCommand() { return this.prepareCommand }
  getGetCommand() { return this.getCommand }
  getCompleteCommand() { return this.completeCommand }
  getRevokeCommand() { return this.revokeCommand }

  async prepare(command: PrepareMaterialCommand): Promise<PrepareMaterialProjection> {
    this.prepareCommand = command
    return Object.freeze({
      material: materialSummary('pending', 1),
      upload_url: 'https://private.example/upload-token',
      upload_headers: {
        'content-type': 'application/pdf',
        'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from('a'.repeat(64), 'hex').toString('base64'),
        'x-amz-server-side-encryption': 'AES256',
        'x-amz-tagging': 'VibeCheckAccess=quarantined',
      },
      upload_expires_at: '2026-08-10T00:30:00.000Z',
    })
  }

  async get(command: GetMaterialCommand): Promise<ApplicantMaterialSummary> {
    this.getCommand = command
    return materialSummary('pending', 1)
  }

  async complete(command: CompleteMaterialCommand): Promise<CompleteMaterialProjection> {
    this.completeCommand = command
    return Object.freeze({ material: materialSummary('pending', 2), scan_queued: true })
  }

  async revoke(command: RevokeMaterialCommand): Promise<RevokeMaterialProjection> {
    this.revokeCommand = command
    return Object.freeze({ material: materialSummary('pending', 3), revoked_at: '2026-08-10T00:01:00.000Z' })
  }

  async getForReviewer(command: import('@vibecheck/private-material').ReviewerMaterialCommand) {
    return Object.freeze({
      material_id:command.materialId,verification_id:'69000000-0000-4000-8000-000000000001',
      status:'ready' as const,scan_result:'clean' as const,rejection_reason_code:null,
      pre_terminal_scan_result:null,scan_attempt_count:1,next_scan_at:null,
      processing_deadline_at:null,declared_mime:'application/pdf' as const,detected_mime:'application/pdf',
      byte_size:4,checksum_match:true,read_grant_eligibility:'eligible' as const,version:2,
    })
  }

  async createReadGrant() {
    return Object.freeze({read_url:'/api/v1/verification-material-read-grants/token',
      expires_at:'2026-08-10T00:05:00.000Z'})
  }

  async redeemReadGrant() {
    return Object.freeze({redirect_url:'https://private.example/read'})
  }
}

function materialSummary(state: ApplicantMaterialSummary['applicant_scan_state'], version: number): ApplicantMaterialSummary {
  return Object.freeze({
    material_id: '6a000000-0000-4000-8000-000000000001',
    verification_id: '69000000-0000-4000-8000-000000000001',
    applicant_scan_state: state,
    reason_key: null,
    next_action: state==='pending' ? 'wait' : 'continue_submission',
    upload_expires_at: null,
    version,
  })
}

const authorizationSnapshot = Object.freeze({
  creator_account_link_id: '65000000-0000-4000-8000-000000000001',
  creator_id: '66000000-0000-4000-8000-000000000001',
  author_relation_id: '67000000-0000-4000-8000-000000000001',
  permission_profile_id: 'MANAGER_V1' as const,
  permission_profile_version: 1 as const,
  permission_profile_config_hash: 'a'.repeat(64),
  link_version: 1,
  author_relation_version: 1,
  capabilities: Object.freeze(['project_update.create', 'project_update.submit'] as const),
  field_paths: Object.freeze(['/project_core/current_name']),
})

function projectUpdateProjection(
  ownerUserId: string,
  targetProjectId: string,
  baseVersionId: string,
  version: number,
  diff: readonly Readonly<{ field_path: string; after_value: unknown }>[],
): ProjectUpdateProjection {
  return Object.freeze({
    update_id: '64000000-0000-4000-8000-000000000001',
    project_id: targetProjectId,
    owner_user_id: ownerUserId,
    origin_review_status: 'published_author',
    base_version_id: baseVersionId,
    current_version_id: baseVersionId,
    update_type: 'description',
    category_change_type: null,
    payload_diff: diff,
    before_after: Object.freeze(diff.map((item) => Object.freeze({
      field_path: item.field_path, before_value: 'Before', after_value: item.after_value,
    }))),
    evidence_draft_ids: Object.freeze([]),
    media_reference_ids: Object.freeze([]),
    authorization_snapshot: authorizationSnapshot,
    effective_capabilities: authorizationSnapshot.capabilities,
    effective_field_paths: authorizationSnapshot.field_paths,
    authorization_state: 'active',
    status: 'editing',
    review_work_item_id: null,
    apply_attempt_count: 0,
    version,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  })
}

class FakeSearchService implements ApiSearchService {
  command: SearchCommand | null = null
  subject: SearchSubject | null = null
  lifecycleSubject: SearchSubject | null = null

  async search(command: SearchCommand, subject: SearchSubject): Promise<SearchProjection> {
    this.command = command
    this.subject = subject
    return Object.freeze({
      query_id: '90000000-0000-4000-8000-000000000001',
      intent_version: 1,
      parser_version: 'keyword.v1',
      result_version: '91000000-0000-4000-8000-000000000001',
      ranking_version: 'search.keyword.v1',
      mode: 'search',
      category_id: 'personal_site_portfolio',
      filters: Object.freeze({
        access_status: Object.freeze([]),
        has_available_asset: null,
        verified_since: null,
        category_fields: Object.freeze({}),
        exclude_category_fields: Object.freeze({}),
      }),
      sort: 'relevance',
      semantic_degraded: true,
      exact_count: 0,
      adjacent_count: 0,
      groups: Object.freeze([]),
      next_cursor: null,
      expires_at: '2026-08-11T00:00:00.000Z',
    })
  }


  async getQuerySnapshot(queryId: string, subject: SearchSubject) {
    this.lifecycleSubject = subject
    return Object.freeze({
      query_id: queryId,
      mode: 'search' as const,
      category_id: 'personal_site_portfolio' as const,
      intent: Object.freeze({ mode: 'search' }),
      confidence: Object.freeze({ overall: 'not_applicable' }),
      intent_version: 1,
      parser_version: 'keyword.v1',
      result_version: '91000000-0000-4000-8000-000000000001',
      ranking_version: 'search.keyword.v1',
      filters: Object.freeze({
        access_status: Object.freeze([]),
        has_available_asset: null,
        verified_since: null,
        category_fields: Object.freeze({}),
        exclude_category_fields: Object.freeze({}),
      }),
      sort: 'relevance' as const,
      semantic_degraded: true,
      exact_count: 0,
      adjacent_count: 0,
      version: 1,
      expires_at: '2026-08-11T00:00:00.000Z',
      input_state: 'not_restored' as const,
      notice_key: 'search.conditions_restored' as const,
    })
  }

  async linkQuery(_queryId: string, _command: unknown, subject: SearchSubject) {
    this.lifecycleSubject = subject
    return Object.freeze({
      authorized: true as const,
      version: 2,
      expires_at: '2026-08-11T00:00:00.000Z',
    })
  }

  async unlinkQuery(_queryId: string, _command: unknown, subject: SearchSubject) {
    this.lifecycleSubject = subject
  }
  async invalidateQuery(_queryId: string, _command: unknown, subject: SearchSubject) {
    this.lifecycleSubject = subject
  }
}

test('live and ready endpoints expose deterministic health contracts', async () => {
  const runtime = await start(async () => undefined)
  try {
    const live = await fetch(`${runtime.baseUrl}/health/live`)
    assert.equal(live.status, 200)
    assert.deepEqual(await live.json(), {
      status: 'ok',
      service: 'vibecheck-api',
      version: '0.1.0',
      commit: 'test-commit',
      checked_at: '2026-08-10T00:00:00.000Z',
    })

    const ready = await fetch(`${runtime.baseUrl}/health/ready`)
    assert.equal(ready.status, 200)
    assert.deepEqual((await ready.json() as { checks: unknown }).checks, { database: 'ok' })
  } finally {
    await runtime.stop()
  }
})

test('readiness failure returns 503 without leaking the error', async () => {
  const runtime = await start(async () => {
    throw new Error('database password must stay private')
  })
  try {
    const response = await fetch(`${runtime.baseUrl}/health/ready`)
    assert.equal(response.status, 503)
    const body = await response.json() as { status: string; checks: unknown }
    assert.equal(body.status, 'degraded')
    assert.deepEqual(body.checks, { database: 'failed' })
  } finally {
    await runtime.stop()
  }
})

test('unknown routes return the standard error envelope', async () => {
  const runtime = await start(async () => undefined)
  try {
    const response = await fetch(`${runtime.baseUrl}/missing`, {
      headers: { 'x-request-id': 'request_12345678' },
    })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: {
        code: 'ROUTE_NOT_FOUND',
        message_key: 'error.route_not_found',
        request_id: 'request_12345678',
        retryable: false,
        retry_after_ms: null,
      },
    })
  } finally {
    await runtime.stop()
  }
})

test('search creates a signed anonymous subject and never echoes raw query text', async () => {
  const search = new FakeSearchService()
  const runtime = await start(async () => undefined, undefined, undefined, undefined, search)
  try {
    const response = await fetch(`${runtime.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({
        query: 'private raw query text',
        mode: 'search',
        category_id: 'personal_site_portfolio',
        filters: {},
        sort: 'relevance',
      }),
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie') ?? '', /vc_anon=/)
    assert.equal(search.command?.query, 'private raw query text')
    assert.equal(search.subject?.kind, 'anonymous')
    assert.match(search.subject?.id ?? '', /^[0-9a-f-]{36}$/)
    assert.equal(JSON.stringify(await response.json()).includes('private raw query text'), false)
  } finally {
    await runtime.stop()
  }
})

test('search rejects cross-origin creation before invoking the search service', async () => {
  const search = new FakeSearchService()
  const runtime = await start(async () => undefined, undefined, undefined, undefined, search)
  try {
    const response = await fetch(`${runtime.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ query: 'portfolio', mode: 'search' }),
    })
    assert.equal(response.status, 403)
    assert.equal(search.command, null)
  } finally {
    await runtime.stop()
  }
})

test('comparison creates and reuses a signed anonymous owner without exposing its hash', async () => {
  const comparison = new FakeComparisonService()
  const runtime = await start(
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    comparison,
  )
  const comparisonId = '61000000-0000-4000-8000-000000000001'
  const projectId = '62000000-0000-4000-8000-000000000001'
  try {
    const created = await fetch(`${runtime.baseUrl}/api/v1/comparisons/${comparisonId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({
        ordered_project_ids: [projectId],
        comparison_version: 0,
        client_request_id: '63000000-0000-4000-8000-000000000001',
      }),
    })
    assert.equal(created.status, 200)
    assert.equal((await created.json() as { mutation_result: string }).mutation_result, 'created')
    const setCookie = created.headers.get('set-cookie') ?? ''
    assert.match(setCookie, /vc_anon=/)
    assert.equal(comparison.putCommand?.expectedVersion, 0)
    assert.deepEqual(comparison.putCommand?.orderedProjectIds, [projectId])
    assert.equal(comparison.putCommand?.subject.kind, 'anonymous')

    const anonymous = cookieValue(setCookie, 'vc_anon')
    const recovered = await fetch(`${runtime.baseUrl}/api/v1/comparisons/${comparisonId}`, {
      headers: { cookie: `vc_anon=${encodeURIComponent(anonymous)}` },
    })
    assert.equal(recovered.status, 200)
    assert.deepEqual(comparison.getSubject, comparison.putCommand?.subject)
    assert.equal(JSON.stringify(await recovered.json()).includes(comparison.getSubject?.id ?? ''), false)
  } finally {
    await runtime.stop()
  }
})

test('analytics session is issued from a business response and ingest binds it to the same browser', async () => {
  const comparison = new FakeComparisonService()
  const analytics = new FakeAnalyticsService()
  const runtime = await start(
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    comparison,
    undefined,
    undefined,
    undefined,
    analytics,
  )
  const comparisonId = '61000000-0000-4000-8000-000000000091'
  try {
    const comparisonResponse = await fetch(
      `${runtime.baseUrl}/api/v1/comparisons/${comparisonId}`,
      { headers: { origin: 'https://web.example' } },
    )
    assert.equal(comparisonResponse.status, 200)
    const analyticsSession = comparisonResponse.headers.get('x-analytics-session')
    assert.equal(analyticsSession, 'v1.1786611600.opaque-binding.valid-signature')
    assert.equal(
      comparisonResponse.headers.get('access-control-expose-headers'),
      'x-analytics-session,x-request-id',
    )
    const anonymous = cookieValue(comparisonResponse.headers.get('set-cookie') ?? '', 'vc_anon')
    assert.equal(analytics.issuedContext?.subject.kind, 'anonymous')

    const eventId = 'e1000000-0000-4000-8000-000000000001'
    const ingest = await fetch(`${runtime.baseUrl}/api/v1/analytics/events:batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: `vc_anon=${encodeURIComponent(anonymous)}`,
        'x-analytics-session': analyticsSession!,
      },
      body: JSON.stringify({
        batch_version: 1,
        sent_at: '2026-08-10T00:00:00.000Z',
        sdk_version: 'web-1',
        events: [{
          event_id: eventId,
          event_name: 'comparison_dimension_viewed',
          event_version: 1,
          occurred_at: '2026-08-10T00:00:00.000Z',
          app_version: '0.2.0',
          page_id: 'P09',
          payload: {
            comparison_id: comparisonId,
            comparison_version: 1,
            dimension_group: 'workflow',
            visible_ms: 1_200,
            project_count: 2,
            view_sequence: 1,
          },
        }],
      }),
    })
    assert.equal(ingest.status, 202)
    assert.equal((await ingest.json() as { items: readonly { event_id: string }[] }).items[0]?.event_id, eventId)
    assert.equal(analytics.ingestCommand?.sessionHeader, analyticsSession)
    assert.deepEqual(
      analytics.ingestCommand?.context.subject,
      analytics.issuedContext?.subject,
    )
  } finally {
    await runtime.stop()
  }
})

test('comparison rejects cross-origin writes and returns an actionable five-item conflict', async () => {
  const comparison = new FakeComparisonService()
  const runtime = await start(
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    comparison,
  )
  const comparisonId = '61000000-0000-4000-8000-000000000002'
  const body = {
    ordered_project_ids: Array.from(
      { length: 6 },
      (_, index) => `62000000-0000-4000-8000-00000000000${index + 1}`,
    ),
    comparison_version: 1,
    client_request_id: '63000000-0000-4000-8000-000000000002',
  }
  try {
    const crossOrigin = await fetch(`${runtime.baseUrl}/api/v1/comparisons/${comparisonId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify(body),
    })
    assert.equal(crossOrigin.status, 403)
    assert.equal(comparison.putCommand, null)

    const overflow = await fetch(`${runtime.baseUrl}/api/v1/comparisons/${comparisonId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify(body),
    })
    assert.equal(overflow.status, 409)
    assert.deepEqual(
      (await overflow.json() as { error: { code: string; details: unknown } }).error,
      {
        code: 'COMPARISON_ITEM_LIMIT_EXCEEDED',
        message_key: 'error.comparison_item_limit_exceeded',
        request_id: overflow.headers.get('x-request-id'),
        retryable: false,
        retry_after_ms: null,
        details: { maximum_count: 5, requested_count: 6 },
      },
    )
  } finally {
    await runtime.stop()
  }
})

class FakeAssetResolutionService implements ApiAssetResolutionService {
  command: AssetResolutionCommand | null = null

  getCommand(): AssetResolutionCommand | null {
    return this.command
  }

  async resolve(command: AssetResolutionCommand): Promise<AssetResolutionProjection> {
    this.command = command
    return Object.freeze({
      attempt_id: command.attemptId,
      asset_id: command.assetId,
      project_id: '22222222-2222-4222-8222-222222222222',
      target_kind: command.targetKind ?? 'safe_web_url',
      result: 'allowed',
      safe_web_url: command.targetKind === 'contact_uri' ? null : 'https://example.com/resource',
      contact_uri: command.targetKind === 'contact_uri' ? 'mailto:team@example.com' : null,
      target_domain: command.targetKind === 'contact_uri' ? null : 'example.com',
      reason_code: null,
      redirect_count: 0,
      checked_at: '2026-08-10T00:00:00.000Z',
      expires_at: '2026-08-10T00:05:00.000Z',
    })
  }
}

test('asset resolve binds an anonymous subject, returns no-store, and validates mutation origin first', async () => {
  const resolver = new FakeAssetResolutionService()
  const runtime = await start(
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    resolver,
  )
  const assetId = '11111111-1111-4111-8111-111111111111'
  const attemptId = '22222222-2222-4222-8222-222222222223'
  try {
    const rejected = await fetch(`${runtime.baseUrl}/api/v1/assets/${assetId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ attempt_id: attemptId }),
    })
    assert.equal(rejected.status, 403)
    assert.equal(resolver.command, null)

    const resolved = await fetch(`${runtime.baseUrl}/api/v1/assets/${assetId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({ attempt_id: attemptId, target_kind: 'safe_web_url' }),
    })
    assert.equal(resolved.status, 200)
    assert.equal(resolved.headers.get('cache-control'), 'no-store')
    assert.match(resolved.headers.get('set-cookie') ?? '', /vc_anon=/)
    assert.equal((await resolved.json() as { result: string }).result, 'allowed')
    const captured = resolver.getCommand()
    assert.ok(captured)
    assert.equal(captured.assetId, assetId)
    assert.equal(captured.attemptId, attemptId)
    assert.equal(captured.targetKind, 'safe_web_url')
    assert.equal(captured.subject.kind, 'anonymous')

    for (const body of [
      { attempt_id: attemptId, target_kind: 'file' },
      { attempt_id: attemptId, unexpected: true },
      { target_kind: 'safe_web_url' },
    ]) {
      const invalid = await fetch(`${runtime.baseUrl}/api/v1/assets/${assetId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://web.example' },
        body: JSON.stringify(body),
      })
      assert.equal(invalid.status, 422)
    }
  } finally {
    await runtime.stop()
  }
})

const session: SessionProjection = Object.freeze({
  authenticated: true,
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'u***@example.com',
  accountStatus: 'active',
  roles: Object.freeze(['user'] as const),
  primaryRole: 'user',
  permissions: Object.freeze(['profile:read', 'interaction:write'] as const),
  sessionVersion: 1,
  csrfToken: 'csrf-token-with-at-least-thirty-two-characters',
  recentAuthAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-09-09T00:00:00.000Z',
})

class FakeIdentityService implements ApiIdentityService {
  startCommand: StartChallengeCommand | null = null
  verifyCommand: VerifyChallengeCommand | null = null
  logoutVersion: number | null = null

  async startChallenge(command: StartChallengeCommand) {
    this.startCommand = command
    return {
      authFlowId: '22222222-2222-4222-8222-222222222222',
      challengeId: '33333333-3333-4333-8333-333333333333',
      expiresAt: '2026-08-10T00:10:00.000Z',
      resendAfter: '2026-08-10T00:01:00.000Z',
      maskedEmail: 'u***@example.com',
      browserBindingToken: 'browser-binding-token-with-at-least-32-characters',
    } as const
  }

  async verifyChallenge(command: VerifyChallengeCommand) {
    this.verifyCommand = command
    return {
      purpose: 'login',
      session,
      sessionToken: 'session-token-with-at-least-thirty-two-characters',
      returnTo: '/me',
      anonymousSubjectId: '77777777-7777-4777-8777-777777777777',
      pendingActionId: null,
      identityLinks: [{
        identityLinkId: '99999999-9999-4999-8999-999999999999',
        purpose: 'query_continuation',
        expiresAt: '2026-08-10T00:05:00.000Z',
      }, {
        identityLinkId: '99999999-9999-4999-8999-999999999998',
        purpose: 'comparison_merge',
        expiresAt: '2026-08-10T00:05:00.000Z',
      }] as const,
    } as const
  }

  async getSession() {
    return session
  }

  async logout(
    _sessionToken: string | null,
    _csrfToken: string | null,
    expectedVersion: number,
  ) {
    this.logoutVersion = expectedVersion
  }
}

class RejectingIdentityService extends FakeIdentityService {
  override async getSession(): Promise<SessionProjection> {
    throw new IdentityError('AUTHENTICATION_REQUIRED', 401, false)
  }
}

class RestrictedIdentityService extends FakeIdentityService {
  override async getSession(): Promise<SessionProjection> {
    return Object.freeze({ ...session, accountStatus: 'restricted' as const })
  }
}

class StaffIdentityService extends FakeIdentityService {
  override async getSession(): Promise<SessionProjection> {
    return Object.freeze({
      ...session,
      roles: Object.freeze(['user', 'editor'] as const),
      primaryRole: 'editor' as const,
      permissions: Object.freeze(['profile:read', 'admin:access', 'admin:review'] as const),
    })
  }
}

class FakeWorkflowService implements ApiWorkflowService {
  listCommand: ListReviewWorkItemsCommand | null = null
  claimCommand: ClaimReviewWorkItemCommand | null = null
  heartbeatCommand: HeartbeatReviewWorkItemCommand | null = null
  releaseCommand: ReleaseReviewWorkItemCommand | null = null
  readonly item: ReviewWorkItemProjection = Object.freeze({
    work_item_id: '85000000-0000-4000-8000-000000000001',
    work_type: 'submission',
    target_type: 'submission',
    target_id: '85000000-0000-4000-8000-000000000002',
    work_item_status: 'queued',
    version: 1,
    assignee_user_id: null,
    lease_expires_at: null,
    domain_summary: Object.freeze({ status: 'pending_review' }),
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  })

  getClaimCommand(): ClaimReviewWorkItemCommand | null { return this.claimCommand }

  async listWorkItems(command: ListReviewWorkItemsCommand): Promise<ReviewWorkItemPage> {
    this.listCommand = command
    return Object.freeze({ items: Object.freeze([this.item]), total_count: 1, next_cursor: null })
  }

  async claimWorkItem(command: ClaimReviewWorkItemCommand): Promise<ReviewClaimProjection> {
    this.claimCommand = command
    return Object.freeze({
      ...this.item,
      work_item_status: 'claimed',
      version: 2,
      assignee_user_id: command.actor.userId,
      lease_expires_at: '2026-08-10T00:01:00.000Z',
      claim_token: 'a'.repeat(43),
    })
  }

  async heartbeatWorkItem(command: HeartbeatReviewWorkItemCommand): Promise<ReviewWorkItemProjection> {
    this.heartbeatCommand = command
    return Object.freeze({
      ...this.item,
      work_item_status: 'claimed', version: 3, assignee_user_id: command.actor.userId,
      lease_expires_at: '2026-08-10T00:01:30.000Z',
    })
  }

  async releaseWorkItem(command: ReleaseReviewWorkItemCommand): Promise<ReviewWorkItemProjection> {
    this.releaseCommand = command
    return Object.freeze({ ...this.item, version: 4 })
  }
}

class FakeOwnershipCaseService implements ApiOwnershipCaseService {
  createCommand:Parameters<ApiOwnershipCaseService['create']>[0]|null=null
  reviewerCommand:Parameters<ApiOwnershipCaseService['getReviewer']>[0]|null=null
  private mutation(){return Object.freeze({case_id:'86000000-0000-4000-8000-000000000001',status:'open' as const,review_work_item_id:'86000000-0000-4000-8000-000000000002',work_item_status:'queued' as const,resulting_author_relation_status:'suspended' as const,resulting_project_status:'published_platform',conflict_principal_version:1,version:1})}
  async create(command:Parameters<ApiOwnershipCaseService['create']>[0]){this.createCommand=command;return this.mutation()}
  async getParty(){return Object.freeze({viewer_schema:'party' as const,case_id:'86000000-0000-4000-8000-000000000001',project_id:'86000000-0000-4000-8000-000000000003',author_relation_id:'86000000-0000-4000-8000-000000000004',status:'open' as const,reason_code:'claim_conflict',party_roles:['opened_by' as const],my_evidence_submissions:[],my_withdrawal_requests:[],allowed_actions:['add_evidence' as const,'request_withdrawal' as const],version:1,created_at:'2026-08-10T00:00:00.000Z',updated_at:'2026-08-10T00:00:00.000Z'})}
  async getReviewer(command:Parameters<ApiOwnershipCaseService['getReviewer']>[0]){this.reviewerCommand=command;return Object.freeze({viewer_schema:'reviewer' as const,case_id:'86000000-0000-4000-8000-000000000001',project_id:'86000000-0000-4000-8000-000000000003',author_relation_id:'86000000-0000-4000-8000-000000000004',opened_by_user_id:'86000000-0000-4000-8000-000000000005',reason_code:'claim_conflict',status:'investigating' as const,evidence_submissions:[],withdrawal_requests:[],review_work_item_summary:{work_item_id:'86000000-0000-4000-8000-000000000002',status:'claimed' as const,version:2},conflict_principal_version:1,allowed_actions:['preview' as const,'decide' as const,'release' as const],version:2,created_at:'2026-08-10T00:00:00.000Z',updated_at:'2026-08-10T00:00:00.000Z'})}
  async addEvidence(){return this.mutation()}
  async requestWithdrawal(){return Object.freeze({...this.mutation(),withdrawal_request_id:'86000000-0000-4000-8000-000000000006',withdrawal_request_status:'requested' as const})}
  async rejectWithdrawal(){return Object.freeze({...this.mutation(),withdrawal_request_id:'86000000-0000-4000-8000-000000000006',withdrawal_request_status:'rejected' as const})}
}

class FakeAdminOperationSecurityService implements ApiAdminOperationSecurityService {
  previewCommand: PreviewAdminOperationCommand | null = null
  confirmCommand: ConfirmAdminOperationCommand | null = null

  async preview(command: PreviewAdminOperationCommand): Promise<AdminOperationPreviewProjection> {
    this.previewCommand = command
    return Object.freeze({
      preview_token: 'p'.repeat(43),
      operation_type: command.operationType,
      targets: command.targets,
      expected_versions: command.expectedVersions,
      diff: command.proposedDiff,
      impact: Object.freeze({
        target_count: command.targets.length,
        expected_version_count: Object.keys(command.expectedVersions).length,
        changed_top_level_fields: Object.freeze(Object.keys(command.proposedDiff)),
      }),
      confirmation_summary_hash: 'a'.repeat(64),
      expires_at: '2026-08-10T00:10:00.000Z',
      conflict_principal_version: command.expectedConflictPrincipalVersion,
    })
  }

  async confirm(command: ConfirmAdminOperationCommand): Promise<AdminOperationConfirmProjection> {
    this.confirmCommand = command
    return Object.freeze({
      confirm_token: 'c'.repeat(43),
      expires_at: '2026-08-10T00:02:00.000Z',
      binding_summary: Object.freeze({
        operation_type: 'submission_review',
        target_count: 1,
        confirmation_summary_hash: command.confirmationSummaryHash,
      }),
      assurance_source: 'recent_session',
      conflict_principal_version: command.expectedConflictPrincipalVersion,
      replayed: false,
    })
  }
}

test('admin operation preview and confirm preserve the primary session and exact security inputs', async () => {
  const adminOperations = new FakeAdminOperationSecurityService()
  const runtime = await start(
    async () => undefined,
    new StaffIdentityService(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined,
    adminOperations,
  )
  const sessionToken = 'session-token-with-at-least-thirty-two-characters'
  const cookie = `vc_session=${sessionToken}; vc_csrf=${session.csrfToken}`
  const headers = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie,
    'x-csrf-token': session.csrfToken,
  }
  try {
    const preview = await fetch(`${runtime.baseUrl}/api/v1/admin/operations/preview`, {
      method: 'POST', headers,
      body: JSON.stringify({
        operation_type: 'submission_review',
        targets: [{ target_type: 'submission', target_id: 'submission-1' }],
        expected_versions: { work_item: 2, submission: 1 },
        proposed_diff: { review_status: 'approved' },
        reason_code: 'submission_approved',
        claim_token: 'x'.repeat(43),
        expected_conflict_principal_version: null,
      }),
    })
    assert.equal(preview.status, 200)
    const previewBody = await preview.json() as AdminOperationPreviewProjection
    assert.equal(adminOperations.previewCommand?.sessionToken, sessionToken)
    assert.equal(adminOperations.previewCommand?.actor.roles.includes('editor'), true)
    assert.equal(adminOperations.previewCommand?.claimToken, 'x'.repeat(43))

    const confirm = await fetch(`${runtime.baseUrl}/api/v1/admin/operations/confirm`, {
      method: 'POST', headers,
      body: JSON.stringify({
        preview_token: previewBody.preview_token,
        confirmation_summary_hash: previewBody.confirmation_summary_hash,
        confirm_request_id: 'confirm_request_0001',
        reauth_grant_id: null,
        expected_conflict_principal_version: null,
      }),
    })
    assert.equal(confirm.status, 201)
    assert.equal(adminOperations.confirmCommand?.sessionToken, sessionToken)
    assert.equal(adminOperations.confirmCommand?.previewToken, previewBody.preview_token)
  } finally {
    await runtime.stop()
  }
})

class FakeReviewDecisionService implements ApiReviewDecisionService {
  command: DecideReviewCommand | null = null

  async decideReview(command: DecideReviewCommand): Promise<ReviewDecisionProjection> {
    this.command = command
    return Object.freeze({
      review_decision_id: '10000000-0000-4000-8000-000000000011',
      work_item_id: command.workItemId,
      work_type: 'submission',
      target_type: 'submission',
      target_id: '10000000-0000-4000-8000-000000000012',
      decision: 'approve',
      project_id: null,
      base_version_id: null,
      resulting_status: 'approved',
      work_item_status: 'decided',
      work_item_decision_ref_type: 'review_decision',
      transaction_id: '10000000-0000-4000-8000-000000000013',
      committed_at: '2026-08-10T00:00:00.000Z',
      schema_version: 'review_decision.v1',
      domain_status: 'approved',
      outbox_status: 'pending',
      resulting_creator_id: null,
      resulting_link_id: null,
      resulting_author_relation_id: null,
      resulting_profile_version_id: null,
      approved_link_role: null,
      approved_permission_profile_ref: null,
      effective_capabilities: Object.freeze([]),
      effective_field_permissions: Object.freeze([]),
      creator_aggregate_version: null,
      owner_link_set_version: null,
    })
  }
}

test('review decision forwards exact claim, preview, confirm and idempotency inputs', async () => {
  const decisions = new FakeReviewDecisionService()
  const runtime = await start(
    async () => undefined,
    new StaffIdentityService(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined,
    new FakeWorkflowService(),
    undefined,
    decisions,
  )
  const sessionToken = 'session-token-with-at-least-thirty-two-characters'
  const cookie = `vc_session=${sessionToken}; vc_csrf=${session.csrfToken}`
  try {
    const response = await fetch(
      `${runtime.baseUrl}/api/v1/admin/work-items/10000000-0000-4000-8000-000000000010/decision`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://web.example',
          cookie,
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({
          preview_token: 'p'.repeat(43),
          claim_token: 'c'.repeat(43),
          confirm_token: 'f'.repeat(43),
          decision: 'approve',
          reason_code: 'submission_approved',
          field_paths: [],
          decision_evidence_refs: [],
          expected_version: 2,
          decision_request_id: 'decision_request_0001',
          decision_payload: {},
        }),
      },
    )
    assert.equal(response.status, 200)
    assert.equal(decisions.command?.sessionToken, sessionToken)
    assert.equal(decisions.command?.claimToken, 'c'.repeat(43))
    assert.equal(decisions.command?.confirmToken, 'f'.repeat(43))
    assert.equal(decisions.command?.expectedVersion, 2)
    assert.equal(decisions.command?.decisionRequestId, 'decision_request_0001')
  } finally {
    await runtime.stop()
  }
})

test('review work-item queue and lease mutations use staff session, CSRF and frozen operation shapes', async () => {
  const workflow = new FakeWorkflowService()
  const runtime = await start(
    async () => undefined,
    new StaffIdentityService(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined,
    workflow,
  )
  const cookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  const mutationHeaders = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie,
    'x-csrf-token': session.csrfToken,
  }
  try {
    const listed = await fetch(
      `${runtime.baseUrl}/api/v1/admin/work-items?work_type=submission&status=queued`,
      { headers: { cookie } },
    )
    assert.equal(listed.status, 200)
    assert.equal((await listed.json() as { total_count: number }).total_count, 1)
    assert.equal(workflow.listCommand?.actor.roles.includes('editor'), true)

    const missingCsrf = await fetch(
      `${runtime.baseUrl}/api/v1/admin/work-items/${workflow.item.work_item_id}/claim`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://web.example', cookie },
        body: JSON.stringify({ expected_version: 1 }),
      },
    )
    assert.equal(missingCsrf.status, 403)
    assert.equal(workflow.claimCommand, null)

    const claimed = await fetch(
      `${runtime.baseUrl}/api/v1/admin/work-items/${workflow.item.work_item_id}/claim`,
      {
        method: 'POST', headers: mutationHeaders,
        body: JSON.stringify({ expected_version: 1 }),
      },
    )
    assert.equal(claimed.status, 200)
    const token = (await claimed.json() as { claim_token: string }).claim_token
    assert.equal(workflow.getClaimCommand()?.expectedVersion, 1)

    const heartbeat = await fetch(
      `${runtime.baseUrl}/api/v1/admin/work-items/${workflow.item.work_item_id}/heartbeat`,
      { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ claim_token: token }) },
    )
    assert.equal(heartbeat.status, 200)
    assert.equal(workflow.heartbeatCommand?.claimToken, token)

    const released = await fetch(
      `${runtime.baseUrl}/api/v1/admin/work-items/${workflow.item.work_item_id}/release`,
      {
        method: 'POST', headers: mutationHeaders,
        body: JSON.stringify({ claim_token: token, reason_code: 'manual_release' }),
      },
    )
    assert.equal(released.status, 200)
    assert.equal(workflow.releaseCommand?.reasonCode, 'manual_release')
  } finally {
    await runtime.stop()
  }
})

test('ownership routes bind actors, reject unknown fields, and separate party from reviewer claims',async()=>{
  const ownership=new FakeOwnershipCaseService()
  const server=createApiServer(config,{checkReadiness:async()=>undefined,identity:new StaffIdentityService(),ownershipCases:ownership,authCookieSecure:false,anonymousCookieSecret:'test-anonymous-cookie-secret-at-least-32-bytes'})
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address==='object');const baseUrl=`http://127.0.0.1:${address.port}`
  const headers={origin:'https://web.example','x-csrf-token':session.csrfToken,cookie:`vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=${session.csrfToken}`,'content-type':'application/json'}
  try{
    const created=await fetch(`${baseUrl}/api/v1/ownership-cases`,{method:'POST',headers,body:JSON.stringify({author_relation_id:'86000000-0000-4000-8000-000000000004',appealed_user_id:null,reason_code:'claim_conflict',evidence_ids:[],client_request_id:'ownership-create-1'})});assert.equal(created.status,201);assert.equal(ownership.createCommand?.actor.userId,session.userId)
    const forged=await fetch(`${baseUrl}/api/v1/ownership-cases`,{method:'POST',headers,body:JSON.stringify({author_relation_id:'86000000-0000-4000-8000-000000000004',appealed_user_id:null,reason_code:'claim_conflict',evidence_ids:[],client_request_id:'ownership-create-2',opened_by_user_id:'86000000-0000-4000-8000-000000000099'})});assert.equal(forged.status,422)
    const party=await fetch(`${baseUrl}/api/v1/me/ownership-cases/86000000-0000-4000-8000-000000000001`,{headers:{cookie:headers.cookie}});assert.equal(party.status,200);assert.equal((await party.json() as {viewer_schema:string}).viewer_schema,'party')
    const noClaim=await fetch(`${baseUrl}/api/v1/admin/ownership-cases/86000000-0000-4000-8000-000000000001`,{headers:{cookie:headers.cookie}});assert.equal(noClaim.status,403)
    const reviewer=await fetch(`${baseUrl}/api/v1/admin/ownership-cases/86000000-0000-4000-8000-000000000001`,{headers:{cookie:headers.cookie,'x-review-claim-token':'c'.repeat(43)}});assert.equal(reviewer.status,200);assert.equal(ownership.reviewerCommand?.claimToken,'c'.repeat(43))
  }finally{await close(server)}
})

class FakeSubmissionService implements ApiSubmissionService {
  checkCommand: CheckSubmissionUrlCommand | null = null
  createCommand: CreateSubmissionDraftCommand | null = null
  revisionCommand: CreateSubmissionRevisionDraftCommand | null = null
  getCommand: GetSubmissionDraftCommand | null = null
  patchCommand: PatchSubmissionDraftCommand | null = null
  previewCommand: PreviewSubmissionDraftCommand | null = null
  submitCommand: SubmitSubmissionDraftCommand | null = null
  withdrawCommand: WithdrawSubmissionCommand | null = null

  getCheckCommand(): CheckSubmissionUrlCommand | null { return this.checkCommand }
  getCreateCommand(): CreateSubmissionDraftCommand | null { return this.createCommand }
  getPatchCommand(): PatchSubmissionDraftCommand | null { return this.patchCommand }

  readonly check: SubmissionUrlCheckProjection = Object.freeze({
    check_id: '84000000-0000-4000-8000-000000000001',
    category_id: 'personal_site_portfolio',
    category_schema_version: 'portfolio.v1',
    input_hash: 'a'.repeat(64),
    canonical_url: 'https://portfolio.example',
    redirect_chain: Object.freeze(['https://portfolio.example']),
    risk_result: 'allowed',
    access_result: 'accessible',
    category_result: 'unconfirmed',
    duplicate_result: 'none',
    duplicate_candidates: Object.freeze([]),
    risk_reasons: Object.freeze([]),
    can_create_draft: true,
    checked_at: '2026-08-10T00:00:00.000Z',
    expires_at: '2026-08-10T00:30:00.000Z',
  })

  readonly draft: SubmissionDraftProjection = Object.freeze({
    draft_id: '84000000-0000-4000-8000-000000000002',
    submission_chain_id: '84000000-0000-4000-8000-000000000003',
    category_id: 'personal_site_portfolio',
    category_schema_version: 'portfolio.v1',
    check_id: this.check.check_id,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    payload_snapshot: Object.freeze({
      project_core: Object.freeze({ public_url: 'https://portfolio.example' }),
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      category_data: Object.freeze({}),
    }),
    media_reference_ids: Object.freeze([]),
    evidence_draft_ids: Object.freeze([]),
    asset_drafts: Object.freeze([]),
    status: 'editing',
    version: 1,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
    saved_at: '2026-08-10T00:00:00.000Z',
    expires_at: '2026-09-09T00:00:00.000Z',
  })

  async checkUrl(command: CheckSubmissionUrlCommand) {
    this.checkCommand = command
    return this.check
  }

  async createDraft(command: CreateSubmissionDraftCommand) {
    this.createCommand = command
    return this.draft
  }

  async createRevisionDraft(command: CreateSubmissionRevisionDraftCommand) {
    this.revisionCommand = command
    return Object.freeze({
      ...this.draft,
      draft_revision: 2,
      supersedes_draft_id: this.draft.draft_id,
      base_submission_id: command.baseSubmissionId,
    })
  }

  async getDraft(command: GetSubmissionDraftCommand) {
    this.getCommand = command
    return this.draft
  }

  async patchDraft(command: PatchSubmissionDraftCommand) {
    this.patchCommand = command
    return Object.freeze({ ...this.draft, version: 2 })
  }

  async previewDraft(command: PreviewSubmissionDraftCommand): Promise<SubmissionPreviewProjection> {
    this.previewCommand = command
    return Object.freeze({
      draft_id: command.draftId,
      draft_version: command.expectedVersion,
      check_id: command.checkId,
      preview_hash: 'a'.repeat(64),
      payload_snapshot: this.draft.payload_snapshot,
      media_reference_ids: Object.freeze(['84000000-0000-4000-8000-000000000004']),
      evidence_draft_ids: Object.freeze(['84000000-0000-4000-8000-000000000005']),
      validation: Object.freeze({ valid: true, issue_count: 0 }),
      generated_at: '2026-08-10T00:00:00.000Z',
    })
  }

  async submitDraft(command: SubmitSubmissionDraftCommand): Promise<SubmissionProjection> {
    this.submitCommand = command
    return Object.freeze({
      submission_id: '84000000-0000-4000-8000-000000000006',
      submission_chain_id: this.draft.submission_chain_id,
      draft_id: command.draftId,
      snapshot_version: command.draftVersion,
      review_status: 'pending_review',
      review_work_item_id: '84000000-0000-4000-8000-000000000007',
      media_reference_ids: Object.freeze(['84000000-0000-4000-8000-000000000004']),
      evidence_draft_ids: Object.freeze(['84000000-0000-4000-8000-000000000005']),
      preview_hash: command.previewHash,
      version: 1,
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
    })
  }

  async withdrawSubmission(command: WithdrawSubmissionCommand): Promise<SubmissionWithdrawalProjection> {
    this.withdrawCommand = command
    return Object.freeze({
      submission_id: '84000000-0000-4000-8000-000000000006',
      review_status: 'withdrawn',
      submission_version: 2,
      review_work_item_id: '84000000-0000-4000-8000-000000000007',
      work_item_status: 'cancelled',
      work_item_version: 2,
      withdrawn_at: '2026-08-10T00:01:00.000Z',
    })
  }
}

test('submission entry routes require the authenticated owner, same-origin CSRF and optimistic versions', async () => {
  const submission = new FakeSubmissionService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    submission,
  )
  const headers = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
    'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
  }
  try {
    const noCsrf = await fetch(`${runtime.baseUrl}/api/v1/submission-url-checks`, {
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': '' },
      body: JSON.stringify({
        raw_url: 'https://portfolio.example',
        category_hint: 'personal_site_portfolio',
        client_request_id: 'submission-check-request-0001',
      }),
    })
    assert.equal(noCsrf.status, 403)
    assert.equal(submission.checkCommand, null)

    const checked = await fetch(`${runtime.baseUrl}/api/v1/submission-url-checks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        raw_url: 'https://portfolio.example',
        category_hint: 'personal_site_portfolio',
        client_request_id: 'submission-check-request-0001',
      }),
    })
    assert.equal(checked.status, 201)
    assert.equal(submission.getCheckCommand()?.userId, session.userId)
    assert.equal(submission.getCheckCommand()?.categoryHint, 'personal_site_portfolio')

    const created = await fetch(`${runtime.baseUrl}/api/v1/submission-drafts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        check_id: submission.check.check_id,
        category_id: 'personal_site_portfolio',
        client_request_id: 'submission-draft-request-0001',
      }),
    })
    assert.equal(created.status, 201)
    assert.equal(submission.getCreateCommand()?.checkId, submission.check.check_id)

    const loaded = await fetch(
      `${runtime.baseUrl}/api/v1/submission-drafts/${submission.draft.draft_id}`,
      { headers: { cookie: headers.cookie } },
    )
    assert.equal(loaded.status, 200)
    assert.equal(submission.getCommand?.userId, session.userId)

    const patched = await fetch(
      `${runtime.baseUrl}/api/v1/submission-drafts/${submission.draft.draft_id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          expected_version: 1,
          patch: { project_core: { current_name: 'Portfolio' } },
          operation_id: 'submission-patch-request-0001',
        }),
      },
    )
    assert.equal(patched.status, 200)
    assert.equal((await patched.json() as { version: number }).version, 2)
    assert.equal(submission.getPatchCommand()?.expectedVersion, 1)
    assert.deepEqual(submission.getPatchCommand()?.patch, {
      project_core: { current_name: 'Portfolio' },
    })

    const previewed = await fetch(
      `${runtime.baseUrl}/api/v1/submission-drafts/${submission.draft.draft_id}/preview`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ expected_version: 2, check_id: submission.check.check_id }),
      },
    )
    assert.equal(previewed.status, 200)
    const preview = await previewed.json() as { preview_hash: string }
    assert.equal(submission.previewCommand?.expectedVersion, 2)

    const submitted = await fetch(`${runtime.baseUrl}/api/v1/submissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        draft_id: submission.draft.draft_id,
        draft_version: 2,
        check_id: submission.check.check_id,
        preview_hash: preview.preview_hash,
        submission_key: 'submission-submit-request-0001',
      }),
    })
    assert.equal(submitted.status, 202)
    const accepted = await submitted.json() as { review_status: string; project_id?: string }
    assert.equal(accepted.review_status, 'pending_review')
    assert.equal(accepted.project_id, undefined)
    assert.equal(submission.submitCommand?.submissionKey, 'submission-submit-request-0001')

    const revision = await fetch(
      `${runtime.baseUrl}/api/v1/submissions/84000000-0000-4000-8000-000000000006/revision-drafts`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          base_submission_id: '84000000-0000-4000-8000-000000000006',
          expected_submission_version: 2,
          client_request_id: 'submission-revision-request-0001',
        }),
      },
    )
    assert.equal(revision.status, 201)
    assert.equal((await revision.json() as { draft_revision: number }).draft_revision, 2)
    assert.equal(submission.revisionCommand?.submissionId, '84000000-0000-4000-8000-000000000006')
    assert.equal(submission.revisionCommand?.expectedSubmissionVersion, 2)

    const withdrawn = await fetch(
      `${runtime.baseUrl}/api/v1/submissions/84000000-0000-4000-8000-000000000006/withdraw`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expected_version: 1,
          operation_id: 'submission-withdraw-request-0001',
          reason_code: 'owner_cancelled',
        }),
      },
    )
    assert.equal(withdrawn.status, 200)
    const cancellation = await withdrawn.json() as {
      review_status: string
      work_item_status: string
    }
    assert.deepEqual(cancellation, {
      submission_id: '84000000-0000-4000-8000-000000000006',
      review_status: 'withdrawn',
      submission_version: 2,
      review_work_item_id: '84000000-0000-4000-8000-000000000007',
      work_item_status: 'cancelled',
      work_item_version: 2,
      withdrawn_at: '2026-08-10T00:01:00.000Z',
    })
    assert.equal(submission.withdrawCommand?.reasonCode, 'owner_cancelled')
  } finally {
    await runtime.stop()
  }
})

test('project update draft routes bind the session owner and never accept client authority fields', async () => {
  const projectUpdates = new FakeProjectUpdateService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    projectUpdates,
  )
  const headers = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
    'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
  }
  const targetProjectId = '62000000-0000-4000-8000-000000000001'
  const baseVersionId = '63000000-0000-4000-8000-000000000001'
  const targetUpdateId = '64000000-0000-4000-8000-000000000001'
  try {
    const noCsrf = await fetch(`${runtime.baseUrl}/api/v1/project-updates`, {
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': '' },
      body: JSON.stringify({
        project_id: targetProjectId,
        update_type: 'description',
        base_version_id: baseVersionId,
        client_request_id: 'project-update-create-0001',
      }),
    })
    assert.equal(noCsrf.status, 403)
    assert.equal(projectUpdates.createCommand, null)

    const created = await fetch(`${runtime.baseUrl}/api/v1/project-updates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: targetProjectId,
        update_type: 'description',
        base_version_id: baseVersionId,
        client_request_id: 'project-update-create-0001',
      }),
    })
    assert.equal(created.status, 201)
    assert.equal(projectUpdates.getCreateCommand()?.userId, session.userId)

    const loaded = await fetch(`${runtime.baseUrl}/api/v1/project-updates/${targetUpdateId}`, {
      headers: { cookie: headers.cookie },
    })
    assert.equal(loaded.status, 200)
    assert.equal(projectUpdates.getCommand?.userId, session.userId)

    const forbiddenAuthority = await fetch(`${runtime.baseUrl}/api/v1/project-updates/${targetUpdateId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expected_version: 1,
        diff: [{ field_path: '/project_core/current_name', after_value: 'After' }],
        evidence_draft_ids: [],
        media_reference_ids: [],
        operation_id: 'project-update-patch-0001',
        creator_id: 'client-forged',
      }),
    })
    assert.equal(forbiddenAuthority.status, 422)
    assert.equal(projectUpdates.patchCommand, null)

    const patched = await fetch(`${runtime.baseUrl}/api/v1/project-updates/${targetUpdateId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expected_version: 1,
        diff: [{ field_path: '/project_core/current_name', after_value: 'After' }],
        evidence_draft_ids: [],
        media_reference_ids: [],
        operation_id: 'project-update-patch-0001',
      }),
    })
    assert.equal(patched.status, 200)
    assert.equal(projectUpdates.getPatchCommand()?.userId, session.userId)
    assert.deepEqual(projectUpdates.getPatchCommand()?.diff, [
      { field_path: '/project_core/current_name', after_value: 'After' },
    ])

    const previewed = await fetch(`${runtime.baseUrl}/api/v1/project-updates/${targetUpdateId}/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expected_version: 2 }),
    })
    assert.equal(previewed.status, 200)
    assert.equal(projectUpdates.previewCommand?.expectedVersion, 2)
    const previewBody = await previewed.json() as { preview_hash: string }

    const submitted = await fetch(`${runtime.baseUrl}/api/v1/project-updates/${targetUpdateId}/submit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: 2,
        preview_hash: previewBody.preview_hash,
        submission_key: 'project-update-submit-0001',
      }),
    })
    assert.equal(submitted.status, 202)
    assert.equal(projectUpdates.submitCommand?.userId, session.userId)

    const withdrawn = await fetch(`${runtime.baseUrl}/api/v1/project-updates/${targetUpdateId}/withdraw`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        expected_version: 3,
        operation_id: 'project-update-withdraw-0001',
        reason_code: 'owner_cancelled',
      }),
    })
    assert.equal(withdrawn.status, 200)
    assert.equal(projectUpdates.withdrawCommand?.reasonCode, 'owner_cancelled')
  } finally {
    await runtime.stop()
  }
})

test('verification draft routes bind the applicant, require CSRF, and keep identity fields server-authoritative', async () => {
  const verificationRequests = new FakeVerificationRequestService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    verificationRequests,
  )
  const headers = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
    'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
  }
  const verificationId = '69000000-0000-4000-8000-000000000001'
  try {
    const noCsrf = await fetch(`${runtime.baseUrl}/api/v1/verification-requests`, {
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': '' },
      body: JSON.stringify({
        project_id: '62000000-0000-4000-8000-000000000001',
        creator_resolution_mode: 'create_new_creator',
        new_creator_profile_input: { display_name: 'Creator' },
        idempotency_key: 'verification-create-0001',
      }),
    })
    assert.equal(noCsrf.status, 403)
    assert.equal(verificationRequests.createCommand, null)

    const forged = await fetch(`${runtime.baseUrl}/api/v1/verification-requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: '62000000-0000-4000-8000-000000000001',
        creator_resolution_mode: 'create_new_creator',
        new_creator_profile_input: { display_name: 'Creator' },
        idempotency_key: 'verification-create-0001',
        applicant_user_id: 'client-forged',
      }),
    })
    assert.equal(forged.status, 422)
    assert.equal(verificationRequests.createCommand, null)

    const created = await fetch(`${runtime.baseUrl}/api/v1/verification-requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: '62000000-0000-4000-8000-000000000001',
        creator_resolution_mode: 'create_new_creator',
        new_creator_profile_input: { display_name: 'Creator' },
        idempotency_key: 'verification-create-0001',
      }),
    })
    assert.equal(created.status, 201)
    assert.equal(verificationRequests.getCreateCommand()?.userId, session.userId)
    const createdBody = await created.json() as Record<string, unknown>
    assert.equal(Object.hasOwn(createdBody, 'applicant_user_id'), false)

    const loaded = await fetch(`${runtime.baseUrl}/api/v1/verification-requests/${verificationId}`, {
      headers: { cookie: headers.cookie },
    })
    assert.equal(loaded.status, 200)
    assert.equal(verificationRequests.getGetCommand()?.userId, session.userId)
    const reviewerLoaded=await fetch(`${runtime.baseUrl}/api/v1/verification-requests/${verificationId}`,{
      headers:{cookie:headers.cookie,'x-review-claim-token':'c'.repeat(43)},
    })
    assert.equal(reviewerLoaded.status,200)
    assert.equal((await reviewerLoaded.json() as Record<string,unknown>).viewer_schema,'reviewer')

    const patched = await fetch(`${runtime.baseUrl}/api/v1/verification-requests/${verificationId}`, {
      method: 'PATCH',
      headers: { ...headers, 'idempotency-key': 'verification-patch-0001' },
      body: JSON.stringify({
        expected_version: 1,
        creator_resolution_mode: 'create_new_creator',
        new_creator_profile_input: { display_name: 'Creator' },
        requested_link_role: 'owner',
        method: 'official_domain_control',
        public_summary: 'I control the official project domain.',
      }),
    })
    assert.equal(patched.status, 200)
    assert.equal(verificationRequests.getPatchCommand()?.userId, session.userId)
    assert.equal(verificationRequests.getPatchCommand()?.operationId, 'verification-patch-0001')
    const submitted=await fetch(`${runtime.baseUrl}/api/v1/verification-requests/${verificationId}/submit`,{
      method:'POST',headers,body:JSON.stringify({expected_version:2,
        material_ids:['6a000000-0000-4000-8000-000000000001'],submission_key:'verification-submit-0001'}),
    })
    assert.equal(submitted.status,202)
    assert.equal(verificationRequests.submitCommand?.userId,session.userId)
    const supplemented=await fetch(`${runtime.baseUrl}/api/v1/verification-requests/${verificationId}/supplements`,{
      method:'POST',headers,body:JSON.stringify({expected_version:3,
        material_ids:['6a000000-0000-4000-8000-000000000001'],evidence_refs:[],
        operation_id:'verification-supplement-0001'}),
    })
    assert.equal(supplemented.status,202)
    assert.equal(verificationRequests.supplementCommand?.operationId,'verification-supplement-0001')
    const withdrawn=await fetch(`${runtime.baseUrl}/api/v1/verification-requests/${verificationId}/withdraw`,{
      method:'POST',headers,body:JSON.stringify({expected_version:4,
        operation_id:'verification-withdraw-0001',reason_code:'applicant_cancelled'}),
    })
    assert.equal(withdrawn.status,200)
    assert.equal(verificationRequests.withdrawCommand?.reasonCode,'applicant_cancelled')
  } finally {
    await runtime.stop()
  }
})

test('private verification material routes bind ownership and return only applicant-safe projections', async () => {
  const privateMaterials = new FakePrivateMaterialService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, privateMaterials,
  )
  const headers = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
    'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
  }
  const materialId = '6a000000-0000-4000-8000-000000000001'
  try {
    const noCsrf = await fetch(`${runtime.baseUrl}/api/v1/verification-materials`, {
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': '' },
      body: JSON.stringify({
        verification_id: '69000000-0000-4000-8000-000000000001',
        declared_mime: 'application/pdf', byte_size: 4, checksum: 'a'.repeat(64),
        idempotency_key: 'material-prepare-0001',
      }),
    })
    assert.equal(noCsrf.status, 403)
    assert.equal(privateMaterials.prepareCommand, null)

    const prepared = await fetch(`${runtime.baseUrl}/api/v1/verification-materials`, {
      method: 'POST', headers,
      body: JSON.stringify({
        verification_id: '69000000-0000-4000-8000-000000000001',
        declared_mime: 'application/pdf', byte_size: 4, checksum: 'a'.repeat(64),
        idempotency_key: 'material-prepare-0001',
      }),
    })
    assert.equal(prepared.status, 201)
    assert.equal(privateMaterials.getPrepareCommand()?.userId, session.userId)
    const preparedBody = await prepared.json() as Record<string, unknown>
    assert.equal(Object.hasOwn(preparedBody, 'storage_key'), false)
    assert.equal(Object.hasOwn(preparedBody, 'scan_result'), false)
    assert.deepEqual(Object.keys(preparedBody.upload_headers as Record<string, string>).sort(), [
      'content-type','if-none-match','x-amz-checksum-sha256',
      'x-amz-server-side-encryption','x-amz-tagging',
    ])

    const loaded = await fetch(`${runtime.baseUrl}/api/v1/verification-materials/${materialId}`, {
      headers: { cookie: headers.cookie },
    })
    assert.equal(loaded.status, 200)
    assert.equal(privateMaterials.getGetCommand()?.userId, session.userId)
    const loadedBody = await loaded.json() as Record<string, unknown>
    assert.deepEqual(Object.keys(loadedBody).sort(), [
      'applicant_scan_state','material_id','next_action','reason_key',
      'upload_expires_at','verification_id','version',
    ])
    const reviewerLoaded=await fetch(`${runtime.baseUrl}/api/v1/verification-materials/${materialId}`,{
      headers:{cookie:headers.cookie,'x-review-claim-token':'c'.repeat(43)},
    })
    assert.equal(reviewerLoaded.status,200)
    const reviewerBody=await reviewerLoaded.json() as Record<string,unknown>
    assert.equal(reviewerBody.read_grant_eligibility,'eligible')
    assert.equal(Object.hasOwn(reviewerBody,'storage_key'),false)
    const grant=await fetch(`${runtime.baseUrl}/api/v1/verification-materials/${materialId}/read-grants`,{
      method:'POST',headers:{...headers,'x-review-claim-token':'c'.repeat(43)},
      body:JSON.stringify({purpose:'author_verification_review',operation_id:'material-read-grant-0001'}),
    })
    assert.equal(grant.status,201)
    const redeemed=await fetch(`${runtime.baseUrl}/api/v1/verification-material-read-grants/${'g'.repeat(43)}`,{
      headers:{cookie:headers.cookie},redirect:'manual',
    })
    assert.equal(redeemed.status,302)
    assert.equal(redeemed.headers.get('location'),'https://private.example/read')

    const completed = await fetch(`${runtime.baseUrl}/api/v1/verification-materials/${materialId}/complete`, {
      method: 'POST', headers,
      body: JSON.stringify({
        checksum: 'a'.repeat(64), upload_receipt: 'upload-receipt-0001',
        operation_id: 'material-complete-0001',
      }),
    })
    assert.equal(completed.status, 202)
    assert.equal(privateMaterials.getCompleteCommand()?.userId, session.userId)

    const revoked = await fetch(`${runtime.baseUrl}/api/v1/verification-materials/${materialId}/revoke`, {
      method: 'POST', headers,
      body: JSON.stringify({
        expected_version: 2, reason_code: 'user_removed', operation_id: 'material-revoke-0001',
      }),
    })
    assert.equal(revoked.status, 200)
    assert.equal(privateMaterials.getRevokeCommand()?.userId, session.userId)
  } finally {
    await runtime.stop()
  }
})

class FakePendingActionService implements ApiPendingActionService {
  status: 'pending' | 'consumed' | 'cancelled' = 'pending'
  createCommand: CreatePendingActionCommand | null = null
  getCommand: GetPendingActionCommand | null = null
  executionCommand: GetPendingActionExecutionCommand | null = null
  completeCommand: CompletePendingActionExecutionCommand | null = null
  cancelCommand: CancelPendingActionCommand | null = null

  getCompleteCommand(): CompletePendingActionExecutionCommand | null {
    return this.completeCommand
  }

  async create(command: CreatePendingActionCommand): Promise<PendingActionProjection> {
    this.createCommand = command
    return this.projection('pending')
  }

  async get(command: GetPendingActionCommand): Promise<PendingActionProjection> {
    this.getCommand = command
    return this.projection(this.status)
  }

  async getForExecution(
    command: GetPendingActionExecutionCommand,
  ): Promise<PendingActionExecutionProjection> {
    this.executionCommand = command
    return Object.freeze({
      ...this.projection('pending'),
      payload: Object.freeze({
        action_type: 'set_project_favorite' as const,
        project_id: '63000000-0000-4000-8000-000000000002',
        state: true,
      }),
      client_request_id: '63000000-0000-4000-8000-000000000003',
    })
  }

  async completeExecution(
    command: CompletePendingActionExecutionCommand,
  ): Promise<PendingActionProjection> {
    this.completeCommand = command
    this.status = 'consumed'
    return this.projection('consumed')
  }

  async cancel(command: CancelPendingActionCommand): Promise<PendingActionProjection> {
    this.cancelCommand = command
    this.status = 'cancelled'
    return this.projection('cancelled')
  }

  private projection(status: 'pending' | 'consumed' | 'cancelled'): PendingActionProjection {
    return Object.freeze({
      pending_action_id: '63000000-0000-4000-8000-000000000001',
      action_type: 'set_project_favorite',
      return_to: '/projects/63000000-0000-4000-8000-000000000002',
      status,
      expires_at: '2026-08-10T00:15:00.000Z',
      consumed_at: status === 'consumed' ? '2026-08-10T00:00:00.000Z' : null,
      cancelled_at: status === 'cancelled' ? '2026-08-10T00:00:00.000Z' : null,
      cancel_reason: status === 'cancelled' ? 'user_cancelled' : null,
    })
  }
}

class FakePendingActionExecutor implements ApiPendingActionExecutor {
  input: Parameters<ApiPendingActionExecutor['execute']>[0] | null = null

  async execute(input: Parameters<ApiPendingActionExecutor['execute']>[0]) {
    this.input = input
    return Object.freeze({ status: 'executed' as const })
  }
}

class FailingPendingActionExecutor implements ApiPendingActionExecutor {
  async execute(): Promise<never> {
    throw new IdentityError('PENDING_ACTION_DOMAIN_WRITE_FAILED', 503, true)
  }
}

class CancellingPendingActionExecutor implements ApiPendingActionExecutor {
  async execute() {
    return Object.freeze({
      status: 'cancelled' as const,
      reason: 'account_comparison_preserved' as const,
    })
  }
}

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`))
  assert(match?.[1])
  return decodeURIComponent(match[1])
}

test('pending actions bind an anonymous owner, hide payloads, and cancel idempotently', async () => {
  const pending = new FakePendingActionService()
  const runtime = await start(
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pending,
  )
  const pendingActionId = '63000000-0000-4000-8000-000000000001'
  try {
    const created = await fetch(`${runtime.baseUrl}/api/v1/auth/pending-actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({
        action_type: 'set_project_favorite',
        parameters: {
          project_id: '63000000-0000-4000-8000-000000000002',
          state: true,
        },
        return_to: '/projects/63000000-0000-4000-8000-000000000002',
        client_request_id: '63000000-0000-4000-8000-000000000003',
      }),
    })
    assert.equal(created.status, 201)
    const createdBody = await created.json() as Record<string, unknown>
    assert.equal(createdBody.status, 'pending')
    assert.equal('parameters' in createdBody, false)
    const anonymousCookie = cookieValue(created.headers.get('set-cookie') ?? '', 'vc_anon')
    assert.equal(pending.createCommand?.subject.kind, 'anonymous')

    const recovered = await fetch(`${runtime.baseUrl}/api/v1/auth/pending-actions/${pendingActionId}`, {
      headers: { cookie: `vc_anon=${encodeURIComponent(anonymousCookie)}` },
    })
    assert.equal(recovered.status, 200)
    assert.equal(pending.getCommand?.identityLinkId, null)

    const cancelled = await fetch(
      `${runtime.baseUrl}/api/v1/auth/pending-actions/${pendingActionId}/cancel`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://web.example',
          cookie: `vc_anon=${encodeURIComponent(anonymousCookie)}`,
        },
        body: JSON.stringify({
          cancel_reason: 'user_cancelled',
          client_request_id: '63000000-0000-4000-8000-000000000004',
        }),
      },
    )
    assert.equal(cancelled.status, 200)
    assert.equal((await cancelled.json() as { status: string }).status, 'cancelled')
    assert.equal(pending.cancelCommand?.identityLinkId, null)
  } finally {
    await runtime.stop()
  }
})

test('pending action replay requires session CSRF and creates its receipt only after domain success', async () => {
  const pending = new FakePendingActionService()
  const executor = new FakePendingActionExecutor()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pending,
    undefined,
    executor,
  )
  const pendingActionId = '63000000-0000-4000-8000-000000000001'
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  const request = (withCsrf: boolean, extra: Record<string, unknown> = {}) => fetch(
    `${runtime.baseUrl}/api/v1/auth/pending-actions/${pendingActionId}/consume`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: sessionCookie,
        ...(withCsrf ? { 'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters' } : {}),
      },
      body: JSON.stringify({
        identity_link_id: '63000000-0000-4000-8000-000000000005',
        expected_status: 'pending',
        ...extra,
      }),
    },
  )
  try {
    assert.equal((await request(false)).status, 403)
    assert.equal(pending.completeCommand, null)
    assert.equal((await request(true, { execution_receipt: 'browser-forged' })).status, 422)
    assert.equal(pending.completeCommand, null)
    const consumed = await request(true)
    assert.equal(consumed.status, 200)
    assert.equal((await consumed.json() as { status: string }).status, 'consumed')
    assert.equal(executor.input?.action.client_request_id, '63000000-0000-4000-8000-000000000003')
    const completed = pending.getCompleteCommand()
    assert.ok(completed)
    assert.equal(completed.subject.id, session.userId)
    assert.equal(completed.businessRequestId, '63000000-0000-4000-8000-000000000003')
    assert.equal(completed.expectedStatus, 'pending')
  } finally {
    await runtime.stop()
  }
})

test('pending action replay keeps pending on domain failure and returns consumed retries without a rewrite', async () => {
  const pending = new FakePendingActionService()
  const identity = new FakeIdentityService()
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  const body = JSON.stringify({
    identity_link_id: '63000000-0000-4000-8000-000000000005',
    expected_status: 'pending',
  })
  const request = (baseUrl: string) => fetch(
    `${baseUrl}/api/v1/auth/pending-actions/63000000-0000-4000-8000-000000000001/consume`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: sessionCookie,
        'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
      },
      body,
    },
  )
  const failing = await start(
    async () => undefined,
    identity,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pending,
    undefined,
    new FailingPendingActionExecutor(),
  )
  try {
    assert.equal((await request(failing.baseUrl)).status, 503)
    assert.equal(pending.completeCommand, null)
    assert.equal(pending.status, 'pending')
  } finally {
    await failing.stop()
  }

  const cancelling = await start(
    async () => undefined,
    identity,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pending,
    undefined,
    new CancellingPendingActionExecutor(),
  )
  try {
    const response = await request(cancelling.baseUrl)
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { status: string }).status, 'cancelled')
    assert.equal(pending.cancelCommand?.cancelReason, 'account_comparison_preserved')
  } finally {
    await cancelling.stop()
  }

  pending.status = 'consumed'
  pending.executionCommand = null
  const retried = await start(
    async () => undefined,
    identity,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pending,
  )
  try {
    const response = await request(retried.baseUrl)
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { status: string }).status, 'consumed')
    assert.equal(pending.executionCommand, null)
  } finally {
    await retried.stop()
  }
})

test('search binds an active authenticated session to the user subject', async () => {
  const search = new FakeSearchService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    search,
  )
  try {
    const response = await fetch(`${runtime.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
      },
      body: JSON.stringify({ query: 'portfolio', mode: 'search' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(search.subject, { kind: 'user', id: session.userId })
  } finally {
    await runtime.stop()
  }
})

test('comparison save requires an authenticated session and matching CSRF token', async () => {
  const comparison = new FakeComparisonService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    comparison,
  )
  const comparisonId = '61000000-0000-4000-8000-000000000003'
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  const request = (csrf: boolean) => fetch(
    `${runtime.baseUrl}/api/v1/comparisons/${comparisonId}/saved`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: sessionCookie,
        ...(csrf ? { 'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters' } : {}),
      },
      body: JSON.stringify({ state: true, comparison_version: 1 }),
    },
  )
  try {
    const rejected = await request(false)
    assert.equal(rejected.status, 403)
    assert.equal(comparison.saveCommand, null)

    const saved = await request(true)
    assert.equal(saved.status, 200)
    assert.equal((await saved.json() as { saved_at: string | null }).saved_at, '2026-08-10T00:00:00.000Z')
    const savedCommand = comparison.getSaveCommand()
    assert.ok(savedCommand)
    assert.deepEqual(savedCommand.subject, { kind: 'user', id: session.userId })
    assert.equal(savedCommand.comparisonVersion, 1)
    assert.equal(savedCommand.state, true)
  } finally {
    await runtime.stop()
  }
})

test('project interaction requires login, writable account and matching CSRF before one final-state write', async () => {
  const projectId = '10000000-0000-4000-8000-000000000001'
  const path = `/api/v1/interactions/follow/project/${projectId}`
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  const body = JSON.stringify({ state: true, client_request_id: 'interaction_request_0001' })

  const anonymousCommunity = new FakeCommunityService()
  const anonymousRuntime = await start(
    async () => undefined,
    new RejectingIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    anonymousCommunity,
  )
  try {
    const rejected = await fetch(`${anonymousRuntime.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body,
    })
    assert.equal(rejected.status, 401)
    assert.equal(anonymousCommunity.command, null)
  } finally {
    await anonymousRuntime.stop()
  }

  const restrictedCommunity = new FakeCommunityService()
  const restrictedRuntime = await start(
    async () => undefined,
    new RestrictedIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    restrictedCommunity,
  )
  try {
    const rejected = await fetch(`${restrictedRuntime.baseUrl}${path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: sessionCookie,
        'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
      },
      body,
    })
    assert.equal(rejected.status, 403)
    assert.equal(restrictedCommunity.command, null)
  } finally {
    await restrictedRuntime.stop()
  }

  const community = new FakeCommunityService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    community,
  )
  try {
    const missingCsrf = await fetch(`${runtime.baseUrl}${path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: sessionCookie,
      },
      body,
    })
    assert.equal(missingCsrf.status, 403)
    assert.equal(community.command, null)

    const written = await fetch(`${runtime.baseUrl}${path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'https://web.example',
        cookie: sessionCookie,
        'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
      },
      body,
    })
    assert.equal(written.status, 200)
    assert.deepEqual(community.command, {
      userId: session.userId,
      projectId,
      targetType: 'project',
      interactionType: 'follow',
      state: true,
      clientRequestId: 'interaction_request_0001',
    })
    assert.deepEqual((await written.json() as ProjectInteractionProjection).states, {
      favorite: true, like: false, follow: true,
    })
  } finally {
    await runtime.stop()
  }
})

test('notifications are authenticated, recipient-bound and use idempotent final read state', async () => {
  const notifications = new FakeNotificationService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    notifications,
  )
  const cookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  const headers = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie,
  }
  try {
    const listed = await fetch(
      `${runtime.baseUrl}/api/v1/notifications?type=submission_published&unread_only=true&limit=12`,
      { headers: { cookie } },
    )
    assert.equal(listed.status, 200)
    assert.deepEqual(notifications.listInput, {
      userId: session.userId,
      type: 'submission_published',
      unreadOnly: true,
      cursor: null,
      limit: 12,
    })
    assert.equal((await listed.json() as NotificationPage).unread_count, 1)

    const missingCsrf = await fetch(`${runtime.baseUrl}/api/v1/notifications/read-state`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        notification_ids: ['74000000-0000-4000-8000-000000000001'],
        read: true,
        operation_id: 'notification-read-0001',
      }),
    })
    assert.equal(missingCsrf.status, 403)
    assert.equal(notifications.readInput, null)

    const marked = await fetch(`${runtime.baseUrl}/api/v1/notifications/read-state`, {
      method: 'PUT',
      headers: { ...headers, 'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters' },
      body: JSON.stringify({
        notification_ids: ['74000000-0000-4000-8000-000000000001'],
        read: true,
        operation_id: 'notification-read-0001',
      }),
    })
    assert.equal(marked.status, 200)
    assert.deepEqual(notifications.readInput, {
      userId: session.userId,
      notificationIds: ['74000000-0000-4000-8000-000000000001'],
      operationId: 'notification-read-0001',
    })
    assert.equal((await marked.json() as NotificationReadProjection).changed_count, 1)
  } finally {
    await runtime.stop()
  }
})

test('comment list is public while create, report and withdraw bind the authenticated actor', async () => {
  const community = new FakeCommunityService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    community,
  )
  const projectId = '10000000-0000-4000-8000-000000000001'
  const commentId = '71000000-0000-4000-8000-000000000001'
  const sessionHeaders = {
    'content-type': 'application/json',
    origin: 'https://web.example',
    cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
    'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
  }
  try {
    const list = await fetch(
      `${runtime.baseUrl}/api/v1/projects/${projectId}/comments?sort=latest`,
    )
    assert.equal(list.status, 200)
    assert.deepEqual(community.listCommand, { projectId, cursor: null, sort: 'latest' })

    const created = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectId}/comments`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({
        body: '  new comment  ',
        parent_comment_id: null,
        client_request_id: 'comment_request_0001',
      }),
    })
    assert.equal(created.status, 201)
    assert.deepEqual(community.createCommand, {
      userId: session.userId,
      projectId,
      body: '  new comment  ',
      parentCommentId: null,
      clientRequestId: 'comment_request_0001',
    })

    const reported = await fetch(`${runtime.baseUrl}/api/v1/comments/${commentId}/reports`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({
        reason_code: 'spam',
        note: 'private note',
        client_request_id: 'report_request_0001',
      }),
    })
    assert.equal(reported.status, 201)
    assert.deepEqual(community.reportCommand, {
      userId: session.userId,
      commentId,
      reasonCode: 'spam',
      note: 'private note',
      clientRequestId: 'report_request_0001',
    })

    const withdrawn = await fetch(`${runtime.baseUrl}/api/v1/comments/${commentId}/withdraw`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ expected_version: 1, operation_id: 'withdraw_request_0001' }),
    })
    assert.equal(withdrawn.status, 200)
    assert.deepEqual(community.withdrawCommand, {
      userId: session.userId,
      commentId,
      expectedVersion: 1,
      operationId: 'withdraw_request_0001',
    })
  } finally {
    await runtime.stop()
  }
})

test('comparison merge conflict APIs require a user session, CSRF, and exact optimistic versions', async () => {
  const comparison = new FakeComparisonService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    undefined,
    undefined,
    comparison,
  )
  const conflictId = '62000000-0000-4000-8000-000000000001'
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  try {
    const recovered = await fetch(
      `${runtime.baseUrl}/api/v1/auth/comparison-merge-conflicts/${conflictId}`,
      { headers: { cookie: sessionCookie } },
    )
    assert.equal(recovered.status, 200)
    assert.deepEqual(comparison.getMergeCommand?.subject, { kind: 'user', id: session.userId })

    const resolveBody = {
      selected_project_ids: ['10000000-0000-4000-8000-000000000001'],
      account_version: 2,
      anonymous_version: 3,
      expected_conflict_version: 1,
      operation_id: '63000000-0000-4000-8000-000000000001',
    }
    const rejected = await fetch(
      `${runtime.baseUrl}/api/v1/auth/comparison-merge-conflicts/${conflictId}/resolve`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
        },
        body: JSON.stringify(resolveBody),
      },
    )
    assert.equal(rejected.status, 403)
    assert.equal(comparison.resolveMergeCommand, null)

    const resolved = await fetch(
      `${runtime.baseUrl}/api/v1/auth/comparison-merge-conflicts/${conflictId}/resolve`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify(resolveBody),
      },
    )
    assert.equal(resolved.status, 200)
    const resolveCommand = comparison.getResolveMergeCommand()
    assert.ok(resolveCommand)
    assert.equal(resolveCommand.accountVersion, 2)
    assert.equal(resolveCommand.anonymousVersion, 3)
    assert.deepEqual(resolveCommand.selectedProjectIds, resolveBody.selected_project_ids)

    const cancelled = await fetch(
      `${runtime.baseUrl}/api/v1/auth/comparison-merge-conflicts/${conflictId}/cancel`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({
          cancel_reason: 'user_closed',
          expected_conflict_version: 1,
          operation_id: '63000000-0000-4000-8000-000000000002',
        }),
      },
    )
    assert.equal(cancelled.status, 200)
    assert.equal(comparison.cancelMergeCommand?.cancelReason, 'user_closed')
  } finally {
    await runtime.stop()
  }
})

test('query lifecycle exposes structured recovery and enforces session CSRF on identity linking', async () => {
  const search = new FakeSearchService()
  const runtime = await start(
    async () => undefined,
    new FakeIdentityService(),
    undefined,
    undefined,
    search,
  )
  const queryId = '90000000-0000-4000-8000-000000000001'
  const sessionCookie = 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters'
  try {
    const recovered = await fetch(`${runtime.baseUrl}/api/v1/query-snapshots/${queryId}`, {
      headers: { cookie: sessionCookie },
    })
    assert.equal(recovered.status, 200)
    const recovery = await recovered.json() as Record<string, unknown>
    assert.equal(recovery.input_state, 'not_restored')
    assert.equal('query' in recovery, false)
    assert.deepEqual(search.lifecycleSubject, { kind: 'user', id: session.userId })

    const rejected = await fetch(
      `${runtime.baseUrl}/api/v1/query-snapshots/${queryId}/authorized-subjects`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
        },
        body: JSON.stringify({
          identity_link_id: '99999999-9999-4999-8999-999999999999',
          expected_version: 1,
          operation_id: '98000000-0000-4000-8000-000000000001',
        }),
      },
    )
    assert.equal(rejected.status, 403)

    const linked = await fetch(
      `${runtime.baseUrl}/api/v1/query-snapshots/${queryId}/authorized-subjects`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://web.example',
          'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
        },
        body: JSON.stringify({
          identity_link_id: '99999999-9999-4999-8999-999999999999',
          expected_version: 1,
          operation_id: '98000000-0000-4000-8000-000000000001',
        }),
      },
    )
    assert.equal(linked.status, 200)
    assert.equal((await linked.json() as { authorized: boolean }).authorized, true)
  } finally {
    await runtime.stop()
  }
})

test('email OTP flow establishes signed browser cookies and a server session', async () => {
  const identity = new FakeIdentityService()
  const comparison = new FakeComparisonService()
  const runtime = await start(
    async () => undefined,
    identity,
    undefined,
    undefined,
    undefined,
    undefined,
    comparison,
  )
  try {
    const challenge = await fetch(`${runtime.baseUrl}/api/v1/auth/email-challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({
        email: 'user@example.com',
        purpose: 'login',
        return_to: '/me',
        client_request_id: '44444444-4444-4444-8444-444444444444',
      }),
    })
    assert.equal(challenge.status, 202)
    assert.equal((await challenge.json() as { masked_email: string }).masked_email, 'u***@example.com')
    const challengeCookies = challenge.headers.get('set-cookie') ?? ''
    assert.match(challengeCookies, /vc_anon=/)
    assert.match(challengeCookies, /vc_auth_flow=/)
    assert.match(challengeCookies, /HttpOnly/)
    assert.match(challengeCookies, /SameSite=Lax/)
    assert.equal(identity.startCommand?.email, 'user@example.com')
    assert.equal(identity.startCommand?.pendingActionId, null)

    const browserBinding = cookieValue(challengeCookies, 'vc_auth_flow')
    const anonymous = cookieValue(challengeCookies, 'vc_anon')
    const verification = await fetch(
      `${runtime.baseUrl}/api/v1/auth/email-challenges/33333333-3333-4333-8333-333333333333/verify`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `vc_anon=${encodeURIComponent(anonymous)}; vc_auth_flow=${encodeURIComponent(browserBinding)}`,
          origin: 'https://web.example',
        },
        body: JSON.stringify({
          auth_flow_id: '22222222-2222-4222-8222-222222222222',
          otp: '123456',
          client_request_id: '55555555-5555-4555-8555-555555555555',
        }),
      },
    )
    assert.equal(verification.status, 200)
    const verificationBody = await verification.json() as {
      purpose: string
      identity_links: readonly { identity_link_id: string; purpose: string; expires_at: string }[]
      comparison_merge: { result: string } | null
    }
    assert.equal(verificationBody.purpose, 'login')
    assert.deepEqual(verificationBody.identity_links, [
      {
        identity_link_id: '99999999-9999-4999-8999-999999999999',
        purpose: 'query_continuation',
        expires_at: '2026-08-10T00:05:00.000Z',
      },
      {
        identity_link_id: '99999999-9999-4999-8999-999999999998',
        purpose: 'comparison_merge',
        expires_at: '2026-08-10T00:05:00.000Z',
      },
    ])
    assert.equal(verificationBody.comparison_merge?.result, 'not_required')
    assert.deepEqual(comparison.prepareMergeCommand, {
      userId: session.userId,
      anonymousSubjectId: '77777777-7777-4777-8777-777777777777',
      identityLinkId: '99999999-9999-4999-8999-999999999998',
      operationId: '55555555-5555-4555-8555-555555555555',
      pendingActionId: null,
    })
    assert.equal(identity.verifyCommand?.browserBindingToken, browserBinding)
    const sessionCookies = verification.headers.get('set-cookie') ?? ''
    assert.match(sessionCookies, /vc_session=/)
    assert.match(sessionCookies, /vc_csrf=/)

    const current = await fetch(`${runtime.baseUrl}/api/v1/auth/session`, {
      headers: {
        cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
      },
    })
    assert.equal(current.status, 200)
    assert.equal((await current.json() as { user_id: string }).user_id, session.userId)

    const logout = await fetch(`${runtime.baseUrl}/api/v1/auth/session`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'vc_session=session-token-with-at-least-thirty-two-characters; vc_csrf=csrf-token-with-at-least-thirty-two-characters',
        origin: 'https://web.example',
        'x-csrf-token': 'csrf-token-with-at-least-thirty-two-characters',
      },
      body: JSON.stringify({ session_version: 1 }),
    })
    assert.equal(logout.status, 204)
    assert.equal(identity.logoutVersion, 1)
  } finally {
    await runtime.stop()
  }
})

test('authentication writes reject missing Origin and unknown input fields', async () => {
  const identity = new FakeIdentityService()
  const runtime = await start(async () => undefined, identity)
  try {
    const missingOrigin = await fetch(`${runtime.baseUrl}/api/v1/auth/email-challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(missingOrigin.status, 403)

    const unknownField = await fetch(`${runtime.baseUrl}/api/v1/auth/email-challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://web.example' },
      body: JSON.stringify({ unexpected: true }),
    })
    assert.equal(unknownField.status, 422)
    assert.equal(
      (await unknownField.json() as { error: { code: string } }).error.code,
      'REQUEST_FIELD_UNKNOWN',
    )
  } finally {
    await runtime.stop()
  }
})

test('CORS preflight reflects only an explicitly configured web origin', async () => {
  const runtime = await start(async () => undefined)
  try {
    const allowed = await fetch(`${runtime.baseUrl}/api/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'https://web.example' },
    })
    assert.equal(allowed.status, 204)
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://web.example')
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')

    const denied = await fetch(`${runtime.baseUrl}/api/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example' },
    })
    assert.equal(denied.status, 204)
    assert.equal(denied.headers.get('access-control-allow-origin'), null)
  } finally {
    await runtime.stop()
  }
})

test('same-origin web hosting serves assets and falls back to the SPA entry document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecheck-static-'))
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>VibeCheck</title>')
  await writeFile(join(directory, 'app.js'), 'globalThis.vibecheck=true')
  const runtime = await start(async () => undefined, undefined, directory)
  try {
    const asset = await fetch(`${runtime.baseUrl}/app.js`)
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')

    const spa = await fetch(`${runtime.baseUrl}/project/example`)
    assert.equal(spa.status, 200)
    assert.match(await spa.text(), /VibeCheck/)
    assert.equal(spa.headers.get('cache-control'), 'no-store')
    assert.equal(spa.headers.get('x-frame-options'), 'DENY')
  } finally {
    await runtime.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

const projectCard = Object.freeze({
  project_id: '11111111-1111-4111-8111-111111111111',
  version_id: '22222222-2222-4222-8222-222222222222',
  current_name: 'Fixture Project',
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  one_line_definition: '把资料转换为练习内容',
  cover_media_reference_ids: Object.freeze(['cover-reference']),
  access_status: 'normal',
  review_status: 'published_platform',
  last_verified_at: '2026-08-10T00:00:00.000Z',
  creator_summaries: Object.freeze([]),
  ai_coding_tools: Object.freeze({
    knowledge_state: 'unknown',
    values: Object.freeze([]),
    source_type: 'system_inference',
    observed_at: '2026-08-10T00:00:00.000Z',
  }),
  interaction_summary: Object.freeze({
    favorite_count: 0,
    like_count: 0,
    follower_count: 0,
    visible_comment_count: 0,
  }),
  latest_event_summary: null,
  read_version: 1,
} as const)

class FakeCatalogService implements ApiCatalogService {
  listInput: Parameters<ApiCatalogService['listProjects']>[0] | null = null
  eventInput: Parameters<ApiCatalogService['listProjectEvents']>[0] | null = null
  publicEventInput: Parameters<ApiCatalogService['listPublicEvents']>[0] | null = null
  assetInput: Parameters<ApiCatalogService['listProjectAssets']>[0] | null = null

  async listProjects(input: Parameters<ApiCatalogService['listProjects']>[0]): Promise<ProjectListProjection> {
    this.listInput = input
    return Object.freeze({
      items: Object.freeze([projectCard]),
      next_cursor: null,
      result_version: 'a'.repeat(64),
    })
  }

  async getProject(): Promise<ProjectProjection> {
    return Object.freeze({
      ...projectCard,
      viewer_schema: 'public',
      visibility: 'public',
      project_core: Object.freeze({
        current_name: 'Fixture Project',
        public_url: 'https://fixture.example.com',
        repository_url: null,
        original_platform: null,
        cover_media_reference_ids: Object.freeze(['cover-reference']),
        one_line_definition: '把资料转换为练习内容',
        ai_coding_tools: projectCard.ai_coding_tools,
        tech_stack: Object.freeze([]),
        deployment_platform: null,
        access_status: 'normal',
        maintenance_signal: 'unknown',
        status_note: null,
      }),
      category_data: Object.freeze({
        target_users: Object.freeze(['university_students']),
        core_problem: '资料难以直接练习',
        use_scenarios: Object.freeze(['daily_practice']),
        main_inputs: Object.freeze(['pdf']),
        main_outputs: Object.freeze(['questions']),
        core_flow: Object.freeze([Object.freeze({ order: 1, name: '上传资料' })]),
        content_processing: Object.freeze([]),
        practice_formats: Object.freeze([]),
        feedback_methods: Object.freeze([]),
        learning_records: Object.freeze([]),
        differentiation: null,
        core_features: Object.freeze([]),
        secondary_features: Object.freeze([]),
        login_requirement: 'unknown',
        sharing_capability: 'unknown',
      }),
      first_seen_at: '2026-08-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
      author_link_status: 'unlinked',
      completeness_level: 'complete',
      freshness_status: 'valid',
      record_source: 'platform_editor',
      evidence_summaries: Object.freeze([]),
      relations: Object.freeze([]),
    })
  }

  async listProjectEvents(input: Parameters<ApiCatalogService['listProjectEvents']>[0]): Promise<EventPage> {
    this.eventInput = input
    return Object.freeze({
      items: Object.freeze([Object.freeze({
        event_id: '55555555-5555-4555-8555-555555555555',
        project_id: projectCard.project_id,
        version_id: projectCard.version_id,
        event_type: 'version_updated',
        category_change_type: null,
        event_time: '2026-08',
        time_precision: 'month',
        event_sort_at: '2026-08-01T00:00:00.000Z',
        event_sort_rule_version: 'event_sort.v1',
        event_summary: '更新练习流程',
        source_actor: 'verified_author',
        lifecycle_status: 'published',
        supersedes_event_id: null,
        evidence_summaries: Object.freeze([]),
        evidence_dispute_summary: 'none',
        project_summary: Object.freeze({
          project_id: projectCard.project_id,
          current_name: projectCard.current_name,
          category_id: projectCard.category_id,
          access_status: projectCard.access_status,
        }),
      })]),
      next_cursor: null,
    })
  }

  async listPublicEvents(input: Parameters<ApiCatalogService['listPublicEvents']>[0]): Promise<EventPage> {
    this.publicEventInput=input
    return Object.freeze({items:Object.freeze([]),next_cursor:null})
  }

  async getCategoryTaxonomy(): Promise<Awaited<ReturnType<ApiCatalogService['getCategoryTaxonomy']>>> {
    return Object.freeze({
      category_id: 'ai_learning_quiz',
      schema_version: 'learning.v1',
      name: 'AI 学习与练习工具',
      description: '学习工具分类',
      order: 10,
      status: 'active',
      dictionary_version: 1,
      project_count: 1,
      calculated_at: '2026-08-10T00:00:00.000Z',
      topics: Object.freeze([]),
      etag: 'a'.repeat(64),
    })
  }

  async getTopic(): Promise<Awaited<ReturnType<ApiCatalogService['getTopic']>>> {
    return Object.freeze({
      topic_id: '38000000-0000-4000-8000-000000000001',
      category_id: 'personal_site_portfolio',
      canonical_slug: 'personal-sites-portfolios',
      name: '个人主页与作品集',
      description: '作品集专题',
      config: Object.freeze({}),
      filter_snapshot: Object.freeze({ category_id: 'personal_site_portfolio', category_fields: {} }),
      order: 10,
      project_count: 1,
      calculated_at: '2026-08-10T00:00:00.000Z',
      dictionary_version: 1,
      alias_resolved: false,
      alias_chain_length: 0,
    })
  }

  async listProjectAssets(input: Parameters<ApiCatalogService['listProjectAssets']>[0]): Promise<AssetPage> {
    this.assetInput = input
    return Object.freeze({
      items: Object.freeze([Object.freeze({
        asset_id: '66666666-6666-4666-8666-666666666666',
        project_id: projectCard.project_id,
        asset_type: 'source_code',
        component_role: null,
        name: '源码仓库',
        description: '公开源码',
        availability_status: 'available',
        license_type: 'MIT',
        price_type: 'free',
        acquisition_method: 'fork',
        target_kind: 'safe_web_url',
        target_status: 'requires_resolve',
        evidence_summaries: Object.freeze([]),
        last_verified_at: '2026-08-10T00:00:00.000Z',
        read_version: 1,
      })]),
      next_cursor: null,
    })
  }

  async getCreator(): Promise<CreatorProjection> {
    return Object.freeze({
      creator_id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Fixture Creator',
      avatar_url: null,
      verification_status: 'verified',
      viewer_schema: 'public',
      bio: '',
      contacts: Object.freeze([]),
      published_project_ids: Object.freeze([projectCard.project_id]),
      read_version: 1,
    })
  }
}

test('public catalog routes preserve list query state and emit versioned cache validators', async () => {
  const catalog = new FakeCatalogService()
  const runtime = await start(async () => undefined, undefined, undefined, catalog)
  try {
    const list = await fetch(`${runtime.baseUrl}/api/v1/projects?category_id=ai_learning_quiz&limit=12`)
    assert.equal(list.status, 200)
    assert.equal(list.headers.get('cache-control'), 'public, max-age=30, stale-while-revalidate=60')
    assert.deepEqual(catalog.listInput, {
      categoryId: 'ai_learning_quiz',
      limit: 12,
      cursor: null,
    })
    assert.equal((await list.json() as { items: unknown[] }).items.length, 1)

    const publicEvents=await fetch(`${runtime.baseUrl}/api/v1/events?category_id=ai_learning_quiz&event_types=version_updated`)
    assert.equal(publicEvents.status,200)
    assert.deepEqual(catalog.publicEventInput,{
      categoryId:'ai_learning_quiz',eventTypes:['version_updated'],cursor:null,
    })

    const taxonomy=await fetch(`${runtime.baseUrl}/api/v1/taxonomies/ai_learning_quiz?version=1`)
    assert.equal(taxonomy.status,200)
    assert.equal(taxonomy.headers.get('etag'),`"taxonomy-${'a'.repeat(64)}"`)
    assert.equal((await taxonomy.json() as {dictionary_version:number}).dictionary_version,1)

    const topic=await fetch(`${runtime.baseUrl}/api/v1/topics/personal-sites-portfolios`)
    assert.equal(topic.status,200)
    assert.equal((await topic.json() as {canonical_slug:string}).canonical_slug,'personal-sites-portfolios')

    const detail = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectCard.project_id}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.headers.get('etag'), `W/"project-${projectCard.project_id}-1"`)
    assert.equal((await detail.json() as { viewer_schema: string }).viewer_schema, 'public')

    const creator = await fetch(`${runtime.baseUrl}/api/v1/creators/33333333-3333-4333-8333-333333333333`)
    assert.equal(creator.status, 200)
    assert.equal(creator.headers.get('etag'), 'W/"creator-33333333-3333-4333-8333-333333333333-1"')

    const events = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectCard.project_id}/events?event_types=version_updated&include_superseded=true`)
    assert.equal(events.status, 200)
    assert.deepEqual(catalog.eventInput, {
      projectId: projectCard.project_id,
      eventTypes: ['version_updated'],
      includeSuperseded: true,
      cursor: null,
    })
    assert.equal((await events.json() as { items: unknown[] }).items.length, 1)

    const assets = await fetch(`${runtime.baseUrl}/api/v1/projects/${projectCard.project_id}/assets`)
    assert.equal(assets.status, 200)
    assert.deepEqual(catalog.assetInput, { projectId: projectCard.project_id, cursor: null })
    assert.equal((await assets.json() as { items: unknown[] }).items.length, 1)
  } finally {
    await runtime.stop()
  }
})

test('public catalog routes reject duplicate, unknown and oversized pagination input', async () => {
  const runtime = await start(async () => undefined, undefined, undefined, new FakeCatalogService())
  try {
    for (const path of [
      '/api/v1/projects?limit=12&limit=13',
      '/api/v1/projects?unknown=true',
      '/api/v1/projects?limit=51',
    ]) {
      const response = await fetch(`${runtime.baseUrl}${path}`)
      assert.equal(response.status, 400)
      assert.match((await response.json() as { error: { code: string } }).error.code, /QUERY_PARAMETER_INVALID|LIMIT_INVALID/)
    }
  } finally {
    await runtime.stop()
  }
})

test('public event and asset routes reject malformed or duplicate query state', async () => {
  const runtime = await start(async () => undefined, undefined, undefined, new FakeCatalogService())
  const projectPath = `/api/v1/projects/${projectCard.project_id}`
  try {
    for (const path of [
      `${projectPath}/events?event_types=unknown`,
      `${projectPath}/events?event_types=version_updated,version_updated`,
      `${projectPath}/events?event_types=`,
      `${projectPath}/events?include_superseded=1`,
      `${projectPath}/events?cursor=a&cursor=b`,
      `${projectPath}/assets?unknown=true`,
    ]) {
      const response = await fetch(`${runtime.baseUrl}${path}`)
      assert.equal(response.status, 400)
    }
  } finally {
    await runtime.stop()
  }
})
