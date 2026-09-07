import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type {
  EvidenceBinding,
  EvidenceDraft,
  MediaReference,
  MediaResource,
  Submission as ContractSubmission,
  SubmissionDraft as ContractSubmissionDraft,
  SubmissionPreview as ContractSubmissionPreview,
  SubmissionUrlCheck,
} from '@vibecheck/contracts'
import { installMockAuth, type MockAuthProfile } from './mock-auth'

export type SubmissionCategory = 'ai_learning_quiz' | 'personal_site_portfolio'

export const submissionFlowNow = '2026-09-01T00:00:00.000Z'
export const submissionFlowExpiresAt = '2099-10-01T00:00:00.000Z'
export const submissionFlowPreviewHash = 'f'.repeat(64)

// A small patterned PNG fixture. The browser uploads these bytes through the
// signed PUT route; the mock therefore exercises File -> checksum -> upload ->
// media completion with a visible, non-empty cover asset.
export const submissionFlowPng = readFileSync(new URL('../fixtures/slice2-cover.png', import.meta.url))

export type SubmissionFlowIds = Readonly<{
  checkId: string
  chainId: string
  draftId: string
  mediaResourceId: string
  mediaReferenceId: string
  evidenceDraftId: string
  submissionId: string
  reviewWorkItemId: string
}>

export type SubmissionRequestKind =
  | 'url-check'
  | 'draft-create'
  | 'draft-get'
  | 'draft-patch'
  | 'media-prepare'
  | 'upload-put'
  | 'media-complete'
  | 'media-inspect'
  | 'media-reference-list'
  | 'media-reference-create'
  | 'media-reference-delete'
  | 'evidence-create'
  | 'evidence-get'
  | 'evidence-patch'
  | 'evidence-bind'
  | 'evidence-complete'
  | 'preview'
  | 'submit'

export type SubmissionFlowRequest = Readonly<{
  kind: SubmissionRequestKind
  url: string
  method: string
  body?: Record<string, unknown>
  uploadBytes?: number
  uploadIsPng?: boolean
  uploadHadCookie?: boolean
  uploadHeaders?: Record<string, string>
}>

export type SubmissionFlow = Readonly<{
  category: SubmissionCategory
  publicUrl: string
  ids: SubmissionFlowIds
  auth: Awaited<ReturnType<typeof installMockAuth>>
  requests: SubmissionFlowRequest[]
  invariantViolations: string[]
  requestKinds: () => SubmissionRequestKind[]
  mediaChecksum: () => string
  submissionId: string
  reviewWorkItemId: string
  assertReady: () => void
}>

type Body = Record<string, unknown> | undefined

type CategoryConfig = Readonly<{
  category: SubmissionCategory
  schema: 'learning.v1' | 'portfolio.v1'
  publicUrl: string
  ids: SubmissionFlowIds
}>

const configs: Record<SubmissionCategory, CategoryConfig> = {
  ai_learning_quiz: {
    category: 'ai_learning_quiz',
    schema: 'learning.v1',
    publicUrl: 'https://example.test/slice2-learning',
    ids: {
      checkId: 'a1111111-1111-4111-8111-111111111111',
      chainId: 'a2222222-2222-4222-8222-222222222222',
      draftId: 'a3333333-3333-4333-8333-333333333333',
      mediaResourceId: 'a4444444-4444-4444-8444-444444444444',
      mediaReferenceId: 'a5555555-5555-4555-8555-555555555555',
      evidenceDraftId: 'a6666666-6666-4666-8666-666666666666',
      submissionId: 'a7777777-7777-4777-8777-777777777777',
      reviewWorkItemId: 'a8888888-8888-4888-8888-888888888888',
    },
  },
  personal_site_portfolio: {
    category: 'personal_site_portfolio',
    schema: 'portfolio.v1',
    publicUrl: 'https://example.test/slice2-portfolio',
    ids: {
      checkId: 'b1111111-1111-4111-8111-111111111111',
      chainId: 'b2222222-2222-4222-8222-222222222222',
      draftId: 'b3333333-3333-4333-8333-333333333333',
      mediaResourceId: 'b4444444-4444-4444-8444-444444444444',
      mediaReferenceId: 'b5555555-5555-4555-8555-555555555555',
      evidenceDraftId: 'b6666666-6666-4666-8666-666666666666',
      submissionId: 'b7777777-7777-4777-8777-777777777777',
      reviewWorkItemId: 'b8888888-8888-4888-8888-888888888888',
    },
  },
}

