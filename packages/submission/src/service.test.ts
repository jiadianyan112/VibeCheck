import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SubmissionError } from './errors.js'
import { SubmissionService } from './service.js'
import type { SubmissionStore, SubmissionUrlSafetyResolver } from './store-port.js'
import type { SubmissionDraftProjection, SubmissionUrlCheckProjection } from './types.js'

const userId = '81000000-0000-4000-8000-000000000001'
const checkId = '81000000-0000-4000-8000-000000000002'
const draftId = '81000000-0000-4000-8000-000000000003'
const now = new Date('2026-08-13T09:00:00.000Z')

const checkProjection: SubmissionUrlCheckProjection = Object.freeze({
  check_id: checkId,
  category_id: 'personal_site_portfolio',
  category_schema_version: 'portfolio.v1',
  input_hash: 'a'.repeat(64),
  canonical_url: 'https://example.com/work',
  redirect_chain: Object.freeze(['https://example.com/work']),
  risk_result: 'allowed',
  access_result: 'accessible',
  category_result: 'unconfirmed',
  duplicate_result: 'none',
  duplicate_candidates: Object.freeze([]),
  risk_reasons: Object.freeze([]),
  can_create_draft: true,
  checked_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 1_800_000).toISOString(),
})

const draftProjection: SubmissionDraftProjection = Object.freeze({
  draft_id: draftId,
  submission_chain_id: '81000000-0000-4000-8000-000000000004',
  category_id: 'personal_site_portfolio',
  category_schema_version: 'portfolio.v1',
  check_id: checkId,
  draft_revision: 1,
  supersedes_draft_id: null,
  base_submission_id: null,
  payload_snapshot: Object.freeze({
    project_core: Object.freeze({ public_url: 'https://example.com/work' }),
    category_id: 'personal_site_portfolio',
    category_schema_version: 'portfolio.v1',
    category_data: Object.freeze({}),
  }),
  media_reference_ids: Object.freeze([]),
  evidence_draft_ids: Object.freeze([]),
  asset_drafts: Object.freeze([]),
  status: 'editing',
  version: 1,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  saved_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 2_592_000_000).toISOString(),
})

class FakeStore implements SubmissionStore {
  revisionReplay: Awaited<ReturnType<SubmissionStore['getRevisionDraftByRequest']>> = null
  revisionSource = Object.freeze({
    categoryId: 'personal_site_portfolio' as const,
    publicUrl: 'https://example.com/work',
  })
  createdRevisionDraft: Parameters<SubmissionStore['createRevisionDraft']>[0] | null = null
  savedCheck: Parameters<SubmissionStore['saveUrlCheck']>[0] | null = null
  createdDraft: Parameters<SubmissionStore['createDraft']>[0] | null = null
  patchedDraft: Parameters<SubmissionStore['patchDraft']>[0] | null = null
  previewedDraft: Parameters<SubmissionStore['previewDraft']>[0] | null = null
  submittedDraft: Parameters<SubmissionStore['submitDraft']>[0] | null = null
  withdrawnSubmission: Parameters<SubmissionStore['withdrawSubmission']>[0] | null = null
  replay: Awaited<ReturnType<SubmissionStore['getUrlCheckByRequest']>> = null
  reusable: SubmissionUrlCheckProjection | null = null
  boundReusable: Parameters<SubmissionStore['bindReusableUrlCheck']>[0] | null = null

