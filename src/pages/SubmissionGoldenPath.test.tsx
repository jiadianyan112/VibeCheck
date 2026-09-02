import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { AppProviders } from '../app/providers'
import { appRoutes } from '../app/router'
import { prototypeUsers } from '../mocks'
import { APP_STORAGE_KEY, appReducer, createInitialAppState, persistAppState } from '../state'
import type { SubmissionDraft as LocalSubmissionDraft } from '../types'

const publicUrl = 'https://example.test/golden-path'
const now = '2026-08-28T00:00:00Z'
const expiresAt = '2026-09-28T00:00:00Z'
const previewHash = 'd'.repeat(64)
const preparedUploadHeaders = { 'content-type': 'image/png', 'x-upload-token': 'golden-upload-token' }
const uploadReceiptValue = 'golden-upload-receipt'

type IdName =
  | 'checkId'
  | 'chainId'
  | 'draftId'
  | 'mediaResourceId'
  | 'mediaReferenceId'
  | 'evidenceDraftId'
  | 'submissionId'
  | 'reviewWorkItemId'

type IssuedIds = Partial<Record<IdName, string>>

type RequestRecord = {
  readonly url: string
  readonly method: string
  readonly init?: RequestInit
  readonly body?: Record<string, unknown>
}

type DraftRefresh = {
  readonly version: number
  readonly mediaReferenceIds: readonly string[]
  readonly evidenceDraftIds: readonly string[]
}

type GoldenTransportOptions = {
  readonly evidenceReady?: boolean
}

function loginInStorage() {
  const state = appReducer(createInitialAppState(), {
    type: 'LOGIN_COMPLETED',
    user: prototypeUsers[0]!,
  })
  persistAppState(state)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, code = 'REQUEST_FAILED') {
  return jsonResponse({
    error: {
      code,
      message_key: 'submission.request_failed',
      request_id: `golden-${status}`,
      retryable: false,
      retry_after_ms: null,
    },
  }, status)
}

