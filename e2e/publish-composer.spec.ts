import { expect, test, type Page } from '@playwright/test'
import { installMockAuth } from './support/mock-auth'
import { installPublishMock, type PublishCheckScenario, type PublishFailurePoint } from './support/publish-mock'

const requiredFields = {
  name: '可复用学习工作台',
  summary: '把公开资料整理成可以持续练习的学习流程。',
  url: 'https://example.test/learning-workbench',
  category: 'ai_learning_quiz',
} as const

function skipMobileProject(isMobile: boolean) {
  test.skip(isMobile, '发布编辑器回归使用桌面 Chromium 覆盖显式 390/1440 视口')
}

async function waitForPublishEditor(page: Page) {
  await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()
  await expect(page.locator('#publish-name')).toBeEditable()
}

async function fillRequiredFields(page: Page, values = requiredFields) {
  await page.locator('#publish-name').fill(values.name)
  await page.locator('#publish-summary').fill(values.summary)
  await page.locator('#publish-url').fill(values.url)
  await page.locator('#publish-category').selectOption(values.category)
}

async function waitForUrlCheck(page: Page, mock: Awaited<ReturnType<typeof installPublishMock>>) {
  await expect.poll(() => mock.requestsOf('url-check').length, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(page.locator('.publish-link-status')).toContainText('链接检查已完成。', { timeout: 15_000 })
}

async function submitFromFooter(page: Page) {
  const submit = page.locator('.publish-footer button[type="submit"]')
  await expect(submit).toBeEnabled()
  await submit.click()
}

async function assertSubmitted(page: Page) {
  await expect(page.getByRole('heading', { name: '已提交审核' })).toBeVisible({ timeout: 15_000 })
}

async function openAuthenticatedPublish(page: Page, options: { checkScenario?: PublishCheckScenario; failurePoint?: PublishFailurePoint } = {}) {
  const auth = await installMockAuth(page)
  const mock = await installPublishMock(page, options)
  await auth.loginAs('mia', '/submit')
  await waitForPublishEditor(page)
  return { auth, mock }
}

for (const width of [390, 1440] as const) {
  test(`四项基础信息无封面也能提交审核（${width}px）`, async ({ page, isMobile }) => {
    skipMobileProject(isMobile)
    await page.setViewportSize({ width, height: 1000 })
    const { mock } = await openAuthenticatedPublish(page)

    await fillRequiredFields(page)
    await waitForUrlCheck(page, mock)
    await expect(page.locator('input[type="file"]')).toHaveCount(1)
    await expect(page.locator('.publish-footer')).toBeVisible()
    await submitFromFooter(page)
    await assertSubmitted(page)

    expect(mock.requestKinds()).toEqual(expect.arrayContaining([
      'url-check', 'draft-create', 'draft-patch', 'preview', 'draft-get', 'submit',
    ]))
    expect(mock.requestsOf('media-prepare')).toHaveLength(0)
    const patch = mock.lastBody('draft-patch') as { patch?: { project_core?: { cover_media_reference_ids?: unknown[] } } }
    expect(patch.patch?.project_core?.cover_media_reference_ids).toEqual([])
    expect(mock.lastBody('submit')).toMatchObject({
      draft_id: expect.any(String),
      draft_version: expect.any(Number),
      check_id: expect.any(String),
      preview_hash: 'a'.repeat(64),
      submission_key: expect.any(String),
    })
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width)
  })
}

