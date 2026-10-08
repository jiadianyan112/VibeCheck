/**
 * Local-only browser acceptance harness for the developer identity flow.
 *
 * This module deliberately uses a separate `developer_e2e` database. It will
 * refuse a non-local URL so a Playwright run cannot write production data.
 * The `example.com` DNS/HTTP result below is a test boundary fixture for the
 * submission URL safety check; production keeps its real resolver and probe.
 */
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { type AddressInfo, type Server } from 'node:net'

import pg, { type Pool } from 'pg'

import { createApiServer, close, listen } from '../../apps/api/src/server.js'
import {
  AssetWebSafetyResolver,
  CatalogService,
  CreatorAuthorReadService,
  DeveloperAccountService,
  PostgresAuthorAuthorizationResolver,
  PostgresCatalogStore,
  PostgresProjectUpdateApplier,
  PostgresProjectUpdateStore,
  PostgresPublishedProjectIndexer,
  PostgresUpdatedProjectIndexer,
  ProjectUpdateService,
} from '@vibecheck/catalog'
import type { IdentityConfig, ServiceConfig } from '@vibecheck/config'
import { checkDatabase, createDatabasePool, runMigrations } from '@vibecheck/database'
import {
  IdentityService,
  PostgresIdentityStore,
  encryptText,
  keyedHash,
} from '@vibecheck/identity'
import {
  PostgresPrivateMaterialStore,
  PrivateMaterialService,
} from '@vibecheck/private-material'
import {
  PostgresSubmissionPublisher,
  PostgresSubmissionStore,
  SubmissionService,
} from '@vibecheck/submission'
import {
  AdminOperationSecurityService,
  PostgresAdminOperationSecurityStore,
  PostgresReviewDecisionStore,
  PostgresVerificationRequestStore,
  PostgresWorkflowStore,
  ReviewDecisionService,
  VerificationRequestService,
  WorkflowService,
} from '@vibecheck/workflow'

const defaultDatabaseUrl = 'postgresql://vibecheck:vibecheck_ci_only@127.0.0.1:55438/developer_e2e'
const authTokenSecret = 'developer-live-e2e-auth-secret-0123456789'
const workflowTokenSecret = 'developer-live-e2e-workflow-secret-0123456789'
const emailEncryptionKey = Buffer.alloc(32, 19).toString('base64')
const privateMaterialEncryptionKey = Buffer.alloc(32, 23).toString('base64')
const now = new Date()
const staticDirectory = resolve(process.cwd(), 'dist')

export interface DeveloperLiveSession {
  readonly userId: string
  readonly email: string
  readonly sessionToken: string
  readonly csrfToken: string
  readonly roles: readonly ('user' | 'editor')[]
}

interface StoredIdSet {
  readonly userIds: Set<string>
  readonly verificationIds: Set<string>
  readonly materialIds: Set<string>
  readonly submissionIds: Set<string>
  readonly updateIds: Set<string>
  readonly projectIds: Set<string>
}

export interface DeveloperLiveServer {
  readonly baseUrl: string
  readonly owner: DeveloperLiveSession
  readonly reviewer: DeveloperLiveSession
  readonly other: DeveloperLiveSession
  readonly pool: Pool
  readonly seedScannedMaterial: (input: Readonly<{
    readonly verificationId: string
    readonly ownerUserId: string
  }>) => Promise<{ readonly materialId: string }>
  readonly revokeDeveloperManagement: (input: Readonly<{
    readonly projectId: string
    readonly ownerUserId: string
  }>) => Promise<void>
  readonly approveQueuedWork: (input: Readonly<{
    readonly targetId: string
    readonly workType: 'submission' | 'project_update'
    readonly targetType: 'submission' | 'project_update'
    readonly session: DeveloperLiveSession
  }>) => Promise<{ readonly reviewDecisionId: string; readonly body: Record<string, unknown> }>
  readonly publishApprovedSubmission: (input: Readonly<{
    readonly submissionId: string
    readonly reviewDecisionId: string
  }>) => Promise<{ readonly projectId: string; readonly versionId: string }>
  readonly applyApprovedUpdate: (input: Readonly<{
    readonly updateId: string
    readonly reviewDecisionId: string
  }>) => Promise<{ readonly projectId: string; readonly versionId: string }>
  readonly request: (session: DeveloperLiveSession, path: string, init?: RequestInit) => Promise<Response>
  readonly cleanup: () => Promise<void>
  readonly stop: () => Promise<void>
}