function jsonBody(value: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  }
}

function errorBody(code: string) {
  return {
    error: {
      code,
      message_key: `submission.${code.toLowerCase()}`,
      request_id: `slice2-${code.toLowerCase()}`,
      retryable: false,
      retry_after_ms: null,
    },
  }
}

function parseBody(route: Route): Body {
  try {
    const value = route.request().postDataJSON()
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function recordKind(path: string, method: string): SubmissionRequestKind | null {
  if (method === 'PUT') return 'upload-put'
  if (path === '/api/v1/submission-url-checks' && method === 'POST') return 'url-check'
  if (path === '/api/v1/submission-drafts' && method === 'POST') return 'draft-create'
  if (/^\/api\/v1\/submission-drafts\/[^/]+\/preview$/.test(path) && method === 'POST') return 'preview'
  if (/^\/api\/v1\/submission-drafts\/[^/]+$/.test(path)) return method === 'PATCH' ? 'draft-patch' : method === 'GET' ? 'draft-get' : null
  if (path === '/api/v1/media-resources' && method === 'POST') return 'media-prepare'
  if (/^\/api\/v1\/media-resources\/[^/]+\/complete$/.test(path) && method === 'POST') return 'media-complete'
  if (/^\/api\/v1\/media-resources\/[^/]+$/.test(path) && method === 'GET') return 'media-inspect'
  if (path === '/api/v1/media-references' && method === 'GET') return 'media-reference-list'
  if (path === '/api/v1/media-references' && method === 'POST') return 'media-reference-create'
  if (/^\/api\/v1\/media-references\/[^/]+$/.test(path) && method === 'DELETE') return 'media-reference-delete'
  if (path === '/api/v1/evidence-drafts' && method === 'POST') return 'evidence-create'
  if (/^\/api\/v1\/evidence-drafts\/[^/]+\/binding$/.test(path) && method === 'POST') return 'evidence-bind'
  if (/^\/api\/v1\/evidence-drafts\/[^/]+\/complete$/.test(path) && method === 'POST') return 'evidence-complete'
  if (/^\/api\/v1\/evidence-drafts\/[^/]+$/.test(path)) return method === 'PATCH' ? 'evidence-patch' : method === 'GET' ? 'evidence-get' : null
  if (path === '/api/v1/submissions' && method === 'POST') return 'submit'
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptySnapshot(config: CategoryConfig, publicUrl: string): Readonly<Record<string, unknown>> {
  return {
    project_core: { public_url: publicUrl },
    category_id: config.category,
    category_schema_version: config.schema,
  }
}

function draftProjection(
  config: CategoryConfig,
  publicUrl: string,
  version: number,
  snapshot: Readonly<Record<string, unknown>>,
  mediaReferenceIds: readonly string[],
  evidenceDraftIds: readonly string[],
): ContractSubmissionDraft {
  return {
    draft_id: config.ids.draftId,
    submission_chain_id: config.ids.chainId,
    category_id: config.category,
    category_schema_version: config.schema,
    check_id: config.ids.checkId,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    payload_snapshot: snapshot,
    media_reference_ids: [...mediaReferenceIds],
    evidence_draft_ids: [...evidenceDraftIds],
    asset_drafts: [],
    status: 'editing',
    version,
    created_at: submissionFlowNow,
    updated_at: submissionFlowNow,
    saved_at: submissionFlowNow,
    expires_at: submissionFlowExpiresAt,
  }
}

function mediaProjection(
  mediaResourceId: string,
  checksumSha256: string,
  byteSize: number,
  declaredMime: string,
  overrides: Partial<MediaResource> = {},
): MediaResource {
  return {
    media_resource_id: mediaResourceId,
    declared_mime: declaredMime,
    detected_mime: 'image/png',
    byte_size: byteSize,
    width: null,
    height: null,
    duration_ms: null,
    checksum_sha256: checksumSha256,
    source: 'upload',
    status: 'ready',
    scan_result: 'clean',
    rejection_reason_code: null,
    scan_attempt_count: 1,
    next_scan_at: null,
    exif_removed: true,
    deletion_guard_active: false,
    version: 2,
    created_at: submissionFlowNow,
    updated_at: submissionFlowNow,
    ...overrides,
  }
}

function referenceProjection(config: CategoryConfig): MediaReference {
  return {
    media_reference_id: config.ids.mediaReferenceId,
    media_resource_id: config.ids.mediaResourceId,
    target_type: 'submission_draft',
    target_id: config.ids.draftId,
    role: 'cover',
    alt_text: '提交作品封面',
    sort_order: 0,
    crop_focus: null,
    variant: null,
    source_media_reference_id: null,
    version: 1,
    created_at: submissionFlowNow,
    updated_at: submissionFlowNow,
  }
}

function evidenceProjection(
  config: CategoryConfig,
  status: EvidenceDraft['status'],
  bound: boolean,
  version: number,
  sourceUrl: string | null,
): EvidenceDraft {
  return {
    evidence_draft_id: config.ids.evidenceDraftId,
    collector_actor_type: 'user',
    parent_type: 'submission_draft',
    parent_id: config.ids.draftId,
    final_target_kind: 'project',
    target_asset_draft_key: null,
    evidence_type: 'trusted_external_source',
    source_channel: 'official_site',
    field_path: '/project_core/public_url',
    requested_visibility: 'public',
    source_url: sourceUrl,
    text_excerpt: null,
    attachment_drafts: [],
    status,
    bound,
    source_hash: 'e'.repeat(64),
    final_field_preview: {
      source_summary: '公开来源',
      captured_at: submissionFlowNow,
      collected_by: 'user',
      confidence: 'high',
      source_channel: 'official_site',
    },
    completed_at: status === 'ready' ? submissionFlowNow : null,
    promoted_evidence_id: null,
    version,
    created_at: submissionFlowNow,
    updated_at: submissionFlowNow,
  }
}

function previewProjection(
  config: CategoryConfig,
  version: number,
  snapshot: Readonly<Record<string, unknown>>,
): ContractSubmissionPreview {
  return {
    draft_id: config.ids.draftId,
    draft_version: version,
    check_id: config.ids.checkId,
    preview_hash: submissionFlowPreviewHash,
    payload_snapshot: snapshot,
    media_reference_ids: [config.ids.mediaReferenceId],
    evidence_draft_ids: [config.ids.evidenceDraftId],
    validation: { valid: true, issue_count: 0 },
    generated_at: submissionFlowNow,
  }
}

function submissionProjection(config: CategoryConfig, version: number): ContractSubmission {
  return {
    submission_id: config.ids.submissionId,
    submission_chain_id: config.ids.chainId,
    draft_id: config.ids.draftId,
    snapshot_version: version,
    review_status: 'pending_review',
    review_work_item_id: config.ids.reviewWorkItemId,
    media_reference_ids: [config.ids.mediaReferenceId],
    evidence_draft_ids: [config.ids.evidenceDraftId],
    preview_hash: submissionFlowPreviewHash,
    version: 1,
    created_at: submissionFlowNow,
    updated_at: submissionFlowNow,
  }
}

function hasPngSignature(bytes: Buffer | null): boolean {
  if (!bytes || bytes.length < 8) return false
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return signature.every((byte, index) => bytes[index] === byte)
}

async function fallback(route: Route) {
  if (typeof route.fallback === 'function') await route.fallback()
  else await route.continue()
}

export async function installSubmissionFlow(
  page: Page,
  options: Readonly<{ category: SubmissionCategory }>,
): Promise<SubmissionFlow> {
  const config = configs[options.category]
  const auth = await installMockAuth(page)
  const requests: SubmissionFlowRequest[] = []
  const invariantViolations: string[] = []
  let publicUrl = config.publicUrl
  let draftVersion = 3
  let serverSnapshot = emptySnapshot(config, publicUrl)
  let mediaChecksum = ''
  let mediaByteSize = 0
  let mediaDeclaredMime = 'image/png'
  let uploadSeen = false
  let uploadReceipt: string | null = null
  let mediaCompleted = false
  let coverReferenceCreated = false
  let coverSnapshotPatched = false
  let evidenceCreated = false
  let evidenceBound = false
  let evidencePatched = false
  let evidenceCompletedReady = false
  let previewIssued = false
  let submitted = false

  const violation = async (route: Route, message: string, code = 'SLICE2_ID_OR_VERSION_MISMATCH') => {
    invariantViolations.push(message)
    await route.fulfill(jsonBody(errorBody(code), 422))
  }

  await page.route('**/uploads.example.test/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? 'content-type, x-upload-token',
      'access-control-allow-methods': 'PUT, OPTIONS',
      'access-control-expose-headers': 'etag',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (request.method() !== 'PUT') {
      await fallback(route)
      return
    }
    const bytes = request.postDataBuffer()
    const isPng = hasPngSignature(bytes)
    const headers = await request.allHeaders()
    requests.push({
      kind: 'upload-put',
      url: request.url(),
      method: request.method(),
      uploadBytes: bytes?.length ?? 0,
      uploadIsPng: isPng,
      uploadHadCookie: Object.hasOwn(request.headers(), 'cookie'),
      uploadHeaders: headers,
    })
    if (url.pathname !== `/${config.ids.mediaResourceId}` || !isPng) {
      await violation(route, 'signed upload did not use the returned media ID and a valid PNG')
      return
    }
    uploadSeen = true
    uploadReceipt = 'slice2-upload-receipt'
    await route.fulfill({ status: 200, headers: { ...corsHeaders, etag: uploadReceipt } })
  })

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const parsed = new URL(request.url())
    const path = parsed.pathname
    const method = request.method()
    const kind = recordKind(path, method)
    const body = parseBody(route)

    if (kind === null) {
      await fallback(route)
      return
    }

    requests.push({ kind, url: request.url(), method, ...(body === undefined ? {} : { body }) })

    if (kind === 'url-check') {
      if (typeof body?.raw_url !== 'string' || body.category_hint !== config.category) {
        await violation(route, 'URL check did not preserve the selected category and URL')
        return
      }
      publicUrl = /^https?:\/\//i.test(body.raw_url) ? body.raw_url : `https://${body.raw_url}`
      await route.fulfill(jsonBody({
        check_id: config.ids.checkId,
        category_id: config.category,
        category_schema_version: config.schema,
        input_hash: 'a'.repeat(64),
        canonical_url: publicUrl,
        redirect_chain: [],
        risk_result: 'allowed',
        access_result: 'accessible',
        category_result: 'matched',
        duplicate_result: 'none',
        duplicate_candidates: [],
        risk_reasons: [],
        can_create_draft: true,
        checked_at: submissionFlowNow,
        expires_at: submissionFlowExpiresAt,
      } satisfies SubmissionUrlCheck, 201))
      return
    }

    if (kind === 'draft-create') {
      if (body?.check_id !== config.ids.checkId || body.category_id !== config.category) {
        await violation(route, 'draft create did not reuse the URL check and category')
        return
      }
      await route.fulfill(jsonBody(draftProjection(config, publicUrl, draftVersion, serverSnapshot, [], []), 201))
      return
    }

    const draftMatch = /^\/api\/v1\/submission-drafts\/([^/]+)$/.exec(path)
    if (draftMatch && (kind === 'draft-get' || kind === 'draft-patch')) {
      if (draftMatch[1] !== config.ids.draftId) {
        await violation(route, 'draft operation did not reuse the returned draft ID')
        return
      }
      const mediaReferenceIds = coverReferenceCreated ? [config.ids.mediaReferenceId] : []
      const evidenceDraftIds = evidenceCompletedReady ? [config.ids.evidenceDraftId] : []
      if (kind === 'draft-get') {
        await route.fulfill(jsonBody(draftProjection(config, publicUrl, draftVersion, serverSnapshot, mediaReferenceIds, evidenceDraftIds)))
        return
      }
      if (body?.expected_version !== draftVersion || !isRecord(body.patch)) {
        await violation(route, 'draft patch did not use the current version and canonical snapshot')
        return
      }
      serverSnapshot = body.patch
      const projectCore = isRecord(serverSnapshot.project_core) ? serverSnapshot.project_core : undefined
      const coverIds = projectCore?.cover_media_reference_ids
      if (coverReferenceCreated && Array.isArray(coverIds) && coverIds.length === 1 && coverIds[0] === config.ids.mediaReferenceId) {
        coverSnapshotPatched = true
      }
      draftVersion += 1
      await route.fulfill(jsonBody(draftProjection(config, publicUrl, draftVersion, serverSnapshot, mediaReferenceIds, evidenceDraftIds)))
      return
    }

    if (kind === 'media-prepare') {
      if (body?.purpose !== 'project_cover' || body.declared_mime !== 'image/png' || typeof body.checksum_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(body.checksum_sha256)) {
        await violation(route, 'media prepare did not use a PNG and a SHA-256 checksum')
        return
      }
      mediaChecksum = body.checksum_sha256
      mediaByteSize = typeof body.byte_size === 'number' ? body.byte_size : 0
      mediaDeclaredMime = typeof body.declared_mime === 'string' ? body.declared_mime : 'image/png'
      await route.fulfill(jsonBody({
        media: mediaProjection(config.ids.mediaResourceId, mediaChecksum, mediaByteSize, mediaDeclaredMime, {
          status: 'uploading',
          scan_result: 'not_scanned',
          exif_removed: false,
          version: 1,
        }),
        upload_url: `https://uploads.example.test/${config.ids.mediaResourceId}`,
        upload_headers: { 'content-type': 'image/png', 'x-upload-token': 'slice2-upload-token' },
        upload_expires_at: submissionFlowExpiresAt,
      }, 201))
      return
    }

    const mediaCompleteMatch = /^\/api\/v1\/media-resources\/([^/]+)\/complete$/.exec(path)
    if (mediaCompleteMatch && kind === 'media-complete') {
      if (mediaCompleteMatch[1] !== config.ids.mediaResourceId || !uploadSeen || body?.checksum_sha256 !== mediaChecksum || body.upload_receipt !== uploadReceipt) {
        await violation(route, 'media complete did not reuse the prepared ID, checksum, upload and receipt')
        return
      }
      mediaCompleted = true
      await route.fulfill(jsonBody({
        media: mediaProjection(config.ids.mediaResourceId, mediaChecksum, mediaByteSize, mediaDeclaredMime, {
          status: 'processing',
          scan_result: 'not_scanned',
          exif_removed: false,
          version: 2,
        }),
        scan_queued: true,
      }, 202))
      return
    }

    const mediaGetMatch = /^\/api\/v1\/media-resources\/([^/]+)$/.exec(path)
    if (mediaGetMatch && kind === 'media-inspect') {
      if (mediaGetMatch[1] !== config.ids.mediaResourceId || !mediaCompleted) {
        await violation(route, 'media inspect did not reuse the completed media ID')
        return
      }
      await route.fulfill(jsonBody(mediaProjection(config.ids.mediaResourceId, mediaChecksum, mediaByteSize, mediaDeclaredMime)))
      return
    }

    if (kind === 'media-reference-list') {
      const items = coverReferenceCreated ? [referenceProjection(config)] : []
      await route.fulfill(jsonBody({ items, total_count: items.length }))
      return
    }

    if (kind === 'media-reference-create') {
      if (body?.media_resource_id !== config.ids.mediaResourceId || body.target_id !== config.ids.draftId || body.role !== 'cover') {
        await violation(route, 'cover reference did not reuse the media, draft and role')
        return
      }
      coverReferenceCreated = true
      draftVersion = 5
      await route.fulfill(jsonBody(referenceProjection(config), 201))
      return
    }

    const mediaReferenceDeleteMatch = /^\/api\/v1\/media-references\/([^/]+)$/.exec(path)
    if (mediaReferenceDeleteMatch && kind === 'media-reference-delete') {
      if (mediaReferenceDeleteMatch[1] !== config.ids.mediaReferenceId || body?.expected_version !== 1) {
        await violation(route, 'cover reference delete did not use the returned reference and version')
        return
      }
      coverReferenceCreated = false
      await route.fulfill({ status: 204 })
      return
    }

    if (kind === 'evidence-create') {
      if (body?.parent_id !== config.ids.draftId || body.field_path !== '/project_core/public_url' || body.source_channel !== 'official_site') {
        await violation(route, 'evidence create did not bind to the draft public URL')
        return
      }
      evidenceCreated = true
      await route.fulfill(jsonBody(evidenceProjection(config, 'editing', false, 1, null), 201))
      return
    }

    const evidenceMatch = /^\/api\/v1\/evidence-drafts\/([^/]+)(?:\/(binding|complete))?$/.exec(path)
    if (evidenceMatch && (kind === 'evidence-get' || kind === 'evidence-patch' || kind === 'evidence-bind' || kind === 'evidence-complete')) {
      if (evidenceMatch[1] !== config.ids.evidenceDraftId) {
        await violation(route, 'evidence operation did not reuse the returned evidence ID')
        return
      }
      if (kind === 'evidence-get') {
        await route.fulfill(jsonBody(evidenceProjection(config, evidenceCompletedReady ? 'ready' : 'editing', evidenceBound, evidenceCompletedReady ? 4 : evidencePatched ? 3 : evidenceBound ? 2 : 1, evidencePatched || evidenceCompletedReady ? publicUrl : null)))
        return
      }
      if (kind === 'evidence-bind') {
        if (!evidenceCreated || body?.parent_id !== config.ids.draftId || body.expected_parent_version !== 6 || !coverSnapshotPatched) {
          await violation(route, 'evidence bind did not use the cover PATCH version')
          return
        }
        evidenceBound = true
        draftVersion = 7
        const binding: EvidenceBinding = {
          parent_type: 'submission_draft',
          parent_id: config.ids.draftId,
          evidence_draft_ids: [config.ids.evidenceDraftId],
          parent_version: 6,
          evidence_draft_version: 2,
        }
        await route.fulfill(jsonBody(binding))
        return
      }
      if (kind === 'evidence-patch') {
        if (!evidenceBound || body?.expected_version !== 2 || body.source_url !== publicUrl) {
          await violation(route, 'evidence patch did not use the bound version and checked URL')
          return
        }
        evidencePatched = true
        await route.fulfill(jsonBody(evidenceProjection(config, 'editing', true, 3, publicUrl)))
        return
      }
      if (!evidenceCreated || !evidenceBound || !evidencePatched || body?.expected_version !== 3) {
        await violation(route, 'evidence complete did not use the bound and patched evidence')
        return
      }
      evidenceCompletedReady = true
      await route.fulfill(jsonBody(evidenceProjection(config, 'ready', true, 4, publicUrl)))
      return
    }

    const previewMatch = /^\/api\/v1\/submission-drafts\/([^/]+)\/preview$/.exec(path)
    if (previewMatch && kind === 'preview') {
      if (previewMatch[1] !== config.ids.draftId || body?.expected_version !== draftVersion || body.check_id !== config.ids.checkId || !coverSnapshotPatched || !evidenceCompletedReady) {
        await violation(route, 'preview did not use the latest draft, check, cover and evidence')
        return
      }
      previewIssued = true
      await route.fulfill(jsonBody(previewProjection(config, draftVersion, serverSnapshot)))
      return
    }

    if (kind === 'submit') {
      if (!previewIssued || body?.draft_id !== config.ids.draftId || body.draft_version !== draftVersion || body.check_id !== config.ids.checkId || body.preview_hash !== submissionFlowPreviewHash || typeof body.submission_key !== 'string') {
        await violation(route, 'submit did not reuse the preview receipt and current draft')
        return
      }
      submitted = true
      await route.fulfill(jsonBody(submissionProjection(config, draftVersion), 202))
      return
    }

    await fallback(route)
  })

  const assertReady = () => {
    const required: SubmissionRequestKind[] = [
      'url-check', 'draft-create', 'draft-get', 'draft-patch', 'media-prepare', 'upload-put',
      'media-complete', 'media-inspect', 'media-reference-create', 'evidence-create',
      'evidence-bind', 'evidence-patch', 'evidence-complete', 'preview', 'submit',
    ]
    const seen = new Set(requests.map((request) => request.kind))
    for (const kind of required) {
      if (!seen.has(kind)) invariantViolations.push(`missing required request: ${kind}`)
    }
    if (!requests.some((request) => request.kind === 'upload-put' && request.uploadIsPng && (request.uploadBytes ?? 0) > 0)) {
      invariantViolations.push('the flow did not upload a non-empty PNG')
    }
    if (!coverSnapshotPatched || !evidenceCompletedReady || !previewIssued || !submitted) {
      invariantViolations.push('the flow did not reach the complete pending-review state')
    }
    if (invariantViolations.length > 0) throw new Error(invariantViolations.join('; '))
  }

  return {
    category: config.category,
    publicUrl: config.publicUrl,
    ids: config.ids,
    auth,
    requests,
    invariantViolations,
    requestKinds: () => requests.map((request) => request.kind),
    mediaChecksum: () => mediaChecksum,
    submissionId: config.ids.submissionId,
    reviewWorkItemId: config.ids.reviewWorkItemId,
    assertReady,
  }
}

export function profileForSubmission(): MockAuthProfile {
  return 'mia'
}
