import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { IdentityConfig } from '@vibecheck/config'
import { Pool } from 'pg'

import type { EmailOtpMessage, EmailSender } from '../types.js'
import { IdentityError } from '../errors.js'
import { PendingActionService } from '../pending-action-service.js'
import { PostgresPendingActionStore } from '../pending-action-store.js'
import { IdentityService } from '../service.js'
import { PostgresIdentityStore } from '../store.js'

if (process.env.NODE_ENV === 'production') throw new Error('PENDING_ACTION_FIXTURE_PRODUCTION_FORBIDDEN')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
const pool = new Pool({
  connectionString,
  ssl,
  application_name: 'vibecheck-pending-action-fixture-verify',
  max: 3,
})

const config: IdentityConfig = Object.freeze({
  enabled: true,
  cookieSecure: false,
  sessionTtlSeconds: 2_592_000,
  otpTtlSeconds: 600,
  otpResendSeconds: 60,
  emailSendLimit: 5,
  ipSendLimit: 20,
  rateWindowSeconds: 900,
  emailProvider: 'resend',
  emailFrom: 'fixture@vibecheck.local',
  resendApiKey: 'fixture-resend-api-key-at-least-thirty-two-characters',
  emailEncryptionKey: Buffer.alloc(32, 11).toString('base64'),
  emailEncryptionKeyVersion: 'fixture-v1',
  emailHashPepper: 'fixture-email-hash-pepper-at-least-thirty-two-characters',
  otpPepper: 'fixture-otp-pepper-at-least-thirty-two-characters',
  authTokenSecret: 'fixture-auth-token-secret-at-least-thirty-two-characters',
})

class CapturingEmailSender implements EmailSender {
  message: EmailOtpMessage | null = null

  async sendOtp(message: EmailOtpMessage): Promise<{ readonly receiptId: string }> {
    this.message = message
    return { receiptId: `fixture-${randomUUID()}` }
  }
}

let clock = new Date('2026-08-12T09:00:00.000Z')
const pending = new PendingActionService({
  config,
  store: new PostgresPendingActionStore(pool),
  now: () => clock,
})
const sender = new CapturingEmailSender()
const identity = new IdentityService({
  config,
  store: new PostgresIdentityStore(pool),
  emailSender: sender,
  now: () => clock,
})

async function expectIdentityError(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    Promise.resolve().then(action),
    (error: unknown) => error instanceof IdentityError && error.code === code,
  )
}

