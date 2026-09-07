import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  installSubmissionFlow,
  profileForSubmission,
  submissionFlowPng,
  submissionFlowPreviewHash,
  type SubmissionCategory,
  type SubmissionFlow,
} from './support/submission-flow'

const viewports = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 1000 },
] as const

const categories = [
  { id: 'ai_learning_quiz', name: 'learning' },
  { id: 'personal_site_portfolio', name: 'portfolio' },
] as const satisfies readonly { id: SubmissionCategory; name: string }[]

function skipMobileProject(isMobile: boolean) {
  test.skip(isMobile, 'Slice 2 visual baselines use explicit 390/768/1440 desktop Chromium viewports')
}

async function assertSixStageRail(page: Page) {
  await expect(page.locator('.step-rail [data-step-id]')).toHaveText([
    '检查地址',
    '基础信息',
    '定位与用途',
    '核心内容',
    '开发与资产',
    '预览与提交',
  ])
  await expect(page.locator('.step-rail [data-step-id]')).toHaveCount(6)
  const interactiveStages = await page.locator('.step-rail [data-step-id]').evaluateAll((nodes) => nodes.filter((node) => (
    node.matches('a,button') || node.querySelector('a,button') !== null
  )).length)
  expect(interactiveStages).toBe(0)
}

async function loginAndCheckAddress(page: Page, flow: SubmissionFlow) {
  const returnPath = `/submit?category=${flow.category}`
  await flow.auth.loginAs(profileForSubmission(), returnPath)
  await expect(page).toHaveURL(new RegExp(`/submit\\?category=${flow.category}$`))
  await assertSixStageRail(page)

  const address = page.getByRole('textbox', { name: /^作品地址/ })
  await address.fill(flow.publicUrl)
  await page.getByRole('button', { name: '检查地址' }).click()
  await expect(page.getByText('地址检查通过')).toBeVisible()
  await expect(page.getByRole('button', { name: '继续补充作品信息' })).toBeVisible()
}

async function enterEditPage(page: Page, flow: SubmissionFlow) {
  await page.getByRole('button', { name: '继续补充作品信息' }).click()
  await page.waitForURL(/\/submit\/new\?draft=[0-9a-f-]+&step=prefill$/)
  await expect(page.getByRole('heading', { name: '基础信息' })).toBeVisible()
  await expect(page.locator('.step-rail [data-step-id="details"]')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('heading', { name: '发布新作品' })).toBeVisible()
}

async function clickChoice(page: Page, name: string) {
  const choice = page.getByRole('checkbox', { name, exact: true })
  await expect(choice).toHaveCount(1)
  await choice.check()
}

async function nextEditStep(page: Page, category: SubmissionCategory, step: 'definition' | 'solution' | 'development') {
  await page.getByRole('button', { name: '保存并继续' }).click()
  const heading = category === 'personal_site_portfolio'
    ? { definition: '定位与用途', solution: '核心内容', development: '开发与资产' }[step]
    : { definition: '产品定义', solution: '方案与功能', development: '开发与资产' }[step]
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
}

async function fillPrefill(page: Page, category: SubmissionCategory) {
  await page.getByRole('textbox', { name: '作品名称' }).fill(category === 'ai_learning_quiz' ? 'Slice 2 学习作品' : 'Slice 2 作品集')
  await page.getByRole('textbox', { name: /一句话(定义|简介)/ }).fill(
    category === 'ai_learning_quiz' ? '把练习材料整理成可以反复使用的学习流程。' : '用清晰的个人主页呈现项目、经历与联系方式。',
  )
  const access = page.getByRole('combobox', { name: '基础访问状态（必填）' })
  if (await access.count() > 0) await access.selectOption('normal')
}

