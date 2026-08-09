import { expect, test } from '@playwright/test'

test('mobile user completes a comparison decision without losing the form', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile comparison flow')
  await page.goto('/compare/comparison-anonymous-pdf')
  await page.getByRole('button', { name: '查看完整字段' }).click()

  const switcher = page.getByRole('tablist', { name: '移动端作品切换' })
  await expect(switcher).toBeVisible()
  await expect(switcher.getByRole('tab')).toHaveCount(2)
  await switcher.getByRole('tab', { name: 'PDF 题库实验室' }).click()
  await expect(switcher.getByRole('tab', { name: 'PDF 题库实验室' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'PDF 题库实验室的比较字段' })).toContainText('定位')

  await page.getByRole('radio', { name: '调整' }).click()
  await page.getByRole('checkbox', { name: '定位' }).click()
  await page.getByLabel('判断理由').fill('根据差异调整目标用户与产品定位。')
  await page.getByRole('button', { name: '完成并私密保存' }).click()
  await expect(page.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeVisible()
  await expect(page.getByLabel('判断理由')).toHaveValue('根据差异调整目标用户与产品定位。')
  await page.getByRole('button', { name: /米娅/ }).click()
  await expect(page.getByRole('heading', { name: '决策记录已保存' })).toBeVisible()
  await expect(page.getByText('仅自己可见')).toBeVisible()

  const layout = await page.evaluate(() => ({
    footerPosition: getComputedStyle(document.querySelector('.comparison-session-footer')!).position,
    cellFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.mobile-comparison-row .comparison-cell')!).fontSize),
    horizontalMatrixVisible: Boolean(document.querySelector('.comparison-matrix-scroll')),
  }))
  expect(layout.footerPosition).toBe('fixed')
  expect(layout.cellFontSize).toBeGreaterThanOrEqual(16)
  expect(layout.horizontalMatrixVisible).toBe(false)
})