try {
  const anonymousId = randomUUID()
  const createRequestId = randomUUID()
  const projectId = randomUUID()
  const created = await pending.create({
    subject: { kind: 'anonymous', id: anonymousId },
    actionType: 'create_comment',
    parameters: { project_id: projectId, body: '  PostgreSQL 登录回放夹具  ', parent_comment_id: null },
    returnTo: `/projects/${projectId}`,
    clientRequestId: createRequestId,
    requestId: 'pending_fixture_create',
  })
  assert.equal(created.status, 'pending')
  assert.deepEqual(await pending.create({
    subject: { kind: 'anonymous', id: anonymousId },
    actionType: 'create_comment',
    parameters: { project_id: projectId, body: '  PostgreSQL 登录回放夹具  ', parent_comment_id: null },
    returnTo: `/projects/${projectId}`,
    clientRequestId: createRequestId,
    requestId: 'pending_fixture_create_retry',
  }), created)
  await expectIdentityError(() => pending.create({
    subject: { kind: 'anonymous', id: anonymousId },
    actionType: 'set_project_favorite',
    parameters: { project_id: projectId, state: true },
    returnTo: `/projects/${projectId}`,
    clientRequestId: randomUUID(),
    requestId: 'pending_fixture_second_active',
  }), 'PENDING_ACTION_ALREADY_EXISTS')

  const challenge = await identity.startChallenge({
    email: `pending-${randomUUID()}@example.com`,
    purpose: 'login',
    returnTo: `/projects/${projectId}`,
    clientRequestId: randomUUID(),
    anonymousSubjectId: anonymousId,
    browserBindingToken: null,
    sessionToken: null,
    previewToken: null,
    pendingActionId: created.pending_action_id,
    ipAddress: '203.0.113.8',
    userAgent: 'pending-action-postgres-fixture',
    requestId: 'pending_fixture_auth_start',
  })
  assert.ok(sender.message)
  const verified = await identity.verifyChallenge({
    challengeId: challenge.challengeId,
    authFlowId: challenge.authFlowId,
    otp: sender.message!.code,
    clientRequestId: randomUUID(),
    browserBindingToken: challenge.browserBindingToken,
    currentSessionToken: null,
    ipAddress: '203.0.113.8',
    userAgent: 'pending-action-postgres-fixture',
    requestId: 'pending_fixture_auth_verify',
  })
  assert.equal(verified.purpose, 'login')
  if (verified.purpose !== 'login') throw new Error('PENDING_FIXTURE_LOGIN_EXPECTED')
  assert.equal(verified.pendingActionId, created.pending_action_id)
  assert.deepEqual(
    verified.identityLinks.map(({ purpose }) => purpose).sort(),
    ['pending_action_replay', 'query_continuation'],
  )
  const pendingLink = verified.identityLinks.find(({ purpose }) => purpose === 'pending_action_replay')
  assert.ok(pendingLink)
  const recovered = await pending.get({
    pendingActionId: created.pending_action_id,
    subject: { kind: 'user', id: verified.session.userId },
    identityLinkId: pendingLink.identityLinkId,
    requestId: 'pending_fixture_get_after_login',
  })
  assert.equal(recovered.status, 'pending')
  assert.equal('payload' in recovered, false)
  const executable = await pending.getForExecution({
    pendingActionId: created.pending_action_id,
    subject: { kind: 'user', id: verified.session.userId },
    identityLinkId: pendingLink.identityLinkId,
    requestId: 'pending_fixture_execution_read',
  })
  assert.deepEqual(executable.payload, {
    action_type: 'create_comment',
    body: 'PostgreSQL 登录回放夹具',
    parent_comment_id: null,
    project_id: projectId,
  })

  const consumeOperationId = randomUUID()
  const mismatchedExecutionReceipt = pending.issueExecutionReceipt({
    pendingActionId: created.pending_action_id,
    userId: verified.session.userId,
    businessRequestId: randomUUID(),
    result: 'success',
    expiresAt: new Date(clock.getTime() + 60_000),
  })
  await expectIdentityError(() => pending.consume({
    pendingActionId: created.pending_action_id,
    subject: { kind: 'user', id: verified.session.userId },
    identityLinkId: pendingLink.identityLinkId,
    executionReceipt: mismatchedExecutionReceipt,
    clientRequestId: randomUUID(),
    expectedStatus: 'pending',
    requestId: 'pending_fixture_consume_mismatched_business_request',
  }), 'EXECUTION_RECEIPT_INVALID')
  const executionReceipt = pending.issueExecutionReceipt({
    pendingActionId: created.pending_action_id,
    userId: verified.session.userId,
    businessRequestId: executable.client_request_id,
    result: 'success',
    expiresAt: new Date(clock.getTime() + 60_000),
  })
  const consumed = await pending.consume({
    pendingActionId: created.pending_action_id,
    subject: { kind: 'user', id: verified.session.userId },
    identityLinkId: pendingLink.identityLinkId,
    executionReceipt,
    clientRequestId: consumeOperationId,
    expectedStatus: 'pending',
    requestId: 'pending_fixture_consume',
  })
  assert.equal(consumed.status, 'consumed')
  assert.deepEqual(await pending.consume({
    pendingActionId: created.pending_action_id,
    subject: { kind: 'user', id: verified.session.userId },
    identityLinkId: pendingLink.identityLinkId,
    executionReceipt,
    clientRequestId: consumeOperationId,
    expectedStatus: 'pending',
    requestId: 'pending_fixture_consume_retry',
  }), consumed)
  const consumedRow = await pool.query<{
    payload_ciphertext: Buffer | null
    receipt_length: number | null
    link_status: string
  }>(
    `SELECT action.payload_ciphertext,
       octet_length(action.execution_receipt_hash)::int AS receipt_length,
       link.status AS link_status
     FROM iam.pending_actions action
     JOIN iam.pending_action_identity_links binding USING (pending_action_id)
     JOIN iam.identity_links link USING (identity_link_id)
     WHERE action.pending_action_id=$1`,
    [created.pending_action_id],
  )
  assert.equal(consumedRow.rows[0]?.payload_ciphertext, null)
  assert.equal(consumedRow.rows[0]?.receipt_length, 32)
  assert.equal(consumedRow.rows[0]?.link_status, 'consumed')

  const cancelAnonymousId = randomUUID()
  const cancellable = await pending.create({
    subject: { kind: 'anonymous', id: cancelAnonymousId },
    actionType: 'set_project_follow',
    parameters: { project_id: projectId, state: true },
    returnTo: `/projects/${projectId}`,
    clientRequestId: randomUUID(),
    requestId: 'pending_fixture_cancel_create',
  })
  const cancelOperationId = randomUUID()
  const cancelled = await pending.cancel({
    pendingActionId: cancellable.pending_action_id,
    subject: { kind: 'anonymous', id: cancelAnonymousId },
    identityLinkId: null,
    cancelReason: 'user_cancelled',
    clientRequestId: cancelOperationId,
    requestId: 'pending_fixture_cancel',
  })
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(await pending.cancel({
    pendingActionId: cancellable.pending_action_id,
    subject: { kind: 'anonymous', id: cancelAnonymousId },
    identityLinkId: null,
    cancelReason: 'user_cancelled',
    clientRequestId: cancelOperationId,
    requestId: 'pending_fixture_cancel_retry',
  }), cancelled)

  const expiryAnonymousId = randomUUID()
  const expiring = await pending.create({
    subject: { kind: 'anonymous', id: expiryAnonymousId },
    actionType: 'start_submission',
    parameters: { category_id: 'personal_site_portfolio' },
    returnTo: '/submit',
    clientRequestId: randomUUID(),
    requestId: 'pending_fixture_expiry_create',
  })
  const staleLink = await pool.query<{ identity_link_id: string }>(
    `INSERT INTO iam.identity_links (
       anonymous_subject_id,user_id,auth_flow_id,purpose,status,issued_at,expires_at
     ) VALUES ($1,$2,$3,'pending_action_replay','active',$4,$5)
     RETURNING identity_link_id`,
    [
      expiryAnonymousId,
      verified.session.userId,
      randomUUID(),
      clock,
      new Date(clock.getTime() + 15 * 60_000),
    ],
  )
  await pool.query(
    `INSERT INTO iam.pending_action_identity_links (
       pending_action_id,identity_link_id,created_at
     ) VALUES ($1,$2,$3)`,
    [expiring.pending_action_id, staleLink.rows[0]!.identity_link_id, clock],
  )
  clock = new Date(clock.getTime() + 16 * 60_000)
  const replacement = await pending.create({
    subject: { kind: 'anonymous', id: expiryAnonymousId },
    actionType: 'start_submission',
    parameters: { category_id: 'ai_learning_quiz' },
    returnTo: '/submit',
    clientRequestId: randomUUID(),
    requestId: 'pending_fixture_expiry_replacement',
  })
  assert.equal(replacement.status, 'pending')
  await expectIdentityError(() => pending.get({
    pendingActionId: expiring.pending_action_id,
    subject: { kind: 'anonymous', id: expiryAnonymousId },
    identityLinkId: null,
    requestId: 'pending_fixture_expired_get',
  }), 'PENDING_ACTION_GONE')
  const expired = await pool.query<{
    status: string
    payload_ciphertext: Buffer | null
    link_status: string
  }>(
    `SELECT action.status,action.payload_ciphertext,link.status AS link_status
     FROM iam.pending_actions action
     JOIN iam.pending_action_identity_links binding USING (pending_action_id)
     JOIN iam.identity_links link USING (identity_link_id)
     WHERE action.pending_action_id=$1`,
    [expiring.pending_action_id],
  )
  assert.equal(expired.rows[0]?.status, 'expired')
  assert.equal(expired.rows[0]?.payload_ciphertext, null)
  assert.equal(expired.rows[0]?.link_status, 'expired')
  await assert.rejects(
    pool.query(
      `UPDATE iam.pending_actions SET return_to='/tampered' WHERE pending_action_id=$1`,
      [created.pending_action_id],
    ),
    /IMMUTABLE_PENDING_ACTION/,
  )

  const audit = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit.security_events
     WHERE event_type LIKE 'pending_action_%'
       AND request_id LIKE 'pending_fixture_%'`,
  )
  assert.ok((audit.rows[0]?.count ?? 0) >= 6)
  console.info(JSON.stringify({
    message: 'pending_action_fixture_verified',
    identity_link_purposes: verified.identityLinks.length,
    audit_event_count: audit.rows[0]?.count,
    consumed_payload_scrubbed: true,
    expired_payload_scrubbed: true,
  }))
} finally {
  await pool.end()
}
