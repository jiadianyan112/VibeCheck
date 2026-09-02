import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { installMockAuth } from './support/mock-auth'

const submissionViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const

const submissionUrl = 'https://example.test/highfi-submission'
const checkId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const chainId = '55555555-5555-4555-8555-555555555555'
const mediaId = '66666666-6666-4666-8666-666666666666'
const mediaReferenceId = '77777777-7777-4777-8777-777777777777'
const evidenceId = '88888888-8888-4888-8888-888888888888'
const submissionId = '99999999-9999-4999-8999-999999999999'
const reviewWorkItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fixedDate = '2026-08-29T00:00:00.000Z'
const previewHash = 'b'.repeat(64)
const coverFixture = Buffer.from('highfi-cover-fixture!')

// Keep only this visual suite deterministic; production rendering still uses the viewer's local timezone.
test.use({ timezoneId: 'Asia/Shanghai' })

type SubmissionFlowState = {
  version: number
  payloadSnapshot: Record<string, unknown>
  mediaReferenceIds: string[]
  evidenceDraftIds: string[]
  checksum: string
}

function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  })
}

function initialPayload() {
  return {
    project_core: {
      current_name: '高保真学习工具',
      public_url: submissionUrl,
      repository_url: null,
      original_platform: null,
      one_line_definition: '把公开学习材料整理成可复习的练习',
      access_status: 'normal',
    },
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    category_data: {},
  } satisfies Record<string, unknown>
}

function draftProjection(flow: SubmissionFlowState) {
  return {
    draft_id: draftId,
    submission_chain_id: chainId,
    category_id: 'ai_learning_quiz',
    category_schema_version: 'learning.v1',
    check_id: checkId,
    draft_revision: 1,
    supersedes_draft_id: null,
    base_submission_id: null,
    payload_snapshot: flow.payloadSnapshot,
    media_reference_ids: flow.mediaReferenceIds,
    evidence_draft_ids: flow.evidenceDraftIds,
    asset_drafts: [],
    status: 'editing',
    version: flow.version,
    created_at: fixedDate,
    updated_at: fixedDate,
    saved_at: fixedDate,
    expires_at: '2099-01-01T00:30:00.000Z',
  }
}

function mediaResource(flow: SubmissionFlowState, status: 'created' | 'ready') {
  return {
    media_resource_id: mediaId,
    declared_mime: 'image/png',
    detected_mime: status === 'ready' ? 'image/png' : null,
    byte_size: coverFixture.byteLength,
    width: status === 'ready' ? 1600 : null,
    height: status === 'ready' ? 900 : null,
    duration_ms: null,
    checksum_sha256: flow.checksum || '0'.repeat(64),
    source: 'upload',
    status,
    scan_result: status === 'ready' ? 'clean' : 'not_scanned',
    rejection_reason_code: null,
    scan_attempt_count: status === 'ready' ? 1 : 0,
    next_scan_at: null,
    exif_removed: status === 'ready',
    deletion_guard_active: false,
    version: status === 'ready' ? 2 : 1,
    created_at: fixedDate,
    updated_at: fixedDate,
  }
}

function mediaReference() {
  return {
    media_reference_id: mediaReferenceId,
    media_resource_id: mediaId,
    target_type: 'submission_draft',
    target_id: draftId,
    role: 'cover',
    alt_text: '提交作品封面',
    sort_order: 0,
    crop_focus: null,
    variant: null,
    source_media_reference_id: null,
    version: 1,
    created_at: fixedDate,
    updated_at: fixedDate,
  }
}

