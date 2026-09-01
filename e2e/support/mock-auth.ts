import { expect, type Page } from '@playwright/test'
import type { AuthSessionDto } from '../../src/services/authService'

export const mockAuthProfiles = {
  mia: {
    label: '米娅',
    email: 'mia@example.test',
    session: {
      authenticated: true,
      user_id: '11111111-1111-4111-8111-111111111111',
      display_name: '米娅',
      account_status: 'active',
      roles: ['verified_author'],
      primary_role: 'verified_author',
      permissions: ['profile:read', 'interaction:write', 'submission:write', 'author_verification:write'],
      session_version: 1,
      csrf_token: 'csrf-mia-verified-author-000000000000000000000000',
      recent_auth_at: '2026-08-29T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
    } satisfies AuthSessionDto,
  },
  lin: {
    label: '林舟',
    email: 'lin.zhou@example.test',
    session: {
      authenticated: true,
      user_id: '22222222-2222-4222-8222-222222222222',
      display_name: '林舟',
      account_status: 'active',
      roles: ['admin'],
      primary_role: 'admin',
      permissions: ['profile:read', 'interaction:write', 'submission:write', 'author_verification:write', 'admin:read', 'admin:write'],
      session_version: 1,
      csrf_token: 'csrf-lin-admin-000000000000000000000000000000',
      recent_auth_at: '2026-08-29T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
    } satisfies AuthSessionDto,
  },
} as const

export type MockAuthProfile = keyof typeof mockAuthProfiles

const mockOtp = '123456'
const challengeExpiresAt = '2099-01-01T00:10:00.000Z'
const challengeResendAfter = '2000-01-01T00:00:00.000Z'
const mockCheckId = '33333333-3333-4333-8333-333333333333'
const mockDraftId = '44444444-4444-4444-8444-444444444444'
const mockSubmissionChainId = '55555555-5555-4555-8555-555555555555'
const mockDate = '2026-08-29T00:00:00.000Z'

type PendingChallenge = {
  readonly returnTo: string
  readonly profile: MockAuthProfile
}

function errorBody(code: string) {
  return {
    error: {
      code,
      message_key: code.toLowerCase(),
      request_id: `mock-${code.toLowerCase()}`,
      retryable: false,
      retry_after_ms: null,
    },
  }
}