function parseBody(init?: RequestInit): Record<string, unknown> | undefined {
  if (typeof init?.body !== 'string') return undefined
  try {
    return JSON.parse(init.body) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function issueId(ids: IssuedIds, name: IdName): string {
  if (ids[name] === undefined) ids[name] = crypto.randomUUID()
  return ids[name]!
}

function emptyLearningDraftSnapshot(): Readonly<Record<string, unknown>> {
  return {
    project_core: {
      public_url: publicUrl,
    },
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
  }
}

function draftProjection(
  ids: Required<Pick<IssuedIds, 'draftId' | 'chainId' | 'checkId'>>,
  version: number,
  snapshot: Readonly<Record<string, unknown>>,
  mediaReferenceIds: readonly string[],
  evidenceDraftIds: readonly string[],
): ContractSubmissionDraft {
  return {
    draft_id: ids.draftId,
    submission_chain_id: ids.chainId,
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    check_id: ids.checkId,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    // A create/GET projection contains only the URL/category until the author
    // reaches the final materials action. References are metadata, not a
    // shortcut that silently rewrites payload_snapshot.
    payload_snapshot: snapshot,
    media_reference_ids: [...mediaReferenceIds],
    evidence_draft_ids: [...evidenceDraftIds],
    asset_drafts: [],
    status: 'editing',
    version,
    created_at: now,
    updated_at: now,
    saved_at: now,
    expires_at: expiresAt,
  }
}

function mediaProjection(
  mediaResourceId: string,
  checksumSha256: string,
  overrides: Partial<MediaResource> = {},
): MediaResource {
  return {
    media_resource_id: mediaResourceId,
    declared_mime: 'image/png',
    detected_mime: 'image/png',
    byte_size: 1_048_576,
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
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function referenceProjection(mediaResourceId: string, mediaReferenceId: string, draftId: string): MediaReference {
  return {
    media_reference_id: mediaReferenceId,
    media_resource_id: mediaResourceId,
    target_type: 'submission_draft',
    target_id: draftId,
    role: 'cover',
    alt_text: '提交作品封面',
    sort_order: 0,
    crop_focus: null,
    variant: null,
    source_media_reference_id: null,
    version: 1,
    created_at: now,
    updated_at: now,
  }
}

function evidenceProjection(
  evidenceDraftId: string,
  draftId: string,
  status: EvidenceDraft['status'],
  bound: boolean,
  version: number,
  sourceUrl: string | null,
): EvidenceDraft {
  return {
    evidence_draft_id: evidenceDraftId,
    collector_actor_type: 'user',
    parent_type: 'submission_draft',
    parent_id: draftId,
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
    source_hash: 'b'.repeat(64),
    final_field_preview: {
      source_summary: '公开来源',
      captured_at: now,
      collected_by: 'user',
      confidence: 'high',
      source_channel: 'official_site',
    },
    completed_at: status === 'ready' ? now : null,
    promoted_evidence_id: null,
    version,
    created_at: now,
    updated_at: now,
  }
}

function previewProjection(
  ids: Required<Pick<IssuedIds, 'draftId' | 'checkId'>>,
  version: number,
  mediaReferenceId: string,
  evidenceDraftId: string,
  snapshot: Readonly<Record<string, unknown>>,
): ContractSubmissionPreview {
  return {
    draft_id: ids.draftId,
    draft_version: version,
    check_id: ids.checkId,
    preview_hash: previewHash,
    payload_snapshot: snapshot,
    media_reference_ids: [mediaReferenceId],
    evidence_draft_ids: [evidenceDraftId],
    validation: { valid: true, issue_count: 0 },
    generated_at: now,
  }
}

function submissionProjection(
  ids: Required<Pick<IssuedIds, 'draftId' | 'chainId' | 'submissionId' | 'reviewWorkItemId'>>,
  version: number,
  mediaReferenceId: string,
  evidenceDraftId: string,
): ContractSubmission {
  return {
    submission_id: ids.submissionId,
    submission_chain_id: ids.chainId,
    draft_id: ids.draftId,
    snapshot_version: version,
    review_status: 'pending_review',
    review_work_item_id: ids.reviewWorkItemId,
    media_reference_ids: [mediaReferenceId],
    evidence_draft_ids: [evidenceDraftId],
    preview_hash: previewHash,
    version: 1,
    created_at: now,
    updated_at: now,
  }
}

function installStatefulTransport(options: GoldenTransportOptions = {}) {
  const ids: IssuedIds = {}
  const requests: RequestRecord[] = []
  const draftRefreshes: DraftRefresh[] = []
  const invariantViolations: string[] = []
  let draftVersion = 3
  let serverSnapshot = emptyLearningDraftSnapshot()
  let mediaChecksum = ''
  let uploadSeen = false
  let mediaCompleted = false
  let coverReferenceCreated = false
  let coverSnapshotPatched = false
  let evidenceCreated = false
  let evidenceBound = false
  let evidencePatched = false
  let evidenceCompletedReady = false
  let evidenceReady = options.evidenceReady ?? true
  let previewIssued = false
  let uploadReceipt: string | null = null

  const violation = (message: string) => {
    invariantViolations.push(message)
    return errorResponse(422, 'GOLDEN_PATH_ID_OR_VERSION_MISMATCH')
  }

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = String(input)
    const parsedUrl = new URL(rawUrl, window.location.origin)
    const path = parsedUrl.pathname
    const method = init?.method ?? 'GET'
    const body = parseBody(init)
    requests.push({ url: rawUrl, method, init, body })

    if (method === 'PUT' && parsedUrl.hostname === 'uploads.example.test') {
      if (ids.mediaResourceId === undefined || !path.endsWith(`/${ids.mediaResourceId}`)) {
        return violation('signed upload did not use the media ID returned by prepare')
      }
      uploadSeen = true
      const uploadResponse = new Response(null, { status: 200, headers: { etag: uploadReceiptValue } })
      uploadReceipt = uploadResponse.headers.get('etag')
      return uploadResponse
    }

    if (path === '/api/v1/submission-url-checks' && method === 'POST') {
      return jsonResponse({
        check_id: issueId(ids, 'checkId'),
        category_id: 'ai_learning_quiz',
        category_schema_version: 'learning.v1',
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
        checked_at: now,
        expires_at: expiresAt,
      } satisfies SubmissionUrlCheck, 201)
    }

    if (path === '/api/v1/submission-drafts' && method === 'POST') {
      if (body?.check_id !== ids.checkId) return violation('draft create did not reuse the returned check ID')
      const draftId = issueId(ids, 'draftId')
      const chainId = issueId(ids, 'chainId')
      return jsonResponse(draftProjection({ draftId, chainId, checkId: ids.checkId! }, draftVersion, serverSnapshot, [], []), 201)
    }

    const draftMatch = /^\/api\/v1\/submission-drafts\/([^/]+)$/.exec(path)
    if (draftMatch !== null) {
      if (draftMatch[1] !== ids.draftId) return violation('draft operation did not reuse the returned draft ID')
      const draftIds = { draftId: ids.draftId!, chainId: ids.chainId!, checkId: ids.checkId! }
      const mediaReferenceIds = coverReferenceCreated ? [ids.mediaReferenceId!] : []
      const evidenceDraftIds = evidenceCompletedReady ? [ids.evidenceDraftId!] : []
      if (method === 'GET') {
        draftRefreshes.push({ version: draftVersion, mediaReferenceIds, evidenceDraftIds })
        return jsonResponse(draftProjection(draftIds, draftVersion, serverSnapshot, mediaReferenceIds, evidenceDraftIds))
      }
      if (method === 'PATCH') {
        if (body?.expected_version !== draftVersion) return violation('draft patch did not use the current server version')
        if (typeof body.patch !== 'object' || body.patch === null || Array.isArray(body.patch)) return violation('draft patch omitted the canonical snapshot')
        serverSnapshot = body.patch as Readonly<Record<string, unknown>>
        const projectCore = serverSnapshot.project_core
        const coverIds = projectCore && typeof projectCore === 'object' && !Array.isArray(projectCore)
          ? (projectCore as Record<string, unknown>).cover_media_reference_ids
          : undefined
        if (coverReferenceCreated && Array.isArray(coverIds) && coverIds.length === 1 && coverIds[0] === ids.mediaReferenceId) coverSnapshotPatched = true
        draftVersion += 1
        return jsonResponse(draftProjection(draftIds, draftVersion, serverSnapshot, mediaReferenceIds, evidenceDraftIds))
      }
      return errorResponse(405)
    }

    if (path === '/api/v1/media-resources' && method === 'POST') {
      const mediaResourceId = issueId(ids, 'mediaResourceId')
      mediaChecksum = String(body?.checksum_sha256 ?? '')
      return jsonResponse({
        media: mediaProjection(mediaResourceId, mediaChecksum, {
          status: 'uploading',
          scan_result: 'not_scanned',
          exif_removed: false,
          version: 1,
        }),
        upload_url: `https://uploads.example.test/${mediaResourceId}`,
        upload_headers: preparedUploadHeaders,
        upload_expires_at: '2026-08-28T01:00:00Z',
      }, 201)
    }

    const mediaCompleteMatch = /^\/api\/v1\/media-resources\/([^/]+)\/complete$/.exec(path)
    if (mediaCompleteMatch !== null && method === 'POST') {
      if (mediaCompleteMatch[1] !== ids.mediaResourceId || !uploadSeen) return violation('media complete did not reuse the prepared media ID or upload receipt')
      if (body?.checksum_sha256 !== mediaChecksum || body?.upload_receipt !== uploadReceipt) return violation('media complete did not reuse the prepared checksum or signed upload receipt')
      mediaCompleted = true
      return jsonResponse({
        media: mediaProjection(ids.mediaResourceId!, mediaChecksum, {
          status: 'processing',
          scan_result: 'not_scanned',
          exif_removed: false,
          version: 2,
        }),
        scan_queued: true,
      }, 202)
    }

    const mediaGetMatch = /^\/api\/v1\/media-resources\/([^/]+)$/.exec(path)
    if (mediaGetMatch !== null && method === 'GET') {
      if (mediaGetMatch[1] !== ids.mediaResourceId || !mediaCompleted) return violation('media inspect did not reuse the completed media ID')
      return jsonResponse(mediaProjection(ids.mediaResourceId!, mediaChecksum))
    }

    if (path === '/api/v1/media-references' && method === 'POST') {
      if (body?.media_resource_id !== ids.mediaResourceId || body?.target_id !== ids.draftId) return violation('cover reference did not reuse the media and draft IDs')
      const mediaReferenceId = issueId(ids, 'mediaReferenceId')
      if (!coverReferenceCreated) {
        coverReferenceCreated = true
        draftVersion = 5
      }
      return jsonResponse(referenceProjection(ids.mediaResourceId!, mediaReferenceId, ids.draftId!), 201)
    }

    if (path === '/api/v1/evidence-drafts' && method === 'POST') {
      if (body?.parent_id !== ids.draftId) return violation('evidence create did not reuse the returned draft ID')
      const evidenceDraftId = issueId(ids, 'evidenceDraftId')
      evidenceCreated = true
      return jsonResponse(evidenceProjection(evidenceDraftId, ids.draftId!, 'editing', false, 1, null), 201)
    }

    const evidenceBindMatch = /^\/api\/v1\/evidence-drafts\/([^/]+)\/binding$/.exec(path)
    if (evidenceBindMatch !== null && method === 'POST') {
      if (evidenceBindMatch[1] !== ids.evidenceDraftId || body?.parent_id !== ids.draftId || body?.expected_parent_version !== 6 || !coverSnapshotPatched) return violation('evidence bind did not reuse the cover PATCH response version')
      if (!evidenceBound) {
        evidenceBound = true
        draftVersion = 7
      }
      const binding: EvidenceBinding = {
        parent_type: 'submission_draft',
        parent_id: ids.draftId!,
        evidence_draft_ids: [ids.evidenceDraftId!],
        parent_version: 6,
        evidence_draft_version: 2,
      }
      return jsonResponse(binding)
    }

    const evidencePatchMatch = /^\/api\/v1\/evidence-drafts\/([^/]+)$/.exec(path)
    if (evidencePatchMatch !== null && method === 'PATCH') {
      if (evidencePatchMatch[1] !== ids.evidenceDraftId || body?.expected_version !== 2 || body?.source_url !== publicUrl) return violation('evidence patch did not reuse the returned evidence ID or checked URL')
      evidencePatched = true
      return jsonResponse(evidenceProjection(ids.evidenceDraftId!, ids.draftId!, 'editing', true, 3, publicUrl))
    }

    const evidenceCompleteMatch = /^\/api\/v1\/evidence-drafts\/([^/]+)\/complete$/.exec(path)
    if (evidenceCompleteMatch !== null && method === 'POST') {
      if (evidenceCompleteMatch[1] !== ids.evidenceDraftId || !evidenceCreated || !evidenceBound || !evidencePatched || body?.expected_version !== 3) return violation('evidence complete did not use the returned evidence ID or bound version')
      evidenceCompletedReady = evidenceReady
      return jsonResponse(evidenceProjection(ids.evidenceDraftId!, ids.draftId!, evidenceReady ? 'ready' : 'editing', true, 4, publicUrl))
    }

    const previewMatch = /^\/api\/v1\/submission-drafts\/([^/]+)\/preview$/.exec(path)
    if (previewMatch !== null && method === 'POST') {
      if (previewMatch[1] !== ids.draftId || body?.expected_version !== draftVersion || body?.check_id !== ids.checkId) return violation('preview did not use the latest draft and check IDs')
      if (coverReferenceCreated) {
        const projectCore = serverSnapshot.project_core as Record<string, unknown> | undefined
        const coverIds = Array.isArray(projectCore?.cover_media_reference_ids) ? projectCore.cover_media_reference_ids : []
        if (coverIds.length !== 1 || coverIds[0] !== ids.mediaReferenceId) return errorResponse(409, 'SUBMISSION_COVER_MEDIA_MISMATCH')
      }
      if (!coverReferenceCreated) return errorResponse(422, 'SUBMISSION_COVER_MEDIA_REQUIRED')
      if (!evidenceCompletedReady) return errorResponse(422, 'SUBMISSION_EVIDENCE_NOT_READY')
      previewIssued = true
      return jsonResponse(previewProjection({ draftId: ids.draftId!, checkId: ids.checkId! }, draftVersion, ids.mediaReferenceId!, ids.evidenceDraftId!, serverSnapshot))
    }

    if (path === '/api/v1/submissions' && method === 'POST') {
      if (!previewIssued || body?.draft_id !== ids.draftId || body?.draft_version !== draftVersion || body?.check_id !== ids.checkId || body?.preview_hash !== previewHash) return violation('submit did not reuse the preview receipt and latest draft version')
      const submissionId = issueId(ids, 'submissionId')
      const reviewWorkItemId = issueId(ids, 'reviewWorkItemId')
      return jsonResponse(submissionProjection({ draftId: ids.draftId!, chainId: ids.chainId!, submissionId, reviewWorkItemId }, draftVersion, ids.mediaReferenceId!, ids.evidenceDraftId!), 202)
    }

    return errorResponse(404)
  })

  vi.stubGlobal('fetch', fetchMock)

  return {
    fetchMock,
    requests,
    ids,
    draftRefreshes,
    invariantViolations,
    get uploadReceipt() { return uploadReceipt },
    setEvidenceReady: (value: boolean) => { evidenceReady = value },
  }
}

function requestKind(request: RequestRecord): string {
  const path = new URL(request.url, window.location.origin).pathname
  const { method } = request
  if (method === 'PUT') return 'upload-put'
  if (path === '/api/v1/submission-url-checks' && method === 'POST') return 'url-check'
  if (path === '/api/v1/submission-drafts' && method === 'POST') return 'draft-create'
  if (/^\/api\/v1\/submission-drafts\/[^/]+$/.test(path)) return method === 'PATCH' ? 'draft-patch' : 'draft-get'
  if (path === '/api/v1/media-resources' && method === 'POST') return 'media-prepare'
  if (/^\/api\/v1\/media-resources\/[^/]+\/complete$/.test(path)) return 'media-complete'
  if (/^\/api\/v1\/media-resources\/[^/]+$/.test(path)) return 'media-inspect'
  if (path === '/api/v1/media-references' && method === 'POST') return 'media-reference'
  if (path === '/api/v1/evidence-drafts' && method === 'POST') return 'evidence-create'
  if (/^\/api\/v1\/evidence-drafts\/[^/]+\/binding$/.test(path)) return 'evidence-bind'
  if (/^\/api\/v1\/evidence-drafts\/[^/]+$/.test(path)) return method === 'PATCH' ? 'evidence-patch' : 'evidence-get'
  if (/^\/api\/v1\/evidence-drafts\/[^/]+\/complete$/.test(path)) return 'evidence-complete'
  if (/^\/api\/v1\/submission-drafts\/[^/]+\/preview$/.test(path)) return 'preview'
  if (path === '/api/v1/submissions' && method === 'POST') return 'submit'
  return `${method.toLowerCase()}-other`
}

async function startAtDevelopment(transport: ReturnType<typeof installStatefulTransport>) {
  const user = userEvent.setup()
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/submit'] })
  render(<AppProviders><RouterProvider router={router} /></AppProviders>)

  await user.type(screen.getByRole('textbox', { name: /^作品地址/ }), publicUrl)
  await user.click(screen.getByRole('button', { name: '检查地址' }))
  expect(await screen.findByText('地址检查通过')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '继续补充作品信息' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/submit/new'))
  expect(router.state.location.pathname).toBe('/submit/new')
  const handoffSearch = new URLSearchParams(router.state.location.search)
  await waitFor(() => expect(transport.ids.checkId).toEqual(expect.any(String)))
  await waitFor(() => expect(transport.ids.draftId).toEqual(expect.any(String)))
  expect(transport.requests.map(requestKind).slice(0, 2)).toEqual(['url-check', 'draft-create'])
  expect(handoffSearch.get('draft')).toBe(transport.ids.draftId)
  expect(handoffSearch.get('step')).toBe('prefill')

  expect(await screen.findByRole('heading', { name: '基础信息' })).toBeInTheDocument()
  await user.clear(screen.getByRole('textbox', { name: '作品名称' }))
  await user.type(screen.getByRole('textbox', { name: '作品名称' }), '状态化黄金路径作品')
  await user.type(screen.getByRole('textbox', { name: '一句话定义' }), '验证端到端提交状态流转。')
  await user.selectOptions(screen.getByRole('combobox', { name: '基础访问状态（必填）' }), 'normal')
  await user.click(screen.getByRole('button', { name: '保存并继续' }))

  expect(await screen.findByRole('heading', { name: '定位与用途' })).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: '大学生' }))
  await user.type(screen.getByRole('textbox', { name: '核心问题（必填）' }), '提交状态需要可验证。')
  await user.click(screen.getByRole('checkbox', { name: '日常刷题' }))
  await user.click(screen.getByRole('button', { name: '保存并继续' }))

  expect(await screen.findByRole('heading', { name: '核心内容' })).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: '纯文本' }))
  await user.click(screen.getByRole('checkbox', { name: '练习集' }))
  await user.type(screen.getByRole('textbox', { name: '核心流程（必填，每行一步）' }), '准备并提交材料')
  await user.click(screen.getByRole('button', { name: '保存并继续' }))

  expect(await screen.findByRole('heading', { name: '开发与资产' })).toBeInTheDocument()
  return { user, router }
}

