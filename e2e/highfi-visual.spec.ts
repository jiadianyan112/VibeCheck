import { expect, test, type Page } from '@playwright/test'

const p01Viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const

async function revealFullPage(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < pageHeight; y += 600) {
    await page.evaluate((scrollTop) => window.scrollTo(0, scrollTop), y)
    await page.waitForTimeout(50)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator('[data-reveal-state="hidden"]')).toHaveCount(0)
}

for (const viewport of p01Viewports) {
  test(`P01 ${viewport.name} visual baseline`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/projects')
    await page.waitForLoadState('networkidle')
    await revealFullPage(page)
    await expect(page).toHaveScreenshot(`p01-${viewport.name}.png`, { fullPage: true, animations: 'disabled' })
  })
}

test('P01 remains complete with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: '编辑精选' })).toBeVisible()
  await expect(page.locator('[data-reveal-state="hidden"]')).toHaveCount(0)
})
