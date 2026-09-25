import { mkdir } from 'node:fs/promises'

import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const viewports = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 1000 },
] as const

const channels = [
  { label: '全部', value: null },
  { label: '个人主页', value: 'portfolio' },
  { label: 'AI 学习', value: 'learning' },
  { label: '可复用', value: 'reusable' },
  { label: '已结束', value: 'ended' },
] as const

async function openExplore(page: Page, path = '/projects') {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.explore-page')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '发现好作品' })).toBeVisible()
  await expect(page.locator('section[aria-label="作品列表"]')).toBeVisible()
  await expect(page.locator('section[aria-label="作品列表"] article.feed-card').first()).toBeVisible()
  await clearComparisonBar(page)
}

function feedCards(page: Page) {
  return page.locator('section[aria-label="作品列表"] article.feed-card')
}

function channelButton(page: Page, label: string) {
  return page.locator('.explore-channels').getByRole('button', { name: label, exact: true })
}

async function clearComparisonBar(page: Page) {
  const compareBar = page.getByRole('complementary', { name: '当前比较栏' })
  if (await compareBar.count() === 0 || !(await compareBar.isVisible())) return

  await compareBar.getByRole('button', { name: '查看作品', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '已选作品' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: '清空', exact: true }).click()

  const confirmation = page.getByRole('dialog', { name: '清空比较栏？' })
  await expect(confirmation).toBeVisible()
  const confirmClear = confirmation.getByRole('button', { name: '确认清空', exact: true })
  await confirmClear.focus()
  await expect(confirmClear).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(compareBar).toHaveCount(0)
}

async function expectNoHorizontalOverflow(page: Page, context: string) {
  const layout = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const pageWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && (rect.right > viewport + 1 || rect.left < -1)
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        text: element.textContent?.trim().slice(0, 80),
      }))

    return { viewport, pageWidth, offenders }
  })

  expect(layout.pageWidth, `${context}: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(layout.viewport + 1)
}

async function expectFirstCardInViewport(page: Page, viewport: { width: number; height: number }, context: string) {
  const card = feedCards(page).first()
  await expect(card).toBeVisible()
  await expect(card.locator('.feed-card__media-link')).toBeVisible()
  const box = await card.boundingBox()
  expect(box, `${context}: first feed card has no layout box`).toBeTruthy()
  expect(box!.y, `${context}: first feed card starts below the first screen`).toBeLessThan(viewport.height)
  expect(box!.y + box!.height, `${context}: first feed card is not visible in the first screen`).toBeGreaterThan(0)
}

async function assertExploreRegionsHaveNoAxeViolations(page: Page) {
  for (const selector of ['main', 'nav']) {
    const result = await new AxeBuilder({ page })
      .include(selector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target.join(' ')),
      })),
      `${selector} has accessibility violations`,
    ).toEqual([])
  }
}

test.describe('探索首页首屏视觉检查', () => {
  test('390、768、1440 首屏展示真实作品卡片并输出评审截图', async ({ page, isMobile }) => {
    test.skip(isMobile, '使用 desktop Chromium 在三个明确宽度下生成一致的评审截图')
    await mkdir('outputs/explore-review', { recursive: true })

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await openExplore(page)
      await expectFirstCardInViewport(page, viewport, `${viewport.name}px`)
      await expectNoHorizontalOverflow(page, `${viewport.name}px`)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({
        path: `outputs/explore-review/explore-feed-${viewport.name}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
    }
  })
})

test.describe('探索首页筛选与返回上下文', () => {
  test('分类按钮更新 channel URL，并只保留一个 aria-pressed 分类', async ({ page }) => {
    await openExplore(page)

    for (const channel of channels) {
      await channelButton(page, channel.label).click()
      await expect(channelButton(page, channel.label)).toHaveAttribute('aria-pressed', 'true')
      for (const otherChannel of channels.filter((item) => item.label !== channel.label)) {
        await expect(channelButton(page, otherChannel.label)).toHaveAttribute('aria-pressed', 'false')
      }

      await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe(channel.value)
      await expect(feedCards(page).first()).toBeVisible()
    }
  })

  test('排序控件更新 sort URL，并与当前 channel 一起保留', async ({ page }) => {
    await openExplore(page)

    await channelButton(page, '个人主页').click()
    await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe('portfolio')

    const sort = page.getByLabel('作品排序')
    await expect(sort).toBeVisible()
    await sort.selectOption('latest')
    await expect(sort).toHaveValue('latest')
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('latest')
    await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe('portfolio')

    await sort.selectOption('updated')
    await expect(sort).toHaveValue('updated')
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('updated')
    await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe('portfolio')
    await expect(feedCards(page).first()).toBeVisible()
  })

  test('进入作品详情后浏览器后退保留分类、排序和卡片上下文', async ({ page }) => {
    await openExplore(page)

    await channelButton(page, '个人主页').click()
    await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe('portfolio')
    await page.getByLabel('作品排序').selectOption('updated')
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('updated')
    await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe('portfolio')

    const card = feedCards(page).first()
    await expect(card).toBeVisible()
    const title = (await card.locator('.feed-card__title').innerText()).trim()
    await card.locator('a[href^="/project/"]').first().click()
    await expect(page).toHaveURL(/\/project\/[^/?#]+$/)
    await expect(page.locator('main.project-detail-page')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/projects\?channel=portfolio&sort=updated$/)
    await expect(channelButton(page, '个人主页')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('作品排序')).toHaveValue('updated')
    await expect(feedCards(page).first()).toBeVisible()
  })
})

test.describe('探索首页真实用户交互', () => {
  test('访客收藏会打开登录弹窗且不显示旧原型账号按钮', async ({ page }) => {
    await openExplore(page)
    const card = feedCards(page).first()

    await card.getByRole('button', { name: '收藏', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '登录后继续刚才的操作' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: '前往登录' })).toBeVisible()
    await expect(page.getByRole('button', { name: '使用米娅账号', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '使用周可账号', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: '暂不登录' }).click()
    await expect(dialog).toBeHidden()
    await expect(card.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false')
  })

  test('通过卡片真实 UI 加入比较并移除比较', async ({ page }) => {
    await openExplore(page)
    const card = feedCards(page).first()
    const add = card.getByRole('button', { name: '加入比较', exact: true })

    await add.click()
    await expect(card.getByRole('button', { name: '移出比较', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const compareBar = page.getByRole('complementary', { name: '当前比较栏' })
    await expect(compareBar).toBeVisible()

    await card.getByRole('button', { name: '移出比较', exact: true }).click()
    await expect(card.getByRole('button', { name: '加入比较', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(compareBar).toHaveCount(0)
  })
})

test.describe('探索首页可访问性', () => {
  test('main 和导航通过 axe WCAG A/AA 扫描', async ({ page }) => {
    await openExplore(page)
    await assertExploreRegionsHaveNoAxeViolations(page)
  })
})
