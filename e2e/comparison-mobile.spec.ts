import { expect, test } from '@playwright/test'

test('mobile user compares only the selected projects', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile comparison flow')
  await page.goto('/compare/comparison-anonymous-pdf')
  await page.getByRole('button', { name: '查看完整字段' }).click()

  const switcher = page.getByRole('tablist', { name: '移动端作品切换' })
  await expect(switcher).toBeVisible()
  await expect(switcher.getByRole('tab')).toHaveCount(2)
  await switcher.getByRole('tab', { name: 'PDF 题库实验室' }).click()
  await expect(switcher.getByRole('tab', { name: 'PDF 题库实验室' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'PDF 题库实验室的比较字段' })).toContainText('定位')

  await expect(page.getByLabel('2 个作品的移动比较')).toBeVisible()
  await expect(page.getByRole('heading', { name: '记录比较后的行动' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并私密保存' })).toHaveCount(0)

  const layout = await page.evaluate(() => ({
    footerPosition: getComputedStyle(document.querySelector('.comparison-session-footer')!).position,
    cellFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.mobile-comparison-row .comparison-cell')!).fontSize),
    horizontalMatrixVisible: Boolean(document.querySelector('.comparison-matrix-scroll')),
  }))
  expect(layout.footerPosition).toBe('fixed')
  expect(layout.cellFontSize).toBeGreaterThanOrEqual(16)
  expect(layout.horizontalMatrixVisible).toBe(false)
})