function evidenceDraft(status: 'editing' | 'ready', version: number) {
  return {
    evidence_draft_id: evidenceId,
    collector_actor_type: 'user',
    parent_type: 'submission_draft',
    parent_id: draftId,
    final_target_kind: 'project',
    target_asset_draft_key: null,
    evidence_type: 'trusted_external_source',
    source_channel: 'official_site',
    field_path: '/project_core/public_url',
    requested_visibility: 'public',
    source_url: submissionUrl,
    text_excerpt: null,
    attachment_drafts: [],
    status,
    bound: true,
    source_hash: 'c'.repeat(64),
    final_field_preview: {
      source_summary: '公开来源',
      captured_at: fixedDate,
      collected_by: 'user',
      confidence: 'medium',
      source_channel: 'official_site',
    },
    completed_at: status === 'ready' ? fixedDate : null,
    promoted_evidence_id: null,
    version,
    created_at: fixedDate,
    updated_at: fixedDate,
  }
}

async function installSubmissionFlowMocks(page: Page) {
  const flow: SubmissionFlowState = {
    version: 1,
    payloadSnapshot: initialPayload(),
    mediaReferenceIds: [],
    evidenceDraftIds: [],
    checksum: '',
  }

  await page.route('**/api/v1/submission-url-checks', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = route.request().postDataJSON() as { raw_url?: unknown; category_hint?: unknown }
    const rawUrl = typeof body.raw_url === 'string' ? body.raw_url : submissionUrl
    const canonicalUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const categoryId = body.category_hint === 'personal_site_portfolio' ? 'personal_site_portfolio' : 'ai_learning_quiz'
    await json(route, 201, {
      check_id: checkId,
      category_id: categoryId,
      category_schema_version: categoryId === 'personal_site_portfolio' ? 'portfolio.v1' : 'learning.v1',
      input_hash: 'a'.repeat(64),
      canonical_url: canonicalUrl,
      redirect_chain: [],
      risk_result: 'allowed',
      access_result: 'accessible',
      category_result: 'matched',
      duplicate_result: 'none',
      duplicate_candidates: [],
      risk_reasons: [],
      can_create_draft: true,
      checked_at: fixedDate,
      expires_at: '2099-01-01T00:30:00.000Z',
    })
  })

  await page.route('**/api/v1/submission-drafts', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await json(route, 201, draftProjection(flow))
  })

  await page.route(/\/api\/v1\/submission-drafts\/[^/]+$/, async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as { patch?: unknown }
      if (body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)) {
        flow.payloadSnapshot = body.patch as Record<string, unknown>
      }
      flow.version += 1
      await json(route, 200, draftProjection(flow))
      return
    }
    if (method === 'GET') {
      await json(route, 200, draftProjection(flow))
      return
    }
    await route.continue()
  })

  await page.route(/\/api\/v1\/submission-drafts\/[^/]+\/preview$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await json(route, 200, {
      draft_id: draftId,
      draft_version: flow.version,
      check_id: checkId,
      preview_hash: previewHash,
      payload_snapshot: flow.payloadSnapshot,
      media_reference_ids: flow.mediaReferenceIds,
      evidence_draft_ids: flow.evidenceDraftIds,
      validation: { valid: true, issue_count: 0 },
      generated_at: fixedDate,
    })
  })

  await page.route('**/api/v1/submissions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await json(route, 202, {
      submission_id: submissionId,
      submission_chain_id: chainId,
      draft_id: draftId,
      snapshot_version: flow.version,
      review_status: 'pending_review',
      review_work_item_id: reviewWorkItemId,
      media_reference_ids: flow.mediaReferenceIds,
      evidence_draft_ids: flow.evidenceDraftIds,
      preview_hash: previewHash,
      version: 1,
      created_at: fixedDate,
      updated_at: fixedDate,
    })
  })

  await page.route('**/api/v1/media-resources', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = route.request().postDataJSON() as { checksum_sha256?: unknown; byte_size?: unknown }
    flow.checksum = typeof body.checksum_sha256 === 'string' ? body.checksum_sha256 : '0'.repeat(64)
    await json(route, 201, {
      media: mediaResource(flow, 'created'),
      upload_url: 'https://uploads.example.test/highfi-cover',
      upload_headers: {},
      upload_expires_at: '2099-01-01T00:30:00.000Z',
    })
  })

  await page.route(/\/api\/v1\/media-resources\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await json(route, 200, mediaResource(flow, 'ready'))
  })

  await page.route(/\/api\/v1\/media-resources\/[^/]+\/complete$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await json(route, 202, { media: mediaResource(flow, 'ready'), scan_queued: true })
  })

  await page.route('https://uploads.example.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'PUT, OPTIONS',
          'access-control-allow-headers': '*',
        },
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: {
        etag: '"highfi-upload-receipt"',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'etag',
      },
    })
  })

  await page.route('**/api/v1/media-references', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      flow.mediaReferenceIds = [mediaReferenceId]
      await json(route, 201, mediaReference())
      return
    }
    if (method === 'GET') {
      await json(route, 200, { items: [], total_count: 0 })
      return
    }
    await route.continue()
  })

  await page.route('**/api/v1/evidence-drafts', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    flow.evidenceDraftIds = [evidenceId]
    await json(route, 201, evidenceDraft('editing', 1))
  })

  await page.route(/\/api\/v1\/evidence-drafts\/[^/]+\/binding$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const body = route.request().postDataJSON() as { expected_parent_version?: unknown }
    await json(route, 200, {
      parent_type: 'submission_draft',
      parent_id: draftId,
      evidence_draft_ids: [evidenceId],
      parent_version: typeof body.expected_parent_version === 'number' ? body.expected_parent_version : flow.version,
      evidence_draft_version: 1,
    })
  })

  await page.route(/\/api\/v1\/evidence-drafts\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    await json(route, 200, evidenceDraft('editing', 2))
  })

  await page.route(/\/api\/v1\/evidence-drafts\/[^/]+\/complete$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await json(route, 200, evidenceDraft('ready', 3))
  })
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await document.fonts?.ready
  })
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  })
  const closeToast = page.getByRole('button', { name: '关闭提示' })
  while (await closeToast.count()) {
    const button = closeToast.first()
    if (!await button.isVisible()) break
    await button.click()
  }
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'Screenshots must start at the top of the document.' }).toBe(0)
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.global-header')
    if (!header) return false
    const rect = header.getBoundingClientRect()
    return Math.abs(rect.top) <= 1 && Math.abs(rect.width - document.documentElement.clientWidth) <= 1
  }), { message: 'The global header must be stable before a screenshot.' }).toBe(true)
}

