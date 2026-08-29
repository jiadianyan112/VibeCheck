import { expect, test, type Page } from '@playwright/test'
import { installMockAuth } from './support/mock-auth'

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

const criticalRoutes = [
  '/projects',
  '/search?q=PDF',
  '/project/project-pdfquizlab',
  '/compare/comparison-anonymous-pdf',
  '/submit',
  '/project/project-pdfquizlab/verify-author',
]

async function expectNoPageOverflow(page: Page, context: string) {
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

async function bringAboveFixedBar(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded()
  const overlap = await page.evaluate(() => {
    const bar = document.querySelector('.compare-bar')?.getBoundingClientRect()
    return bar ? Math.max(0, innerHeight - bar.top + 16) : 0
  })
  if (overlap) await page.mouse.wheel(0, overlap)
}

test.describe('T54 响应式关键路径', () => {
  test('360、390、768 和桌面视口没有页面级横向滚动', async ({ page }) => {
    test.setTimeout(45_000)
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      for (const route of criticalRoutes) {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        await expectNoPageOverflow(page, `${viewport.width}px ${route}`)
        if (viewport.width <= 768 && route === '/project/project-pdfquizlab') {
          const fixedBars = await page.evaluate(() => {
            const actions = document.querySelector('.project-primary-actions')?.getBoundingClientRect()
            const compare = document.querySelector('.compare-bar')?.getBoundingClientRect()
            return actions && compare ? { actionBottom: actions.bottom, compareTop: compare.top } : null
          })
          expect(fixedBars, `${viewport.width}px 详情与比较操作栏均应存在`).not.toBeNull()
          expect(fixedBars!.actionBottom, `${viewport.width}px 两条固定操作栏不得重叠`).toBeLessThanOrEqual(fixedBars!.compareTop)
        }
      }
    }
  })

  test('390px 可展开筛选、加入比较并进入纵向比较', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/search?q=PDF')
    const filters = page.locator('.filter-panel')
    await expect(filters.locator('summary')).toBeVisible()
    await filters.locator('summary').click()
    await filters.getByLabel('当前状态').selectOption('normal')
    await expect(page).toHaveURL(/status=normal/)
    await filters.getByRole('button', { name: '重置' }).click()
    await expect(page.getByRole('heading', { name: '4 个结果' })).toBeVisible()
    await filters.locator('summary').click()

    const candidate = page.locator('article').filter({ has: page.getByRole('link', { name: 'Paper to Practice' }) })
    const addButton = candidate.getByRole('button', { name: '加入比较' })
    await bringAboveFixedBar(page, addButton)
    await addButton.click()
    await page.getByRole('link', { name: '开始比较' }).click()
    await page.getByRole('button', { name: '查看完整字段' }).click()
    const switcher = page.getByRole('tablist', { name: '移动端作品切换' })
    await expect(switcher).toBeVisible()
    await expect(switcher.getByRole('tab')).toHaveCount(3)
    await expect(page.locator('.comparison-matrix-scroll')).toHaveCount(0)
    await expect(page.locator('.compare-bar')).toHaveCount(0)
    await expect(page.locator('.comparison-session-footer')).toBeVisible()
    await expectNoPageOverflow(page, '390px 搜索到比较')
  })

  test('360px 可完成发布地址检查并进入发布步骤', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    const mockAuth = await installMockAuth(page, { submission: true })
    await mockAuth.loginAs('mia', '/submit')
    await page.getByRole('textbox', { name: /^作品地址/ }).fill('example.test/mobile-publish')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('地址检查通过')).toBeVisible()
    await page.getByRole('button', { name: '继续补充作品信息' }).click()
    await expect(page.getByRole('heading', { name: '发布新作品' })).toBeVisible()
    await expect(page.locator('.submission-progress')).toBeVisible()
    await expectNoPageOverflow(page, '360px 发布流程')
  })

  test('390px 弹层保持在视口内，后台显示窄屏提示并只在表格内滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const mockAuth = await installMockAuth(page)
    await page.goto('/project/project-pdfquizlab')
    await page.locator('.project-primary-actions').getByRole('button', { name: '收藏' }).click()
    const dialog = page.getByRole('dialog', { name: '登录后继续刚才的操作' })
    await expect(dialog).toBeVisible()
    const dialogBox = await dialog.boundingBox()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844)
    await dialog.getByRole('link', { name: '使用邮箱验证码登录' }).click()
    await expect(page).toHaveURL(/\/auth\?return_to=%2Fproject%2Fproject-pdfquizlab$/)
    await mockAuth.loginCurrent('mia', '/project/project-pdfquizlab')

    const cancelCollection = page.locator('.project-primary-actions').getByRole('button', { name: '取消收藏' })
    await expect(cancelCollection).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('收藏设置')).toHaveCount(0)
    const actionBarFits = await page.locator('.project-primary-actions').evaluate((element) => element.scrollWidth <= element.clientWidth)
    expect(actionBarFits).toBe(true)
    await cancelCollection.click()
    await expect(page.locator('.project-primary-actions').getByRole('button', { name: '收藏' })).toHaveAttribute('aria-pressed', 'false')

    await page.goto('/auth?return_to=%2Fadmin%2Fprojects')
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page.getByRole('heading', { name: '邮箱验证码登录' })).toBeVisible()
    await mockAuth.loginCurrent('lin', '/admin/projects')
    await expect(page).toHaveURL(/\/admin\/projects$/)
    await expect(page.getByRole('note')).toContainText('后台按桌面工作台设计')
    await expect(page.locator('.admin-table-scroll')).toBeVisible()
    await expectNoPageOverflow(page, '390px 后台基础窄屏')
  })
})