async function fillFourSteps(page: Page, flow: SubmissionFlow) {
  await fillPrefill(page, flow.category)
  await nextEditStep(page, flow.category, 'definition')

  if (flow.category === 'ai_learning_quiz') {
    await clickChoice(page, '大学生')
    await page.getByRole('textbox', { name: '核心问题（必填）' }).fill('让公开材料能被持续练习和复习。')
    await clickChoice(page, '日常刷题')
  } else {
    await clickChoice(page, '开发者')
    await clickChoice(page, '展示项目')
  }
  await nextEditStep(page, flow.category, 'solution')

  if (flow.category === 'ai_learning_quiz') {
    await clickChoice(page, '纯文本')
    await clickChoice(page, '练习集')
    await page.getByRole('textbox', { name: '核心流程（必填，每行一步）' }).fill('整理材料\n生成练习\n复习结果')
  } else {
    await clickChoice(page, '首屏')
    await clickChoice(page, '项目')
  }
  await nextEditStep(page, flow.category, 'development')

  await page.getByLabel(/作品封面/).setInputFiles({
    name: `${flow.category}-cover.png`,
    mimeType: 'image/png',
    buffer: submissionFlowPng,
  })
  await expect(page.getByText(new RegExp(`${flow.category}-cover\\.png$`))).toBeVisible()
}

async function preparePreview(page: Page, flow: SubmissionFlow) {
  await page.getByRole('button', { name: '准备提交材料' }).click()
  await expect.poll(() => flow.requestKinds(), { timeout: 10000 }).toContain('preview')
  await page.waitForURL(/\/submit\/new\?draft=[0-9a-f-]+&step=preview$/)
  await expect(page.getByRole('heading', { name: '发布预览' })).toBeVisible()
  await expect(page.locator('.step-rail [data-step-id="preview"]')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('提交预览')).toBeVisible()
}

async function submitAndAssertReceipt(page: Page, flow: SubmissionFlow) {
  await expect(page.getByRole('button', { name: '确认并提交审核' })).toBeEnabled()
  await page.getByRole('button', { name: '确认并提交审核' }).click()
  await expect(page.getByRole('dialog', { name: '提交当前内容？' })).toBeVisible()
  await page.getByRole('dialog', { name: '提交当前内容？' }).getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByRole('heading', { name: '审核状态：待审核' })).toBeVisible()
  await expect(page.getByText(flow.submissionId)).toBeVisible()
  await expect(page.getByText(flow.reviewWorkItemId)).toBeVisible()
  await expect(page.getByText('提交版本正在等待审核')).toBeVisible()
  await expect.poll(() => flow.requestKinds()).toContain('submit')
  expect(flow.requestKinds()).not.toContain('media-reference-delete')
  expect(flow.mediaChecksum()).toMatch(/^[a-f0-9]{64}$/)
  expect(flow.requests.find((request) => request.kind === 'upload-put')).toMatchObject({
    uploadIsPng: true,
    uploadHadCookie: false,
  })
  flow.assertReady()
  expect(flow.invariantViolations).toEqual([])
  await expect(page.getByText(submissionFlowPreviewHash)).not.toBeVisible()
}

async function screenshotState(page: Page, categoryName: string, state: 'address' | 'edit' | 'preview' | 'receipt') {
  const toastClose = page.getByRole('button', { name: '关闭提示' })
  while (await toastClose.count() > 0) await toastClose.first().click()
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    while (await toastClose.count() > 0) await toastClose.first().click()
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(viewport.width)
    await expect(page).toHaveScreenshot(`slice2-${categoryName}-${state}-${viewport.name}.png`, {
      fullPage: true,
      animations: 'disabled',
    })
  }
}

async function assertSmallPreviewKeyboardAndRail(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await assertSixStageRail(page)
  const previewDetails = page.locator('details.task-preview')
  const previewSummary = previewDetails.locator('summary')
  await expect(previewSummary).toBeVisible()
  await expect(previewDetails).not.toHaveAttribute('open')

  await previewSummary.focus()
  await page.keyboard.press('Enter')
  await expect(previewDetails).toHaveAttribute('open', '')
  await page.keyboard.press('Space')
  await expect(previewDetails).not.toHaveAttribute('open')
}