function maskEmail(email: string) {
  const [local = 'user', domain = 'example.test'] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

function escapedUrl(path: string) {
  return new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

export interface MockAuthOptions {
  readonly submission?: boolean
}

/**
 * Stubs the browser-facing auth contract. The tests still fill and submit the
 * production email + six-digit OTP form; no app storage or test hook is used.
 * Submission DTO routes are opt-in so public/auth-only cases stay network-clean.
 */
export async function installMockAuth(page: Page, options: MockAuthOptions = {}) {
  let activeProfile: MockAuthProfile | null = null
  let nextProfile: MockAuthProfile = 'mia'
  let challengeSequence = 0
  const pending = new Map<string, PendingChallenge>()

  await page.route('**/api/v1/auth/session', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      if (activeProfile) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockAuthProfiles[activeProfile].session),
        })
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify(errorBody('AUTH_SESSION_REQUIRED')),
        })
      }
      return
    }
    if (method === 'DELETE') {
      activeProfile = null
      await route.fulfill({ status: 204 })
      return
    }
    await route.continue()
  })

  await page.route('**/api/v1/auth/email-challenges', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = route.request().postDataJSON() as { email?: unknown; return_to?: unknown }
    const email = typeof body.email === 'string' ? body.email : mockAuthProfiles[nextProfile].email
    const returnTo = typeof body.return_to === 'string' ? body.return_to : '/me'
    const challengeId = `mock-challenge-${challengeSequence++}`
    pending.set(challengeId, { returnTo, profile: nextProfile })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        auth_flow_id: `mock-auth-flow-${challengeSequence}`,
        challenge_id: challengeId,
        expires_at: challengeExpiresAt,
        resend_after: challengeResendAfter,
        masked_email: maskEmail(email),
      }),
    })
  })

  await page.route('**/api/v1/auth/email-challenges/*/verify', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const challengeId = route.request().url().split('/api/v1/auth/email-challenges/')[1]?.split('/verify')[0] ?? ''
    const challenge = pending.get(decodeURIComponent(challengeId))
    const body = route.request().postDataJSON() as { otp?: unknown }
    if (!challenge || body.otp !== mockOtp) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify(errorBody('OTP_INVALID')),
      })
      return
    }
    activeProfile = challenge.profile
    pending.delete(decodeURIComponent(challengeId))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        purpose: 'login',
        session: mockAuthProfiles[activeProfile].session,
        return_to: challenge.returnTo,
      }),
    })
  })

  if (options.submission) {
    let lastCheckedUrl = 'https://example.test/mobile-publish'

    // Submission routes are opt-in: only publish-flow gates install these
    // deterministic DTO responses; public/auth-only cases remain untouched.
    await page.route('**/api/v1/submission-url-checks', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      const body = route.request().postDataJSON() as { raw_url?: unknown; category_hint?: unknown }
      const rawUrl = typeof body.raw_url === 'string' ? body.raw_url : 'https://example.test/mobile-publish'
      const canonicalUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
      lastCheckedUrl = canonicalUrl
      const categoryId = body.category_hint === 'personal_site_portfolio' ? 'personal_site_portfolio' : 'ai_learning_quiz'
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          check_id: mockCheckId,
          category_id: categoryId,
          category_schema_version: categoryId === 'personal_site_portfolio' ? 'portfolio.v1' : 'learning.v1',
          input_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          canonical_url: canonicalUrl,
          redirect_chain: [],
          risk_result: 'allowed',
          access_result: 'accessible',
          category_result: 'matched',
          duplicate_result: 'none',
          duplicate_candidates: [],
          risk_reasons: [],
          can_create_draft: true,
          checked_at: '2026-08-29T00:00:00.000Z',
          expires_at: '2099-01-01T00:30:00.000Z',
        }),
      })
    })

    const draftProjection = (categoryId: 'ai_learning_quiz' | 'personal_site_portfolio') => ({
      draft_id: mockDraftId,
      submission_chain_id: mockSubmissionChainId,
      category_id: categoryId,
      category_schema_version: categoryId === 'personal_site_portfolio' ? 'portfolio.v1' : 'learning.v1',
      check_id: mockCheckId,
      draft_revision: 1,
      supersedes_draft_id: null,
      base_submission_id: null,
      payload_snapshot: {
        project_core: { public_url: lastCheckedUrl },
        category_id: categoryId,
        category_schema_version: categoryId === 'personal_site_portfolio' ? 'portfolio.v1' : 'learning.v1',
      },
      media_reference_ids: [],
      evidence_draft_ids: [],
      asset_drafts: [],
      status: 'editing',
      version: 1,
      created_at: mockDate,
      updated_at: mockDate,
      saved_at: mockDate,
      expires_at: '2099-01-01T00:30:00.000Z',
    })

    await page.route('**/api/v1/submission-drafts', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      const body = route.request().postDataJSON() as { category_id?: unknown }
      const categoryId = body.category_id === 'personal_site_portfolio' ? 'personal_site_portfolio' : 'ai_learning_quiz'
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(draftProjection(categoryId)),
      })
    })

    await page.route('**/api/v1/submission-drafts/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(draftProjection('ai_learning_quiz')),
      })
    })
  }

  async function completeLogin(profile: MockAuthProfile, returnPath: string) {
    nextProfile = profile
    await expect(page.getByRole('heading', { name: '邮箱验证码登录' })).toBeVisible()
    await page.getByRole('textbox', { name: '邮箱地址' }).fill(mockAuthProfiles[profile].email)
    await page.getByRole('button', { name: '发送验证码' }).click()
    await expect(page.getByRole('textbox', { name: '6 位验证码' })).toBeVisible()
    await page.getByRole('textbox', { name: '6 位验证码' }).fill(mockOtp)
    await page.getByRole('button', { name: '验证并登录' }).click()
    await expect(page).toHaveURL(escapedUrl(returnPath))
  }

  return {
    async loginAs(profile: MockAuthProfile, returnPath: string) {
      await page.goto(`/auth?return_to=${encodeURIComponent(returnPath)}`)
      await completeLogin(profile, returnPath)
    },
    async loginCurrent(profile: MockAuthProfile, returnPath: string) {
      await completeLogin(profile, returnPath)
    },
    selectProfile(profile: MockAuthProfile) {
      nextProfile = profile
    },
  }
}