function requireLocalDatabaseUrl(raw: string): URL {
  const parsed = new URL(raw)
  if (
    parsed.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) ||
    !['5432', '55438'].includes(parsed.port) ||
    parsed.username !== 'vibecheck' ||
    parsed.password !== 'vibecheck_ci_only' ||
    parsed.pathname !== '/developer_e2e'
  ) throw new Error('DEVELOPER_E2E_DATABASE_MUST_BE_LOCAL_ISOLATED_DATABASE')
  return parsed
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const target = requireLocalDatabaseUrl(databaseUrl)
  const admin = new pg.Client({
    connectionString: new URL('/postgres', target).toString(),
  })
  await admin.connect()
  try {
    const found = await admin.query<{ readonly datname: string }>(
      'SELECT datname FROM pg_database WHERE datname=$1',
      ['developer_e2e'],
    )
    if (!found.rows[0]) await admin.query('CREATE DATABASE developer_e2e OWNER vibecheck')
  } finally {
    await admin.end()
  }
}

function encryptedStorageKey(
  key: Buffer,
  ownerUserId: string,
  verificationId: string,
  materialId: string,
): { readonly ciphertext: Buffer; readonly nonce: Buffer; readonly authTag: Buffer } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(`${ownerUserId}:${verificationId}:${materialId}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(`developer-e2e/${materialId}.pdf`, 'utf8'), cipher.final()])
  return Object.freeze({ ciphertext, nonce, authTag: cipher.getAuthTag() })
}

async function seedIdentity(
  pool: Pool,
  input: Readonly<{ email: string; roles: readonly ('user' | 'editor')[] }>,
  ids: StoredIdSet,
): Promise<DeveloperLiveSession> {
  const userId = randomUUID()
  const anonymousSubjectId = randomUUID()
  const sessionToken = randomBytes(32).toString('base64url')
  const csrfToken = randomBytes(32).toString('base64url')
  const sessionHash = keyedHash(authTokenSecret, sessionToken)
  const csrfHash = keyedHash(authTokenSecret, csrfToken)
  const emailCiphertext = encryptText(emailEncryptionKey, input.email)
  const emailHash = keyedHash('developer-live-e2e-email-hash-secret-0123456789', input.email)
  const createdAt = now
  await pool.query(
    `INSERT INTO iam.users (user_id,status,role_version,created_at,updated_at)
     VALUES ($1,'active',1,$2,$2)`,
    [userId, createdAt],
  )
  await pool.query(
    `INSERT INTO iam.user_email_identities (
       user_id,normalized_email_hash,email_ciphertext,key_version,status,verified_at,created_at
     ) VALUES ($1,$2,$3,'developer-e2e-v1','active',$4,$4)`,
    [userId, emailHash, emailCiphertext, createdAt],
  )
  for (const role of input.roles) {
    await pool.query(
      `INSERT INTO iam.user_roles (
         user_id,role,granted_by_operation_id,valid_from,created_at
       ) VALUES ($1,$2,'developer-e2e-seed',$3,$3)`,
      [userId, role, createdAt],
    )
  }
  await pool.query(
    `INSERT INTO iam.sessions (
       session_id_hash,user_id,anonymous_subject_id,roles_version,csrf_token_hash,
       session_version,status,recent_auth_at,expires_at,created_at,last_seen_at,
       auth_method,ip_hash,user_agent_hash
     ) VALUES ($1,$2,$3,1,$4,1,'active',$5,$6,$5,$5,'developer-e2e',$7,$8)`,
    [
      sessionHash, userId, anonymousSubjectId, csrfHash, createdAt,
      new Date(createdAt.getTime() + 86_400_000), keyedHash(authTokenSecret, '127.0.0.1'),
      keyedHash(authTokenSecret, 'developer-live-e2e'),
    ],
  )
  ids.userIds.add(userId)
  return Object.freeze({
    userId,
    email: input.email,
    sessionToken,
    csrfToken,
    roles: Object.freeze([...input.roles]),
  })
}

function identityConfig(): IdentityConfig {
  return Object.freeze({
    enabled: true,
    cookieSecure: false,
    sessionTtlSeconds: 86_400,
    otpTtlSeconds: 600,
    otpResendSeconds: 60,
    emailSendLimit: 5,
    ipSendLimit: 20,
    rateWindowSeconds: 900,
    emailProvider: 'resend',
    emailFrom: 'developer-e2e@example.com',
    resendApiKey: 'developer-e2e-resend-key-0123456789',
    emailEncryptionKey,
    emailEncryptionKeyVersion: 'developer-e2e-v1',
    emailHashPepper: 'developer-live-e2e-email-hash-secret-0123456789',
    otpPepper: 'developer-live-e2e-otp-secret-0123456789',
    authTokenSecret,
  })
}

function testUrlSafetyResolver(): AssetWebSafetyResolver {
  return new AssetWebSafetyResolver(
    {
      async resolve(): Promise<readonly [{ readonly address: string; readonly family: 4 }]> {
        return [{ address: '93.184.216.34', family: 4 }]
      },
    },
    {
      async probe(): Promise<{ readonly statusCode: number; readonly location: null }> {
        return { statusCode: 200, location: null }
      },
    },
  )
}

function testMaterialStorage() {
  return {
    async issueUpload(): Promise<{ readonly uploadUrl: string; readonly uploadHeaders: Record<string, string> }> {
      return { uploadUrl: 'https://storage.invalid/developer-e2e-upload', uploadHeaders: {} }
    },
    async inspectUpload(): Promise<{ readonly detectedMime: string; readonly byteSize: number; readonly checksumSha256: string }> {
      return { detectedMime: 'application/pdf', byteSize: 4, checksumSha256: 'a'.repeat(64) }
    },
    async issueRead(): Promise<{ readonly readUrl: string }> {
      return { readUrl: 'https://storage.invalid/developer-e2e-read' }
    },
    async allowReads(): Promise<void> {},
    async denyReads(): Promise<void> {},
  }
}

function cookieHeader(session: DeveloperLiveSession): string {
  return `vc_session=${encodeURIComponent(session.sessionToken)}; vc_csrf=${encodeURIComponent(session.csrfToken)}`
}

function jsonHeaders(session: DeveloperLiveSession, baseUrl: string): Headers {
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    cookie: cookieHeader(session),
    origin: baseUrl,
    'x-csrf-token': session.csrfToken,
  })
  return headers
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('DEVELOPER_E2E_JSON_OBJECT_REQUIRED')
  return body as Record<string, unknown>
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error(code)
  return value
}

export async function startDeveloperLiveServer(): Promise<DeveloperLiveServer> {
  process.env.NODE_ENV = 'test'
  const databaseUrl = process.env.VIBECHECK_DEVELOPER_E2E_DATABASE_URL ?? defaultDatabaseUrl
  requireLocalDatabaseUrl(databaseUrl)
  if (!existsSync(resolve(staticDirectory, 'index.html'))) throw new Error('DEVELOPER_E2E_STATIC_DIST_REQUIRED')
  await ensureDatabase(databaseUrl)
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    ssl: false,
    applicationName: 'vibecheck-developer-e2e',
    maxConnections: 8,
  })
  await runMigrations(pool, resolve(process.cwd(), 'db/migrations'))
  await checkDatabase(pool)

  const clock = () => new Date()
  const config: ServiceConfig = Object.freeze({
    serviceName: 'vibecheck-developer-e2e',
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'fatal',
    databaseUrl,
    databaseSsl: false,
    webOrigins: [],
    gitCommit: 'developer-e2e',
    workerPollIntervalMs: 50,
    workerBatchSize: 25,
  })
  const catalog = new CatalogService({
    store: new PostgresCatalogStore(pool),
    cursorSecret: 'developer-live-e2e-catalog-secret-0123456789',
    now: clock,
  })
  const authorization = new PostgresAuthorAuthorizationResolver(pool)
  const workflow = new WorkflowService(new PostgresWorkflowStore(pool), {
    cursorSecret: workflowTokenSecret,
    leaseSeconds: 60,
    maximumClaimSeconds: 3_600,
    queuePageSize: 25,
  }, clock)
  const verificationRequests = new VerificationRequestService(
    new PostgresVerificationRequestStore(pool),
    clock,
    { authTokenSecret },
  )
  const submission = new SubmissionService({
    store: new PostgresSubmissionStore(pool),
    urlSafetyResolver: testUrlSafetyResolver(),
    config: { enabled: true, urlCheckTtlSeconds: 600, draftTtlSeconds: 86_400 },
    now: clock,
  })
  const projectUpdates = new ProjectUpdateService({
    store: new PostgresProjectUpdateStore(pool),
    authorization,
    now: clock,
  })
  const privateMaterials = new PrivateMaterialService({
    store: new PostgresPrivateMaterialStore(pool),
    storage: testMaterialStorage(),
    crypto: {
      encryptionKeyBase64: privateMaterialEncryptionKey,
      encryptionKeyVersion: 'developer-e2e-v1',
      authTokenSecret,
      readGrantTokenSecret: workflowTokenSecret,
    },
    now: clock,
  })
  const adminOperations = new AdminOperationSecurityService(
    new PostgresAdminOperationSecurityStore(pool),
    {
      tokenSecret: workflowTokenSecret,
      authTokenSecret,
      previewTtlSeconds: 600,
      confirmTtlSeconds: 120,
      recentAuthWindowSeconds: 300,
    },
    clock,
  )
  const reviewDecisions = new ReviewDecisionService(
    new PostgresReviewDecisionStore(pool),
    { tokenSecret: workflowTokenSecret, authTokenSecret },
    clock,
  )
  const identity = new IdentityService({
    config: identityConfig(),
    store: new PostgresIdentityStore(pool),
    emailSender: { async sendOtp(): Promise<{ readonly receiptId: string }> { return { receiptId: 'developer-e2e' } } },
    now: clock,
  })
  const developerProjects = new DeveloperAccountService({
    pool,
    catalog,
    authorization,
    cursorSecret: 'developer-live-e2e-catalog-secret-0123456789',
  })
  const server = createApiServer(config, {
    checkReadiness: () => checkDatabase(pool),
    identity,
    submission,
    projectUpdates,
    workflow,
    verificationRequests,
    privateMaterials,
    adminOperations,
    reviewDecisions,
    catalog,
    developerProjects,
    creatorAuthorRead: new CreatorAuthorReadService(pool),
    authCookieSecure: false,
    anonymousCookieSecret: authTokenSecret,
    staticDirectory,
    now: clock,
  })
  await listen(server, config)
  const address = server.address() as AddressInfo | null
  if (!address || typeof address.port !== 'number') {
    await close(server).catch(() => undefined)
    await pool.end()
    throw new Error('DEVELOPER_E2E_SERVER_ADDRESS_UNAVAILABLE')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  const ids: StoredIdSet = {
    userIds: new Set(), verificationIds: new Set(), materialIds: new Set(),
    submissionIds: new Set(), updateIds: new Set(), projectIds: new Set(),
  }
  try {
    const owner = await seedIdentity(pool, { email: `owner-${randomUUID()}@example.com`, roles: ['user'] }, ids)
    const reviewer = await seedIdentity(pool, { email: `reviewer-${randomUUID()}@example.com`, roles: ['user', 'editor'] }, ids)
    const other = await seedIdentity(pool, { email: `other-${randomUUID()}@example.com`, roles: ['user'] }, ids)

    const request = async (
      session: DeveloperLiveSession,
      path: string,
      init: RequestInit = {},
    ): Promise<Response> => {
      const headers = jsonHeaders(session, baseUrl)
      for (const [key, value] of new Headers(init.headers).entries()) headers.set(key, value)
      const body = init.body
      if (body !== undefined) headers.set('content-type', headers.get('content-type') ?? 'application/json')
      return fetch(`${baseUrl}${path}`, { ...init, headers, body })
    }

    const seedScannedMaterial = async (input: Readonly<{
      verificationId: string
      ownerUserId: string
    }>): Promise<{ readonly materialId: string }> => {
      const materialId = randomUUID()
      const encrypted = encryptedStorageKey(
        Buffer.from(privateMaterialEncryptionKey, 'base64'), input.ownerUserId, input.verificationId, materialId,
      )
      await pool.query(
        `INSERT INTO private_material.verification_materials (
           material_id,verification_id,owner_user_id,storage_key_ciphertext,storage_key_nonce,
           storage_key_auth_tag,storage_key_version,declared_mime,detected_mime,byte_size,
           checksum_sha256,status,scan_result,idempotency_key,request_hash,version,created_at,
           updated_at,upload_expires_at,completed_at,processing_deadline_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'developer-e2e-v1','application/pdf','application/pdf',4,$7,
           'ready','clean',$8,$7,1,$9::timestamptz,$9::timestamptz,$9::timestamptz+interval '30 minutes',$9::timestamptz,$9::timestamptz+interval '30 minutes')`,
        [materialId, input.verificationId, input.ownerUserId, encrypted.ciphertext, encrypted.nonce,
          encrypted.authTag, 'a'.repeat(64), `developer-e2e-material-${materialId}`, now],
      )
      ids.materialIds.add(materialId)
      return Object.freeze({ materialId })
    }

    const revokeDeveloperManagement = async (input: Readonly<{
      projectId: string
      ownerUserId: string
    }>): Promise<void> => {
      const relation = await pool.query<{ readonly relation_id: string; readonly link_id: string }>(
        `SELECT relation.author_relation_id AS relation_id, link.creator_account_link_id AS link_id
           FROM catalog.author_relations relation
           JOIN catalog.creator_account_links link
             ON link.creator_account_link_id=relation.approved_via_creator_account_link_id
          WHERE relation.project_id=$1
            AND relation.author_role='owner'
            AND link.user_id=$2
          LIMIT 1`,
        [input.projectId, input.ownerUserId],
      )
      const row = relation.rows[0]
      if (!row) throw new Error('DEVELOPER_E2E_OWNER_RELATION_NOT_FOUND')
      await pool.query(
        `UPDATE catalog.author_relations
            SET status='suspended', version=version+1,
                updated_at=GREATEST(updated_at + interval '1 microsecond', $2::timestamptz)
          WHERE author_relation_id=$1 AND status='active'`,
        [row.relation_id, now],
      )
      await pool.query(
        `UPDATE catalog.creator_account_links
            SET status='suspended', version=version+1,
                updated_at=GREATEST(updated_at + interval '1 microsecond', $2::timestamptz)
          WHERE creator_account_link_id=$1 AND status='active'`,
        [row.link_id, now],
      )
    }

    const reviewTargetVersion = async (workType: 'submission' | 'project_update', targetId: string): Promise<number> => {
      const table = workType === 'submission' ? 'workflow.submissions' : 'catalog.project_updates'
      const column = workType === 'submission' ? 'submission_id' : 'update_id'
      const result = await pool.query<{ readonly version: number }>(
        `SELECT version FROM ${table} WHERE ${column}=$1`, [targetId],
      )
      if (!result.rows[0]) throw new Error('DEVELOPER_E2E_REVIEW_TARGET_NOT_FOUND')
      return Number(result.rows[0].version)
    }

    const approveQueuedWork = async (input: Readonly<{
      targetId: string
      workType: 'submission' | 'project_update'
      targetType: 'submission' | 'project_update'
      session: DeveloperLiveSession
    }>): Promise<{ readonly reviewDecisionId: string; readonly body: Record<string, unknown> }> => {
      const queuedResponse = await request(
        input.session,
        `/api/v1/admin/work-items?work_type=${input.workType}&status=queued`,
      )
      if (!queuedResponse.ok) throw new Error(`DEVELOPER_E2E_REVIEW_QUEUE_${queuedResponse.status}`)
      const queued = await responseJson(queuedResponse)
      const items = Array.isArray(queued.items) ? queued.items as Array<Record<string, unknown>> : []
      const item = items.find(candidate => candidate.target_id === input.targetId)
      if (!item) throw new Error('DEVELOPER_E2E_REVIEW_ITEM_NOT_FOUND')
      const workItemId = uuid(item.work_item_id, 'DEVELOPER_E2E_WORK_ITEM_INVALID')
      const version = Number(item.version)
      const claimResponse = await request(input.session, `/api/v1/admin/work-items/${workItemId}/claim`, {
        method: 'POST',
        body: JSON.stringify({ expected_version: version, expected_conflict_principal_version: null }),
      })
      if (!claimResponse.ok) throw new Error(`DEVELOPER_E2E_REVIEW_CLAIM_${claimResponse.status}`)
      const claim = await responseJson(claimResponse)
      const claimToken = String(claim.claim_token)
      const claimVersion = Number(claim.version)
      const targetVersion = await reviewTargetVersion(input.workType, input.targetId)
      const operationType = `${input.workType}_review`
      const previewResponse = await request(input.session, '/api/v1/admin/operations/preview', {
        method: 'POST',
        body: JSON.stringify({
          operation_type: operationType,
          targets: [{ target_type: input.targetType, target_id: input.targetId }],
          expected_versions: { [input.workType]: targetVersion, work_item: claimVersion },
          proposed_diff: { status: 'approved' },
          reason_code: `${input.workType}_approved`,
          claim_token: claimToken,
          expected_conflict_principal_version: null,
        }),
      })
      if (!previewResponse.ok) throw new Error(`DEVELOPER_E2E_REVIEW_PREVIEW_${previewResponse.status}`)
      const preview = await responseJson(previewResponse)
      const confirmResponse = await request(input.session, '/api/v1/admin/operations/confirm', {
        method: 'POST',
        body: JSON.stringify({
          preview_token: preview.preview_token,
          confirmation_summary_hash: preview.confirmation_summary_hash,
          confirm_request_id: `developer-e2e-confirm-${randomUUID()}`,
          reauth_grant_id: null,
          expected_conflict_principal_version: null,
        }),
      })
      if (!confirmResponse.ok) throw new Error(`DEVELOPER_E2E_REVIEW_CONFIRM_${confirmResponse.status}`)
      const confirm = await responseJson(confirmResponse)
      const decisionResponse = await request(input.session, `/api/v1/admin/work-items/${workItemId}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          preview_token: preview.preview_token,
          claim_token: claimToken,
          confirm_token: confirm.confirm_token,
          decision: 'approve',
          reason_code: `${input.workType}_approved`,
          field_paths: [],
          decision_evidence_refs: [],
          expected_version: claimVersion,
          decision_request_id: `developer-e2e-decision-${randomUUID()}`,
          decision_payload: {},
        }),
      })
      if (!decisionResponse.ok) throw new Error(`DEVELOPER_E2E_REVIEW_DECISION_${decisionResponse.status}`)
      const body = await responseJson(decisionResponse)
      const reviewDecisionId = uuid(body.review_decision_id, 'DEVELOPER_E2E_REVIEW_DECISION_ID_INVALID')
      return Object.freeze({ reviewDecisionId, body })
    }

    const publishApprovedSubmission = async (input: Readonly<{
      submissionId: string
      reviewDecisionId: string
    }>): Promise<{ readonly projectId: string; readonly versionId: string }> => {
      const published = await new PostgresSubmissionPublisher(pool, clock).publishApprovedSubmission(
        input.submissionId, input.reviewDecisionId,
      )
      const indexed = await new PostgresPublishedProjectIndexer(pool, clock).indexPublishedProject({
        projectId: published.project_id,
        versionId: published.version_id,
        submissionId: input.submissionId,
        reviewDecisionId: input.reviewDecisionId,
      })
      ids.submissionIds.add(input.submissionId)
      ids.projectIds.add(indexed.project_id)
      return Object.freeze({ projectId: published.project_id, versionId: published.version_id })
    }

    const applyApprovedUpdate = async (input: Readonly<{
      updateId: string
      reviewDecisionId: string
    }>): Promise<{ readonly projectId: string; readonly versionId: string }> => {
      const applied = await new PostgresProjectUpdateApplier(pool, clock).applyApprovedUpdate(
        input.updateId, input.reviewDecisionId,
      )
      await new PostgresUpdatedProjectIndexer(pool, clock).indexUpdatedProject({
        projectId: applied.project_id,
        versionId: applied.version_id,
        updateId: input.updateId,
        reviewDecisionId: input.reviewDecisionId,
        eventId: applied.event_id,
      })
      ids.updateIds.add(input.updateId)
      ids.projectIds.add(applied.project_id)
      return Object.freeze({ projectId: applied.project_id, versionId: applied.version_id })
    }

    const cleanup = async (): Promise<void> => {
      // IDs are generated per run. The isolated database is never shared with production.
      // Keep teardown best-effort so a failing assertion still leaves diagnostics in Postgres.
      const userIds = [...ids.userIds]
      if (!userIds.length) return
      try {
        await pool.query('DELETE FROM iam.sessions WHERE user_id = ANY($1::uuid[])', [userIds])
        await pool.query('DELETE FROM iam.user_roles WHERE user_id = ANY($1::uuid[])', [userIds])
        await pool.query('DELETE FROM iam.user_email_identities WHERE user_id = ANY($1::uuid[])', [userIds])
        await pool.query('DELETE FROM iam.users WHERE user_id = ANY($1::uuid[])', [userIds])
      } catch {
        // Foreign-keyed workflow data is retained for debugging and is confined to developer_e2e.
      }
    }

    return Object.freeze({
      baseUrl,
      owner,
      reviewer,
      other,
      pool,
      seedScannedMaterial,
      revokeDeveloperManagement,
      approveQueuedWork,
      publishApprovedSubmission,
      applyApprovedUpdate,
      request,
      cleanup,
      async stop(): Promise<void> {
        await cleanup()
        await close(server).catch(() => undefined)
        await pool.end()
      },
    })
  } catch (error) {
    await close(server).catch(() => undefined)
    await pool.end()
    throw error
  }
}