for (const category of categories) {
  test.describe(`Slice 2 ${category.name} submission`, () => {
    test(`${category.name} reaches pending_review through the real UI and captures 12 baselines`, async ({ page, isMobile }) => {
      skipMobileProject(isMobile)
      const flow = await installSubmissionFlow(page, { category: category.id })

      await loginAndCheckAddress(page, flow)
      await screenshotState(page, category.name, 'address')

      await enterEditPage(page, flow)
      await fillPrefill(page, flow.category)
      await screenshotState(page, category.name, 'edit')
      await nextEditStep(page, flow.category, 'definition')

      if (flow.category === 'ai_learning_quiz') {
        await clickChoice(page, '大学生')
        await page.getByRole('textbox', { name: '核心问题（必填）' }).fill('让公开材料能被持续练习和复习。')
        await clickChoice(page, '日常刷题')
      } else {
        await clickChoice(page, '开发者')
        await clickChoice(page, '展示项目')
      }
      await nextEditStep(page, flow.category, 'solution')

      if (flow.category === 'ai_learning_quiz') {
        await clickChoice(page, '纯文本')
        await clickChoice(page, '练习集')
        await page.getByRole('textbox', { name: '核心流程（必填，每行一步）' }).fill('整理材料\n生成练习\n复习结果')
      } else {
        await clickChoice(page, '首屏')
        await clickChoice(page, '项目')
      }
      await nextEditStep(page, flow.category, 'development')
      await page.getByLabel(/作品封面/).setInputFiles({ name: `${category.name}-cover.png`, mimeType: 'image/png', buffer: submissionFlowPng })
      await expect(page.getByText(new RegExp(`${category.name}-cover\\.png$`))).toBeVisible()

      await preparePreview(page, flow)
      await assertSmallPreviewKeyboardAndRail(page)
      await screenshotState(page, category.name, 'preview')

      await submitAndAssertReceipt(page, flow)
      await screenshotState(page, category.name, 'receipt')
    })
  })
}

test.describe('Slice 2 submission accessibility and responsive gates', () => {
  test('360px task workspace has no horizontal overflow', async ({ page, isMobile }) => {
    skipMobileProject(isMobile)
    const flow = await installSubmissionFlow(page, { category: 'ai_learning_quiz' })
    await loginAndCheckAddress(page, flow)
    await page.getByRole('button', { name: '继续补充作品信息' }).click()
    await page.waitForURL(/\/submit\/new\?draft=[0-9a-f-]+&step=prefill$/)
    await page.setViewportSize({ width: 360, height: 844 })
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(360)
    expect(await page.locator('.task-shell').evaluate((node) => Math.ceil(node.getBoundingClientRect().right))).toBeLessThanOrEqual(360)
  })

  test('invalid edit fields focus the ErrorSummary and retain keyboard links', async ({ page, isMobile }) => {
    skipMobileProject(isMobile)
    const flow = await installSubmissionFlow(page, { category: 'ai_learning_quiz' })
    await loginAndCheckAddress(page, flow)
    await enterEditPage(page, flow)
    await page.getByRole('button', { name: '保存并继续' }).click()

    const summary = page.locator('.task-error-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toBeFocused()
    await expect(summary.getByRole('heading', { name: '请检查以下内容' })).toBeVisible()
    const nameError = summary.getByRole('link', { name: /作品名称/ })
    await expect(nameError).toBeVisible()
    await nameError.click()
    await expect(page.getByRole('textbox', { name: '作品名称' })).toBeFocused()
  })

  for (const category of categories) {
    test(`${category.name} address and preview states pass WCAG A/AA axe gate`, async ({ page, isMobile }) => {
      skipMobileProject(isMobile)
      const flow = await installSubmissionFlow(page, { category: category.id })
      await loginAndCheckAddress(page, flow)
      const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
      const addressAxe = await new AxeBuilder({ page }).withTags(axeTags).analyze()
      expect(addressAxe.violations).toEqual([])

      await enterEditPage(page, flow)
      await fillFourSteps(page, flow)
      await preparePreview(page, flow)
      const previewAxe = await new AxeBuilder({ page }).withTags(axeTags).analyze()
      expect(previewAxe.violations).toEqual([])
    })
  }
})