  async getRevisionDraftByRequest() { return this.revisionReplay }
  async getRevisionSource() { return this.revisionSource }
  async createRevisionDraft(input: Parameters<SubmissionStore['createRevisionDraft']>[0]) {
    this.createdRevisionDraft = input
    return Object.freeze({
      ...draftProjection,
      draft_revision: 2,
      supersedes_draft_id: draftId,
      base_submission_id: input.baseSubmissionId,
    })
  }
  async getUrlCheckByRequest() { return this.replay }
  async getReusableUrlCheck() { return this.reusable }
  async bindReusableUrlCheck(input: Parameters<SubmissionStore['bindReusableUrlCheck']>[0]) {
    this.boundReusable = input
    return this.reusable ?? checkProjection
  }
  async findDuplicateCandidates() { return Object.freeze([]) }
  async saveUrlCheck(input: Parameters<SubmissionStore['saveUrlCheck']>[0]) {
    this.savedCheck = input
    return Object.freeze({
      ...checkProjection,
      input_hash: input.inputHash,
      canonical_url: input.canonicalUrl,
      redirect_chain: input.redirectChain,
      risk_result: input.riskResult,
      access_result: input.accessResult,
      risk_reasons: input.riskReasons,
    })
  }
  async createDraft(input: Parameters<SubmissionStore['createDraft']>[0]) {
    this.createdDraft = input
    return draftProjection
  }
  async getDraft() { return draftProjection }
  async patchDraft(input: Parameters<SubmissionStore['patchDraft']>[0]) {
    this.patchedDraft = input
    return Object.freeze({ ...draftProjection, version: 2 })
  }
  async previewDraft(input: Parameters<SubmissionStore['previewDraft']>[0]) {
    this.previewedDraft = input
    return Object.freeze({
      draft_id: input.draftId,
      draft_version: input.expectedVersion,
      check_id: input.checkId,
      preview_hash: 'a'.repeat(64),
      payload_snapshot: draftProjection.payload_snapshot,
      media_reference_ids: Object.freeze(['85000000-0000-4000-8000-000000000001']),
      evidence_draft_ids: Object.freeze(['85000000-0000-4000-8000-000000000002']),
      validation: Object.freeze({ valid: true as const, issue_count: 0 as const }),
      generated_at: now.toISOString(),
    })
  }
  async submitDraft(input: Parameters<SubmissionStore['submitDraft']>[0]) {
    this.submittedDraft = input
    return Object.freeze({
      submission_id: '85000000-0000-4000-8000-000000000003',
      submission_chain_id: draftProjection.submission_chain_id,
      draft_id: input.draftId,
      snapshot_version: input.draftVersion,
      review_status: 'pending_review' as const,
      review_work_item_id: '85000000-0000-4000-8000-000000000004',
      media_reference_ids: Object.freeze(['85000000-0000-4000-8000-000000000001']),
      evidence_draft_ids: Object.freeze(['85000000-0000-4000-8000-000000000002']),
      preview_hash: input.previewHash,
      version: 1,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
  }
  async withdrawSubmission(input: Parameters<SubmissionStore['withdrawSubmission']>[0]) {
    this.withdrawnSubmission = input
    return Object.freeze({
      submission_id: input.submissionId,
      review_status: 'withdrawn' as const,
      submission_version: input.expectedVersion + 1,
      review_work_item_id: '85000000-0000-4000-8000-000000000004',
      work_item_status: 'cancelled' as const,
      work_item_version: 2,
      withdrawn_at: now.toISOString(),
    })
  }
}

const allowedResolver: SubmissionUrlSafetyResolver = Object.freeze({
  async resolve() {
    return Object.freeze({
      result: 'allowed' as const,
      safeWebUrl: 'https://example.com/work',
      redirectChain: Object.freeze(['https://example.com/work']),
      reasonCode: null,
      httpStatusCode: 200,
    })
  },
})

function service(store: SubmissionStore, resolver: SubmissionUrlSafetyResolver = allowedResolver) {
  return new SubmissionService({
    store,
    urlSafetyResolver: resolver,
    config: Object.freeze({
      enabled: true,
      urlCheckTtlSeconds: 1_800,
      draftTtlSeconds: 2_592_000,
    }),
    now: () => now,
  })
}

async function failure(run: () => Promise<unknown>, code: string, status: number): Promise<void> {
  await assert.rejects(run, (error: unknown) =>
    error instanceof SubmissionError && error.code === code && error.httpStatus === status)
}

describe('SubmissionService URL checks', () => {
  it('normalizes a public URL and preserves the audited redirect chain', async () => {
    const store = new FakeStore()
    const result = await service(store).checkUrl({
      userId,
      rawUrl: ' https://EXAMPLE.com/work/#fragment ',
      categoryHint: 'personal_site_portfolio',
      clientRequestId: 'url-check-request-0001',
      requestId: 'http-request-0001',
    })
    assert.equal(result.canonical_url, 'https://example.com/work')
    assert.equal(store.savedCheck?.schemaVersion, 'portfolio.v1')
    assert.equal(store.savedCheck?.checkedAt, now)
    assert.match(store.savedCheck?.inputHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('binds a second client request to the same live normalized check', async () => {
    const store = new FakeStore()
    store.reusable = checkProjection
    const result = await service(store).checkUrl({
      userId,
      rawUrl: 'https://example.com/work',
      categoryHint: 'personal_site_portfolio',
      clientRequestId: 'url-check-request-0002',
      requestId: 'http-request-0002',
    })
    assert.equal(result.check_id, checkId)
    assert.equal(store.savedCheck, null)
    assert.equal(store.boundReusable?.clientRequestId, 'url-check-request-0002')
    assert.match(store.boundReusable?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('separates an accessibility timeout from unresolved DNS safety', async () => {
    for (const [reasonCode, expectedRisk, expectedAccess] of [
      ['ASSET_PROBE_UNAVAILABLE', 'allowed', 'uncertain'],
      ['ASSET_DNS_UNAVAILABLE', 'uncertain', 'not_checked'],
    ] as const) {
      const store = new FakeStore()
      await service(store, {
        async resolve() {
          return Object.freeze({
            result: 'uncertain' as const,
            safeWebUrl: 'https://example.com/work',
            redirectChain: Object.freeze(['https://example.com/work']),
            reasonCode,
            httpStatusCode: null,
          })
        },
      }).checkUrl({
        userId,
        rawUrl: 'https://example.com/work',
        categoryHint: 'personal_site_portfolio',
        clientRequestId: `url-check-${reasonCode}`,
        requestId: 'http-request-uncertain',
      })
      assert.equal(store.savedCheck?.riskResult, expectedRisk)
      assert.equal(store.savedCheck?.accessResult, expectedAccess)
    }
  })

  it('marks terminal HTTP failures unavailable and removes query values from redirects', async () => {
    const store = new FakeStore()
    await service(store, {
      async resolve() {
        return Object.freeze({
          result: 'allowed' as const,
          safeWebUrl: 'https://example.com/missing?owner-token=secret',
          redirectChain: Object.freeze([
            'https://example.com/start?private=one',
            'https://example.com/missing?owner-token=secret',
          ]),
          reasonCode: null,
          httpStatusCode: 404,
        })
      },
    }).checkUrl({
      userId,
      rawUrl: 'https://example.com/start?private=one',
      categoryHint: 'personal_site_portfolio',
      clientRequestId: 'url-check-http-404',
      requestId: 'http-request-404',
    })
    assert.equal(store.savedCheck?.accessResult, 'unavailable')
    assert.deepEqual(store.savedCheck?.redirectChain, [
      'https://example.com/start',
      'https://example.com/missing',
    ])
  })

  it('rejects credentials, ports, unknown categories and request-id payload reuse', async () => {
    const store = new FakeStore()
    await failure(() => service(store).checkUrl({
      userId,
      rawUrl: 'https://user:password@example.com/',
      categoryHint: 'personal_site_portfolio',
      clientRequestId: 'url-check-invalid-0001',
      requestId: 'http-request-invalid',
    }), 'SUBMISSION_URL_INVALID', 422)
    await failure(() => service(store).checkUrl({
      userId,
      rawUrl: 'https://example.com:8443/',
      categoryHint: 'personal_site_portfolio',
      clientRequestId: 'url-check-invalid-0002',
      requestId: 'http-request-invalid',
    }), 'SUBMISSION_URL_INVALID', 422)
    await failure(() => service(store).checkUrl({
      userId,
      rawUrl: 'https://example.com/',
      categoryHint: 'unknown',
      clientRequestId: 'url-check-invalid-0003',
      requestId: 'http-request-invalid',
    }), 'SUBMISSION_CATEGORY_INVALID', 422)
    store.replay = Object.freeze({ requestHash: 'different', projection: checkProjection })
    await failure(() => service(store).checkUrl({
      userId,
      rawUrl: 'https://example.com/',
      categoryHint: 'personal_site_portfolio',
      clientRequestId: 'url-check-reused-0001',
      requestId: 'http-request-invalid',
    }), 'CLIENT_REQUEST_ID_REUSED', 409)
  })
})

describe('SubmissionService drafts', () => {
  it('creates an incomplete editing skeleton and passes versioned merge patches to the store', async () => {
    const store = new FakeStore()
    await service(store).createDraft({
      userId,
      checkId,
      categoryId: 'personal_site_portfolio',
      clientRequestId: 'draft-create-request-0001',
      requestId: 'http-request-draft-create',
    })
    assert.deepEqual(store.createdDraft?.payloadSnapshot, {
      project_core: {},
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      category_data: {},
    })
    const patched = await service(store).patchDraft({
      userId,
      draftId,
      expectedVersion: 1,
      patch: Object.freeze({ project_core: Object.freeze({ current_name: 'My portfolio' }) }),
      operationId: 'draft-patch-request-0001',
      requestId: 'http-request-draft-patch',
    })
    assert.equal(patched.version, 2)
    assert.equal(store.patchedDraft?.expectedVersion, 1)
    assert.match(store.patchedDraft?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('rejects unsafe object keys and stale/non-positive client versions before storage', async () => {
    const store = new FakeStore()
    await failure(() => service(store).patchDraft({
      userId,
      draftId,
      expectedVersion: 0,
      patch: {},
      operationId: 'draft-patch-invalid-0001',
      requestId: 'http-request-invalid',
    }), 'SUBMISSION_DRAFT_VERSION_INVALID', 422)
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    await failure(() => service(store).patchDraft({
      userId,
      draftId,
      expectedVersion: 1,
      patch: unsafe,
      operationId: 'draft-patch-invalid-0002',
      requestId: 'http-request-invalid',
    }), 'DRAFT_PAYLOAD_FIELD_INVALID', 422)
    assert.equal(store.patchedDraft, null)
  })

  it('creates a revision draft from a changes-requested submission after a fresh URL check', async () => {
    const store = new FakeStore()
    const submissionId = '85000000-0000-4000-8000-000000000003'
    const result = await service(store).createRevisionDraft({
      userId,
      submissionId,
      baseSubmissionId: submissionId,
      expectedSubmissionVersion: 2,
      clientRequestId: 'revision-create-request-0001',
      requestId: 'http-request-revision-create',
    })
    assert.equal(result.draft_revision, 2)
    assert.equal(result.base_submission_id, submissionId)
    assert.equal(store.savedCheck?.canonicalUrl, 'https://example.com/work')
    assert.equal(store.createdRevisionDraft?.expectedSubmissionVersion, 2)
    assert.equal(store.createdRevisionDraft?.checkId, checkId)
    assert.match(store.createdRevisionDraft?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('replays a revision request before performing another URL safety check', async () => {
    const store = new FakeStore()
    const submissionId = '85000000-0000-4000-8000-000000000003'
    store.revisionReplay = Object.freeze({
      requestHash: '4a0f1fee2f8ed500fabf110bd53dae89c1266111f77904b87303eab188994c38',
      projection: Object.freeze({
        ...draftProjection,
        draft_revision: 2,
        supersedes_draft_id: draftId,
        base_submission_id: submissionId,
      }),
    })
    const result = await service(store).createRevisionDraft({
      userId,
      submissionId,
      baseSubmissionId: submissionId,
      expectedSubmissionVersion: 2,
      clientRequestId: 'revision-create-request-0001',
      requestId: 'http-request-revision-replay',
    })
    assert.equal(result.draft_revision, 2)
    assert.equal(store.savedCheck, null)
    assert.equal(store.createdRevisionDraft, null)
  })

  it('rejects a mismatched path/body submission identity before storage', async () => {
    const store = new FakeStore()
    await failure(() => service(store).createRevisionDraft({
      userId,
      submissionId: '85000000-0000-4000-8000-000000000003',
      baseSubmissionId: '85000000-0000-4000-8000-000000000004',
      expectedSubmissionVersion: 2,
      clientRequestId: 'revision-create-request-0002',
      requestId: 'http-request-revision-invalid',
    }), 'SUBMISSION_BASE_MISMATCH', 422)
    assert.equal(store.createdRevisionDraft, null)
  })
})

describe('SubmissionService preview and submit', () => {
  it('binds preview and idempotent submission inputs to stable hashes', async () => {
    const store = new FakeStore()
    const preview = await service(store).previewDraft({
      userId,
      draftId,
      expectedVersion: 3,
      checkId,
      requestId: 'http-request-preview',
    })
    assert.equal(preview.preview_hash, 'a'.repeat(64))
    assert.equal(store.previewedDraft?.expectedVersion, 3)

    const submitted = await service(store).submitDraft({
      userId,
      draftId,
      draftVersion: 3,
      checkId,
      previewHash: preview.preview_hash,
      submissionKey: 'submission-request-0001',
      requestId: 'http-request-submit',
    })
    assert.equal(submitted.review_status, 'pending_review')
    assert.match(store.submittedDraft?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('rejects malformed preview hashes before persistence', async () => {
    const store = new FakeStore()
    await failure(() => service(store).submitDraft({
      userId,
      draftId,
      draftVersion: 1,
      checkId,
      previewHash: 'invalid',
      submissionKey: 'submission-request-0002',
      requestId: 'http-request-submit-invalid',
    }), 'SUBMISSION_PREVIEW_HASH_INVALID', 422)
    assert.equal(store.submittedDraft, null)
  })
})

describe('SubmissionService withdrawal', () => {
  it('normalizes an optional reason and binds optimistic state to the operation receipt', async () => {
    const store = new FakeStore()
    const result = await service(store).withdrawSubmission({
      userId,
      submissionId: '85000000-0000-4000-8000-000000000003',
      expectedVersion: 1,
      operationId: 'submission-withdraw-0001',
      reasonCode: ' Owner_Cancelled ',
      requestId: 'http-request-withdraw',
    })
    assert.equal(result.review_status, 'withdrawn')
    assert.equal(store.withdrawnSubmission?.reasonCode, 'owner_cancelled')
    assert.match(store.withdrawnSubmission?.requestHash ?? '', /^[a-f0-9]{64}$/)
  })

  it('rejects stale versions and unbounded free-text reasons before storage', async () => {
    const store = new FakeStore()
    await failure(() => service(store).withdrawSubmission({
      userId,
      submissionId: '85000000-0000-4000-8000-000000000003',
      expectedVersion: 0,
      operationId: 'submission-withdraw-0002',
      reasonCode: null,
      requestId: 'http-request-withdraw',
    }), 'SUBMISSION_VERSION_INVALID', 422)
    await failure(() => service(store).withdrawSubmission({
      userId,
      submissionId: '85000000-0000-4000-8000-000000000003',
      expectedVersion: 1,
      operationId: 'submission-withdraw-0003',
      reasonCode: 'free text is not a reason code',
      requestId: 'http-request-withdraw',
    }), 'SUBMISSION_REASON_CODE_INVALID', 422)
    assert.equal(store.withdrawnSubmission, null)
  })
})
