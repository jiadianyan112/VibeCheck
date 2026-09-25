import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { installMockAuth } from './support/mock-auth'

const publicRoutes = [
  ['/projects', '作品广场'],
  ['/search?q=PDF', '搜索结果'],
  ['/project/project-pdfquizlab', '作品详情'],
  ['/compare/comparison-anonymous-pdf', '比较会话'],
  ['/submit', '发布入口'],
  ['/auth?return_to=%2Fprojects', '登录'],
  ['/about', '关于'],
] as const

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

test.describe('T55 axe 核心页面审计', () => {
  for (const [route, label] of publicRoutes) {
    test(`${label}没有 WCAG A/AA axe 违规`, async ({ page }) => {
      await installMockAuth(page)
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(await axeViolations(page)).toEqual([])
    })
  }

  test('登录弹层没有严重问题', async ({ page }) => {
    await installMockAuth(page)
    await page.goto('/project/project-pdfquizlab')
    await page.locator('.project-primary-actions').getByRole('button', { name: '收藏' }).click()
    await expect(page.getByRole('dialog', { name: '登录后继续刚才的操作' })).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
  })

  test('登录后的发布表单和身份材料页没有 WCAG A/AA 违规', async ({ page }) => {
    const mockAuth = await installMockAuth(page, { submission: true })
    await mockAuth.loginAs('mia', '/submit')
    await page.getByRole('textbox', { name: /^作品地址/ }).fill('https://example.test/accessible-tool')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('地址检查通过')).toBeVisible()
    await page.getByRole('button', { name: '继续补充作品信息' }).click()
    await expect(page.getByRole('heading', { name: '发布新作品' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await axeViolations(page)).toEqual([])

    await page.goto('/project/project-pdfquizlab/verify-author')
    await expect(page.getByRole('heading', { name: '认领作品' })).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
  })
})
