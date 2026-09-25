import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { installMockAuth } from './support/mock-auth'

const routes = [
  '/categories', '/categories/ai-question-generation', '/categories/personal-sites-portfolios',
  '/activity', '/search?q=PDF', '/discover?idea=PDF练习', '/discover/result?idea=PDF练习',
  '/project/project-quizforge', '/compare/comparison-anonymous-pdf', '/submit', '/submit/new',
  '/project/project-quizforge/verify-author', '/project/project-quizforge/update',
  '/creator/creator-lin', '/me', '/notifications', '/about', '/auth', '/missing-page',
  '/admin', '/admin/projects', '/admin/project/project-quizforge', '/admin/duplicates',
  '/admin/reviews', '/admin/author-verification', '/admin/status-monitor',
]

const representativeRoutes = [
  ['/categories', '分类'],
  ['/project/project-quizforge', '作品详情'],
  ['/compare/comparison-anonymous-pdf', '比较'],
  ['/submit', '发布'],
  ['/me', '个人中心'],
  ['/admin', '后台'],
] as const

async function seedVerifiedUpdateAccess(page: Parameters<typeof installMockAuth>[0]) {
  await page.evaluate(() => {
    const key = 'vibecheck-prototype-state-v1'
    const state = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
    const verification = {
      id: 'verification-user-admin-project-quizforge',
      projectId: 'project-quizforge',
      userId: '22222222-2222-4222-8222-222222222222',
      method: 'repository',
      status: 'verified',
      materialSummary: '公开仓库与作品地址均可核对。',
      privateMaterialReference: 'e2e-style-unification-fixture',
      reviewMessage: '测试夹具已通过作者身份审核。',
      statusHistory: [{ status: 'verified', happenedAt: '2026-08-29T00:00:00.000Z', message: '测试夹具已通过作者身份审核。' }],
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
      submittedAt: '2026-08-29T00:00:00.000Z',
      resolvedAt: '2026-08-29T00:00:00.000Z',
    }
    state.schemaVersion = 1
    state.verificationRequests = [verification]
    localStorage.setItem(key, JSON.stringify(state))
  })
}

async function axeViolations(page: Parameters<typeof installMockAuth>[0]) {
  const result = await new AxeBuilder({ page })
    .include('main')
    .include('nav')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

for (const width of [390, 768, 1440]) {
  test(`all non-feed pages retain readable layout at ${width}px`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Explicit viewports are covered with desktop Chromium.')
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 1000 })
    const auth = await installMockAuth(page)
    await auth.loginAs('lin', '/me')
    await seedVerifiedUpdateAccess(page)
    await mkdir('outputs/site-unification', { recursive: true })
    const errors: string[] = []
    const routeFailures: string[] = []
    for (const [index, route] of routes.entries()) {
      await test.step(route, async () => {
        const pageErrors: string[] = []
        const onPageError = (error: Error) => pageErrors.push(error.message)
        page.on('pageerror', onPageError)
        const screenshotPath = `outputs/site-unification/${width}-${String(index).padStart(2, '0')}.png`

        try {
          await page.goto(route)
          await page.waitForLoadState('networkidle')
        } catch (error) {
          routeFailures.push(`${route}: navigation failed — ${error instanceof Error ? error.message : String(error)}`)
          await page.screenshot({ path: screenshotPath, animations: 'disabled' }).catch(() => undefined)
          page.off('pageerror', onPageError)
          return
        }

        const main = page.locator('main').first()
        await main.waitFor({ state: 'attached', timeout: 5_000 }).catch(() => undefined)
        const mainCount = await main.count()
        if (mainCount === 0) {
          routeFailures.push(`${route}: main landmark is missing`)
        } else {
          await expect.soft(main, `${route}: main landmark`).toBeVisible()
        }

        // Auth has a visually-hidden h1 and a visible h2. Use the first visible
        // heading in main so the check measures the heading users actually see.
        const primaryHeading = main.locator('h1:visible, h2:visible').first()
        await primaryHeading.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined)
        const headingCount = await primaryHeading.count()
        if (headingCount === 0) {
          routeFailures.push(`${route}: visible primary heading is missing`)
        } else {
          await expect.soft(primaryHeading, `${route}: primary heading`).toBeVisible()
        }

        if (headingCount > 0) {
          const measurements = await primaryHeading.evaluate((heading) => ({
            width: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
            heading: parseFloat(getComputedStyle(heading).fontSize),
          }))
          expect.soft(measurements.scroll, `${route}: horizontal overflow`).toBeLessThanOrEqual(measurements.width + 1)
          expect.soft(measurements.heading, `${route}: oversized heading`).toBeLessThanOrEqual(28)
        }

        await page.screenshot({ path: screenshotPath, animations: 'disabled' })
        page.off('pageerror', onPageError)
        errors.push(...pageErrors.map((message) => `${route}: ${message}`))
      })
    }
    expect.soft(routeFailures, `${width}px route failures`).toEqual([])
    expect.soft(errors, `${width}px page errors`).toEqual([])
  })
}

test('representative pages pass WCAG 2.2 AA checks for main and navigation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Explicit viewports are covered with desktop Chromium.')
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const auth = await installMockAuth(page)
  await auth.loginAs('lin', '/me')
  await seedVerifiedUpdateAccess(page)

  const failures: string[] = []
  for (const [route, label] of representativeRoutes) {
    await test.step(`${label} ${route}`, async () => {
      try {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        const violations = await axeViolations(page)
        expect.soft(violations, `${route}: main/nav axe violations`).toEqual([])
      } catch (error) {
        failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  expect(failures, 'representative route axe failures').toEqual([])
})
