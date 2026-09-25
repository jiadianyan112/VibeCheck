import type { Page, Route } from '@playwright/test'

export type PublishCheckScenario =
  | 'accessible'
  | 'uncertain-access'
  | 'category-unconfirmed'
  | 'unsafe'

export type PublishFailurePoint = 'patch' | 'submit'

export interface PublishMockOptions {
  readonly checkScenario?: PublishCheckScenario
  readonly failurePoint?: PublishFailurePoint
}

interface PublishRequest {
  readonly kind: string
  readonly method: string
  readonly url: string
  readonly body: unknown
}

const checkId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const chainId = '55555555-5555-4555-8555-555555555555'
const submissionId = '66666666-6666-4666-8666-666666666666'
const reviewWorkItemId = '77777777-7777-4777-8777-777777777777'
const previewHash = 'a'.repeat(64)
const timestamp = '2026-08-29T00:00:00.000Z'
const expiresAt = '2099-01-01T00:30:00.000Z'

function jsonError(code: string, retryable = false) {
  return {
    error: {
      code,
      message_key: `error.${code.toLowerCase()}`,
      request_id: `publish-mock-${code.toLowerCase()}`,
      retryable,
      retry_after_ms: retryable ? 100 : null,
    },
  }
}

function readBody(route: Route) {
  try {
    return route.request().postDataJSON() as Record<string, unknown>
  } catch {
    return {}
  }
}

function canonicalUrl(rawUrl: string) {
  const value = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  return new URL(value).toString()
}

/**
 * Mock only the browser-facing publish contract. Auth stays in mock-auth.ts;
 * this helper records every publish operation so tests can assert the wire
 * payload rather than a test-only UI shortcut.
 */
export async function installPublishMock(page: Page, options: PublishMockOptions = {}) {
  const scenario = options.checkScenario ?? 'accessible'
  const requests: PublishRequest[] = []
  let categoryId: 'ai_learning_quiz' | 'personal_site_portfolio' = 'ai_learning_quiz'
  let lastCheckedUrl = 'https://example.test/publish'
  let payloadSnapshot: Record<string, unknown> = {
    category_id: categoryId,
    category_schema_version: 'learning.v1',
    project_core: {
      current_name: '',
      public_url: lastCheckedUrl,
      one_line_definition: '',
      repository_url: null,
      tech_stack: [],
      cover_media_reference_ids: [],
    },
    category_data: {},
  }
  let draftVersion = 1
  let submitted = false
  let submitFailureRemaining = options.failurePoint === 'submit'

  function addRequest(kind: string, route: Route, body: unknown = {}) {
    requests.push({ kind, method: route.request().method(), url: route.request().url(), body })
  }

  function draftProjection() {
    return {
      draft_id: draftId,
      submission_chain_id: chainId,
      category_id: categoryId,
      category_schema_version: categoryId === 'personal_site_portfolio' ? 'portfolio.v1' : 'learning.v1',
      check_id: checkId,
      draft_revision: 1,
      supersedes_draft_id: null,
      base_submission_id: null,
      payload_snapshot: payloadSnapshot,
      media_reference_ids: [],
      evidence_draft_ids: [],
      asset_drafts: [],
      status: submitted ? 'submitted' : 'editing',
      version: draftVersion,
      created_at: timestamp,
      updated_at: timestamp,
      saved_at: timestamp,
      expires_at: expiresAt,
    }
  }

  await page.route('**/api/v1/submission-url-checks', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = readBody(route)
    const rawUrl = typeof body.raw_url === 'string' ? body.raw_url : lastCheckedUrl
    categoryId = body.category_hint === 'personal_site_portfolio' ? 'personal_site_portfolio' : 'ai_learning_quiz'
    lastCheckedUrl = canonicalUrl(rawUrl)
    const schemaVersion = categoryId === 'personal_site_portfolio' ? 'portfolio.v1' : 'learning.v1'
    const isUnsafe = scenario === 'unsafe'
    addRequest('url-check', route, body)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        check_id: checkId,
        category_id: categoryId,
        category_schema_version: schemaVersion,
        input_hash: 'b'.repeat(64),
        canonical_url: lastCheckedUrl,
        redirect_chain: [],
        risk_result: isUnsafe ? 'blocked' : 'allowed',
        access_result: scenario === 'uncertain-access' ? 'uncertain' : 'accessible',
        category_result: scenario === 'category-unconfirmed' ? 'unconfirmed' : 'matched',
        duplicate_result: 'none',
        duplicate_candidates: [],
        risk_reasons: isUnsafe ? ['外链安全风险无法接受。'] : [],
        can_create_draft: !isUnsafe,
        checked_at: timestamp,
        expires_at: expiresAt,
      }),
    })
  })

  await page.route('**/api/v1/submission-drafts', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = readBody(route)
    categoryId = body.category_id === 'personal_site_portfolio' ? 'personal_site_portfolio' : 'ai_learning_quiz'
    addRequest('draft-create', route, body)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(draftProjection()) })
  })

  await page.route('**/api/v1/submission-drafts/**', async (route) => {
    const method = route.request().method()
    const url = new URL(route.request().url())
    const suffix = url.pathname.split('/').pop()

    if (method === 'GET') {
      addRequest('draft-get', route)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draftProjection()) })
      return
    }

    if (method === 'PATCH' && suffix === draftId) {
      const body = readBody(route)
      addRequest('draft-patch', route, body)
      if (options.failurePoint === 'patch') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(jsonError('UPSTREAM_UNAVAILABLE', true)) })
        return
      }
      if (body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)) {
        payloadSnapshot = body.patch as Record<string, unknown>
      }
      draftVersion += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draftProjection()) })
      return
    }

    if (method === 'POST' && suffix === 'preview') {
      const body = readBody(route)
      addRequest('preview', route, body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          draft_id: draftId,
          draft_version: draftVersion,
          check_id: checkId,
          preview_hash: previewHash,
          payload_snapshot: payloadSnapshot,
          media_reference_ids: [],
          evidence_draft_ids: [],
          validation: { valid: true, issue_count: 0 },
          generated_at: timestamp,
        }),
      })
      return
    }

    await route.continue()
  })

  await page.route('**/api/v1/media-references*', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      addRequest('media-reference-list', route)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total_count: 0 }) })
      return
    }
    if (method === 'DELETE') {
      addRequest('media-reference-delete', route, readBody(route))
      await route.fulfill({ status: 204 })
      return
    }
    await route.continue()
  })

  await page.route('**/api/v1/submissions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = readBody(route)
    addRequest('submit', route, body)
    if (submitFailureRemaining) {
      submitFailureRemaining = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(jsonError('UPSTREAM_UNAVAILABLE', true)) })
      return
    }
    submitted = true
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        submission_id: submissionId,
        submission_chain_id: chainId,
        draft_id: draftId,
        snapshot_version: draftVersion,
        review_status: 'pending_review',
        review_work_item_id: reviewWorkItemId,
        media_reference_ids: [],
        evidence_draft_ids: [],
        preview_hash: previewHash,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
      }),
    })
  })

  return {
    requests,
    requestKinds() {
      return requests.map((request) => request.kind)
    },
    requestsOf(kind: string) {
      return requests.filter((request) => request.kind === kind)
    },
    lastBody(kind: string) {
      return [...requests].reverse().find((request) => request.kind === kind)?.body
    },
  }
}
