import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installMockAuth } from './support/mock-auth'

for (const width of [390, 1440]) {
  test(`publisher images, recovery and accessible layout ${width}`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Explicit responsive sizes')
    await page.setViewportSize({ width, height: 900 })
    await installMockAuth(page)
    await page.goto('/submit')
    await expect(page.getByLabel('作品名称 *')).toBeEditable()
    await page.getByLabel('作品名称 *').fill('Image draft')
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 240
      const context = canvas.getContext('2d')!
      context.fillStyle = '#b8ff3d'; context.fillRect(0, 0, 320, 240)
      return canvas.toDataURL('image/png')
    })
    const bytes = Buffer.from(dataUrl.split(',')[1]!, 'base64')
    await page.getByLabel('添加作品截图').setInputFiles([
      { name: 'first.png', mimeType: 'image/png', buffer: bytes },
      { name: 'second.png', mimeType: 'image/png', buffer: bytes },
    ])
    await expect(page.locator('.publish-media-item')).toHaveCount(2)
    await page.getByRole('button', { name: '将第 2 张图片前移' }).click()
    await page.getByRole('button', { name: '裁剪', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: '裁剪图片' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '裁剪图片' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '裁剪', exact: true }).first()).toBeFocused()
    await page.getByRole('button', { name: '裁剪', exact: true }).first().click()
    await page.getByLabel('画面比例').selectOption('0.75')
    await page.getByRole('button', { name: '应用裁剪', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '裁剪图片' })).toHaveCount(0)
    await expect.poll(() => page.locator('.publish-media-item img').first().evaluate((image) => {
      const img = image as HTMLImageElement
      return img.naturalWidth / img.naturalHeight
    })).toBe(0.75)

    await expect(page.getByRole('status').filter({ hasText: '草稿已保存到此设备' })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('作品名称 *')).toHaveValue('Image draft')
    await expect(page.locator('.publish-media-item')).toHaveCount(2)
    await page.getByRole('button', { name: '移除第 2 张图片' }).click()
    await expect(page.locator('.publish-media-item')).toHaveCount(1)
    if (width === 390) {
      await page.getByRole('button', { name: '预览', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '广场展示预览' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: '预览', exact: true })).toBeFocused()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
    await page.screenshot({ path: `outputs/publish-review/final-${width}.png`, fullPage: true })
  })
}