async function expectNoHorizontalOverflow(page: Page, context: string) {
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const viewportWidth = document.documentElement.clientWidth
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.right > viewportWidth + 1 || rect.left < -1)
      })
      .slice(0, 6)
      .map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 50) })),
  }))
  expect(layout.page, `${context}: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(layout.viewport + 1)
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))).toEqual([])
}

async function expectCurrentSubmissionStep(page: Page, label: string) {
  const rail = page.getByRole('navigation', { name: '发布步骤' })
  await expect(rail).toBeVisible()
  await expect(rail.locator('[aria-current="step"]')).toHaveText(label)
}

async function expectCurrentSubmissionStepVisibleInRail(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const current = document.querySelector<HTMLElement>('.task-step-rail__item[aria-current="step"]')
    const rail = current?.closest('.task-step-rail')?.querySelector<HTMLElement>('.task-step-rail__list')
    if (!current || !rail) return false
    const currentRect = current.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    return currentRect.right > railRect.left && currentRect.left < railRect.right &&
      currentRect.bottom > railRect.top && currentRect.top < railRect.bottom
  }), { message: 'The current task step must intersect the visible step rail.' }).toBe(true)
}

async function expectSubmissionTimezone(page: Page) {
  await expect.poll(
    () => page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    { message: 'The submission visual suite must run in its declared timezone.' },
  ).toBe('Asia/Shanghai')
}

async function fillRequiredLearningFields(page: Page) {
  await page.getByRole('textbox', { name: '作品名称' }).fill('高保真提交工作区')
  await page.getByLabel('一句话定义').fill('将公开学习材料转成可复习的练习')
  await page.getByRole('combobox', { name: '基础访问状态' }).selectOption('normal')
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expectCurrentSubmissionStep(page, '定位与用途')
  await page.getByRole('checkbox', { name: '大学生' }).check()
  await page.getByRole('textbox', { name: '核心问题（必填）' }).fill('把 PDF 学习材料快速转成可复习的练习')
  await page.getByRole('checkbox', { name: '生成题目' }).check()
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expectCurrentSubmissionStep(page, '核心内容')
  await page.getByRole('checkbox', { name: 'PDF' }).check()
  await page.getByRole('checkbox', { name: '题目' }).check()
  await page.getByRole('textbox', { name: '核心流程（必填，每行一步）' }).fill('上传材料\n生成练习\n查看反馈')
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expectCurrentSubmissionStep(page, '开发与资产')
  await page.getByLabel('作品封面（必选）').setInputFiles({
    name: 'highfi-cover.png',
    mimeType: 'image/png',
    buffer: coverFixture,
  })
  await expect(page.getByText('已选择封面：highfi-cover.png')).toBeVisible()
  await page.getByRole('button', { name: '准备提交材料' }).click()
}

for (const viewport of submissionViewports) {
  test(`T57 ${viewport.name} submission workspace visual and accessibility path`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Explicit submission baselines run only in desktop-chromium at fixed viewports')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expectSubmissionTimezone(page)
    const mockAuth = await installMockAuth(page, { submission: true })
    await installSubmissionFlowMocks(page)

    await mockAuth.loginAs('mia', '/submit')
    await expect(page.getByRole('heading', { name: '先检查作品地址' })).toBeVisible()
    await page.getByRole('textbox', { name: /^作品地址/ }).fill(submissionUrl)
    await settle(page)
    await expectNoHorizontalOverflow(page, `${viewport.width}px address entry`)
    await expectNoAxeViolations(page)
    await expect(page).toHaveScreenshot(`${viewport.name}-address-entry.png`, { fullPage: true, animations: 'disabled' })

    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('地址检查通过')).toBeVisible()
    await page.getByRole('button', { name: '继续补充作品信息' }).click()
    await expect(page.getByRole('heading', { name: '基础信息' })).toBeVisible()
    if (viewport.width < 1100) await expectCurrentSubmissionStepVisibleInRail(page)
    await settle(page)
    await expectNoHorizontalOverflow(page, `${viewport.width}px editing`)
    await expectNoAxeViolations(page)
    await expect(page).toHaveScreenshot(`${viewport.name}-editing.png`, { fullPage: true, animations: 'disabled' })

    await fillRequiredLearningFields(page)
    await expect(page.getByRole('heading', { name: '发布预览' })).toBeVisible()
    await expect(page.getByText('已准备好的提交内容')).toBeVisible()
    if (viewport.width < 1100) await expectCurrentSubmissionStepVisibleInRail(page)
    await settle(page)
    await expectNoHorizontalOverflow(page, `${viewport.width}px preview`)
    await expectNoAxeViolations(page)
    await expect(page).toHaveScreenshot(`${viewport.name}-preview.png`, { fullPage: true, animations: 'disabled' })

    await page.getByRole('button', { name: '确认并提交审核' }).click()
    const confirmation = page.getByRole('dialog', { name: '提交当前内容？' })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: '确认提交' }).click()
    await expect(page.getByRole('heading', { name: '审核状态：待审核' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '提交版本正在等待审核' })).toBeVisible()
    if (viewport.width < 1100) await expectCurrentSubmissionStepVisibleInRail(page)
    await settle(page)
    await expectNoHorizontalOverflow(page, `${viewport.width}px pending receipt`)
    await expectNoAxeViolations(page)
    await expect(page).toHaveScreenshot(`${viewport.name}-pending-review.png`, { fullPage: true, animations: 'disabled' })
  })
}