for (const scenario of [
  { name: '访问状态不确定', checkScenario: 'uncertain-access', status: '暂时无法验证链接，可继续填写，提交后核验。' },
  { name: '品类暂未确认', checkScenario: 'category-unconfirmed', status: '链接检查已完成。' },
] as const) {
  test(`${scenario.name}不会阻止填写和提交`, async ({ page, isMobile }) => {
    skipMobileProject(isMobile)
    await page.setViewportSize({ width: 390, height: 1000 })
    const { mock } = await openAuthenticatedPublish(page, { checkScenario: scenario.checkScenario })

    await fillRequiredFields(page)
    await expect.poll(() => mock.requestsOf('url-check').length, { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(page.locator('.publish-link-status')).toContainText(scenario.status, { timeout: 15_000 })
    await expect(page.locator('#publish-name')).toHaveValue(requiredFields.name)
    await expect(page.locator('#publish-summary')).toHaveValue(requiredFields.summary)
    await expect(page.locator('#publish-url')).toHaveValue(requiredFields.url)
    await expect(page.locator('#publish-category')).toHaveValue(requiredFields.category)

    await submitFromFooter(page)
    await assertSubmitted(page)
    expect(mock.requestsOf('submit')).toHaveLength(1)
  })
}

test('危险链接在提交前被拦截并保留四项输入', async ({ page, isMobile }) => {
  skipMobileProject(isMobile)
  await page.setViewportSize({ width: 390, height: 1000 })
  const { mock } = await openAuthenticatedPublish(page, { checkScenario: 'unsafe' })
  const unsafeFields = { ...requiredFields, url: 'https://unsafe.example.test/work' }

  await fillRequiredFields(page, unsafeFields)
  await expect.poll(() => mock.requestsOf('url-check').length, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(page.locator('.publish-link-status')).toContainText('外链安全风险无法接受', { timeout: 15_000 })
  await submitFromFooter(page)

  await expect(page.getByRole('alert')).toContainText('外链安全风险无法接受。')
  await expect(page.getByRole('heading', { name: '已提交审核' })).toHaveCount(0)
  expect(mock.requestsOf('draft-create')).toHaveLength(0)
  expect(mock.requestsOf('submit')).toHaveLength(0)
  await expect(page.locator('#publish-name')).toHaveValue(unsafeFields.name)
  await expect(page.locator('#publish-summary')).toHaveValue(unsafeFields.summary)
  await expect(page.locator('#publish-url')).toHaveValue(unsafeFields.url)
  await expect(page.locator('#publish-category')).toHaveValue(unsafeFields.category)
})

test('提交接口失败时显示可重试状态并保留输入', async ({ page, isMobile }) => {
  skipMobileProject(isMobile)
  await page.setViewportSize({ width: 390, height: 1000 })
  const { mock } = await openAuthenticatedPublish(page, { failurePoint: 'patch' })

  await fillRequiredFields(page)
  await waitForUrlCheck(page, mock)
  await submitFromFooter(page)

  await expect(page.getByRole('alert')).toContainText('当前内容已保留。')
  await expect(page.getByRole('heading', { name: '已提交审核' })).toHaveCount(0)
  expect(mock.requestsOf('draft-patch')).toHaveLength(1)
  expect(mock.requestsOf('submit')).toHaveLength(0)
  await expect(page.locator('#publish-name')).toHaveValue(requiredFields.name)
  await expect(page.locator('#publish-summary')).toHaveValue(requiredFields.summary)
  await expect(page.locator('#publish-url')).toHaveValue(requiredFields.url)
  await expect(page.locator('#publish-category')).toHaveValue(requiredFields.category)
})

test('访客提交后登录回来会恢复四项输入', async ({ page, isMobile }) => {
  skipMobileProject(isMobile)
  await page.setViewportSize({ width: 390, height: 1000 })
  const auth = await installMockAuth(page)
  const mock = await installPublishMock(page)

  await page.goto('/submit')
  await waitForPublishEditor(page)
  await fillRequiredFields(page)
  await submitFromFooter(page)
  await expect(page).toHaveURL(/\/auth\?return_to=%2Fsubmit%3Fresume%3Dguest$/)
  await expect(page.getByRole('heading', { name: '邮箱验证码登录' })).toBeVisible()

  await auth.loginCurrent('mia', '/submit?resume=guest')
  await waitForPublishEditor(page)
  await expect(page.locator('#publish-name')).toHaveValue(requiredFields.name)
  await expect(page.locator('#publish-summary')).toHaveValue(requiredFields.summary)
  await expect(page.locator('#publish-url')).toHaveValue(requiredFields.url)
  await expect(page.locator('#publish-category')).toHaveValue(requiredFields.category)
  await waitForUrlCheck(page, mock)

  await submitFromFooter(page)
  await assertSubmitted(page)
})


test('提交失败后刷新重试保留同一提交凭据', async ({ page, isMobile }) => {
  skipMobileProject(isMobile)
  const { mock } = await openAuthenticatedPublish(page, { failurePoint: 'submit' })
  await fillRequiredFields(page)
  await waitForUrlCheck(page, mock)
  await submitFromFooter(page)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(mock.requestsOf('submit')).toHaveLength(1)
  const first = mock.lastBody('submit')
  await page.reload()
  await waitForPublishEditor(page)
  await expect(page.locator('#publish-name')).toHaveValue(requiredFields.name)
  await submitFromFooter(page)
  await assertSubmitted(page)
  expect(mock.requestsOf('submit')).toHaveLength(2)
  expect(mock.lastBody('submit')).toEqual(first)
  expect(mock.requestsOf('draft-patch')).toHaveLength(1)
  expect(mock.requestsOf('preview')).toHaveLength(1)
})