describe('stateful same-origin submission golden path integration', () => {
  beforeEach(() => {
    localStorage.clear()
    loginInStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts at P10, reuses server IDs and refreshed versions, then receives pending_review', async () => {
    const transport = installStatefulTransport()
    const { user } = await startAtDevelopment(transport)

    await user.upload(
      screen.getByLabelText(/作品封面/),
      new File([new Uint8Array(1_048_576)], 'golden-cover.png', { type: 'image/png' }),
    )
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as { submissionDrafts: LocalSubmissionDraft[] }
      expect(persisted.submissionDrafts.find((draft) => draft.draftId === transport.ids.draftId)?.preview).toBeDefined()
    })
    expect(screen.queryByText(previewHash)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()

    expect(transport.requests.map(requestKind)).toEqual([
      'url-check', 'draft-create', 'draft-get', 'draft-get', 'draft-get', 'draft-get', 'draft-patch',
      'media-prepare', 'upload-put', 'media-complete', 'media-inspect', 'media-reference',
      'draft-get', 'draft-patch', 'evidence-create', 'evidence-bind', 'evidence-patch', 'evidence-complete',
      'draft-get', 'preview', 'submit',
    ])
    expect(transport.invariantViolations).toEqual([])

    const apiRequests = transport.requests.filter((request) => requestKind(request) !== 'upload-put')
    expect(apiRequests.every((request) => request.url.startsWith('/api/v1/'))).toBe(true)

    const checkRequest = transport.requests[0]!
    const createRequest = transport.requests[1]!
    expect(checkRequest.body).toMatchObject({ raw_url: publicUrl, category_hint: 'ai_learning_quiz' })
    expect(createRequest.body).toMatchObject({ check_id: transport.ids.checkId, category_id: 'ai_learning_quiz' })

    const draftRequests = transport.requests.filter((request) => requestKind(request) === 'draft-get' || requestKind(request) === 'draft-patch')
    expect(draftRequests.every((request) => request.url.includes(transport.ids.draftId!))).toBe(true)
    const patchRequests = draftRequests.filter((request) => requestKind(request) === 'draft-patch')
    expect(patchRequests).toHaveLength(2)
    expect(patchRequests.map((request) => request.body?.expected_version)).toEqual([3, 5])
    expect((patchRequests[0]?.body?.patch as Record<string, unknown>).project_core).toMatchObject({ cover_media_reference_ids: [] })
    expect((patchRequests[1]?.body?.patch as Record<string, unknown>).project_core).toMatchObject({ cover_media_reference_ids: [transport.ids.mediaReferenceId] })
    expect(transport.draftRefreshes).toEqual([
      { version: 3, mediaReferenceIds: [], evidenceDraftIds: [] },
      { version: 3, mediaReferenceIds: [], evidenceDraftIds: [] },
      { version: 3, mediaReferenceIds: [], evidenceDraftIds: [] },
      { version: 3, mediaReferenceIds: [], evidenceDraftIds: [] },
      { version: 5, mediaReferenceIds: [transport.ids.mediaReferenceId], evidenceDraftIds: [] },
      { version: 7, mediaReferenceIds: [transport.ids.mediaReferenceId], evidenceDraftIds: [transport.ids.evidenceDraftId] },
    ])

    const uploadRequest = transport.requests.find((request) => requestKind(request) === 'upload-put')!
    expect(uploadRequest.url).toContain(transport.ids.mediaResourceId!)
    expect(uploadRequest.init?.credentials).toBe('omit')
    expect(uploadRequest.init?.headers).toEqual(preparedUploadHeaders)
    expect(uploadRequest.init?.body).toBeInstanceOf(Blob)
    expect((uploadRequest.init?.body as Blob).size).toBe(1_048_576)
    expect((uploadRequest.init?.body as Blob).type).toBe('image/png')
    expect(transport.uploadReceipt).toBe(uploadReceiptValue)
    const mediaRequests = transport.requests.filter((request) => ['media-complete', 'media-inspect'].includes(requestKind(request)))
    expect(mediaRequests.every((request) => request.url.includes(transport.ids.mediaResourceId!))).toBe(true)
    const mediaCompleteRequest = transport.requests.find((request) => requestKind(request) === 'media-complete')!
    expect(mediaCompleteRequest.body?.upload_receipt).toBe(transport.uploadReceipt)
    const referenceRequest = transport.requests.find((request) => requestKind(request) === 'media-reference')!
    expect(referenceRequest.body).toMatchObject({ media_resource_id: transport.ids.mediaResourceId, target_id: transport.ids.draftId, role: 'cover' })

    const evidenceRequests = transport.requests.filter((request) => requestKind(request).startsWith('evidence-'))
    const evidenceIdRequests = evidenceRequests.filter((request) => requestKind(request) !== 'evidence-create')
    expect(evidenceIdRequests.every((request) => request.url.includes(transport.ids.evidenceDraftId!))).toBe(true)
    expect(evidenceRequests.find((request) => requestKind(request) === 'evidence-bind')?.body).toMatchObject({
      parent_id: transport.ids.draftId,
      expected_parent_version: 6,
    })
    expect(evidenceRequests.find((request) => requestKind(request) === 'evidence-create')?.body).toMatchObject({
      parent_id: transport.ids.draftId,
      field_path: '/project_core/public_url',
      source_channel: 'official_site',
      requested_visibility: 'public',
    })

    const previewRequest = transport.requests.find((request) => requestKind(request) === 'preview')!
    expect(previewRequest.body).toEqual({ expected_version: 7, check_id: transport.ids.checkId })
    const submitRequest = transport.requests.find((request) => requestKind(request) === 'submit')!
    expect(submitRequest.body).toMatchObject({
      draft_id: transport.ids.draftId,
      draft_version: 7,
      check_id: transport.ids.checkId,
      preview_hash: previewHash,
      submission_key: expect.any(String),
    })

    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '提交版本正在等待审核' })).toBeInTheDocument()
    expect(screen.queryByText(previewHash)).not.toBeInTheDocument()
    const persisted = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as { submissionDrafts: LocalSubmissionDraft[] }
    const receipt = persisted.submissionDrafts.find((draft) => draft.draftId === transport.ids.draftId)
    expect(receipt).toMatchObject({
      status: 'pending_review',
      remoteStatus: 'submitted',
      submissionId: transport.ids.submissionId,
      reviewWorkItemId: transport.ids.reviewWorkItemId,
      reviewStatus: 'pending_review',
      publishedProjectId: null,
      publishedEventId: null,
    })
    expect(receipt?.preview?.previewHash).toBe(previewHash)
    expect(receipt?.preview?.checkId).toBe(transport.ids.checkId)
    expect(receipt?.preview?.mediaReferenceIds).toEqual([transport.ids.mediaReferenceId])
    expect(receipt?.preview?.evidenceDraftIds).toEqual([transport.ids.evidenceDraftId])
  })

  it('blocks missing cover and evidence before the same stateful transport succeeds after readiness', async () => {
    const transport = installStatefulTransport({ evidenceReady: false })
    const { user } = await startAtDevelopment(transport)

    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择一张封面图片')
    expect(transport.requests.map(requestKind)).toEqual(['url-check', 'draft-create', 'draft-get', 'draft-get', 'draft-get', 'draft-get'])
    expect(transport.requests.some((request) => ['preview', 'submit'].includes(requestKind(request)))).toBe(false)

    await user.upload(
      screen.getByLabelText(/作品封面/),
      new File([new Uint8Array(1_048_576)], 'reverse-cover.png', { type: 'image/png' }),
    )
    await user.click(screen.getByRole('button', { name: '准备提交材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('证据仍未准备就绪')
    expect(transport.requests.map(requestKind)).toEqual([
      'url-check', 'draft-create', 'draft-get', 'draft-get', 'draft-get', 'draft-get', 'draft-patch',
      'media-prepare', 'upload-put', 'media-complete', 'media-inspect', 'media-reference',
      'draft-get', 'draft-patch', 'evidence-create', 'evidence-bind', 'evidence-patch', 'evidence-complete',
    ])
    expect(transport.requests.some((request) => ['preview', 'submit'].includes(requestKind(request)))).toBe(false)

    transport.setEvidenceReady(true)
    await user.click(screen.getByRole('button', { name: '重试准备提交材料' }))
    await waitFor(() => expect(transport.invariantViolations).toEqual([]))
    expect(await screen.findByRole('heading', { name: '发布预览' })).toBeInTheDocument()
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)!) as { submissionDrafts: LocalSubmissionDraft[] }
      expect(persisted.submissionDrafts.find((draft) => draft.draftId === transport.ids.draftId)?.preview).toBeDefined()
    })
    expect(screen.queryByText(previewHash)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并提交审核' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    expect(await screen.findByRole('heading', { name: '审核状态：待审核' })).toBeInTheDocument()
    expect(transport.invariantViolations).toEqual([])
    expect(transport.requests.filter((request) => requestKind(request) === 'preview')).toHaveLength(1)
    expect(transport.requests.filter((request) => requestKind(request) === 'submit')).toHaveLength(1)
    expect(transport.ids.evidenceDraftId).toEqual(expect.any(String))
    expect(transport.ids.submissionId).toEqual(expect.any(String))
  })
})
