import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// The discovery pages currently run against the repository's prototype/local
// service data. These checks exercise that real browser surface and its URL
// state; they do not seed application state or replace service responses.

const viewports = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 1000 },
] as const

const learningIdea = '我想把大学 PDF 讲义生成选择题'
const portfolioIdea = '我想做一个开发者作品集展示项目'

const learningResultQuery = [
  `idea=${encodeURIComponent('PDF练习')}`,
  'category=ai_learning_quiz',
  'target=university_students',
  'scenario=question_generation',
  'input=pdf',
  'practice=single_choice',
  'practice=short_answer',
  'output=questions',
  'output=practice_set',
].join('&')

const portfolioResultQuery = [
  `idea=${encodeURIComponent('开发者作品集')}`,
  'category=personal_site_portfolio',
  'siteType=portfolio',
  'role=developer',
  'goal=showcase_projects',
].join('&')

type VisualScenario = {
  name: string
  path: string
  heading: string
  readyText?: string
}

const visualScenarios: readonly VisualScenario[] = [
  { name: 'categories', path: '/categories', heading: '选择品类，再寻找同类参考', readyText: '从你的用途出发' },
  { name: 'activity', path: '/activity', heading: '最新动态', readyText: '公开作品动态' },
  { name: 'category-learning', path: '/categories/ai-question-generation', heading: '把已有材料快速变成可练习的问题', readyText: 'AI 出题专题' },
  { name: 'category-portfolio', path: '/categories/personal-sites-portfolios', heading: '从身份、内容结构、视觉和实现方式寻找建站参考', readyText: '个人主页与作品集专题' },
  { name: 'search-learning', path: `/search?q=${encodeURIComponent('PDF')}&mode=works&category=ai_learning_quiz`, heading: '“PDF”的搜索结果', readyText: '4 个结果' },
  { name: 'search-portfolio', path: `/search?q=${encodeURIComponent('开发者作品集')}&mode=works&category=personal_site_portfolio`, heading: '“开发者作品集”的搜索结果', readyText: '个结果' },
  { name: 'discover-learning', path: `/discover?idea=${encodeURIComponent(learningIdea)}`, heading: '一起把想法说清楚', readyText: '想法已整理' },
  { name: 'discover-portfolio', path: `/discover?idea=${encodeURIComponent(portfolioIdea)}`, heading: '一起把想法说清楚', readyText: '想法已整理' },
  { name: 'result-learning-works', path: `/discover/result?${learningResultQuery}&view=works`, heading: '找到相似作品', readyText: '精确匹配作品' },
  { name: 'result-learning-analysis', path: `/discover/result?${learningResultQuery}&view=analysis`, heading: '找到相似作品', readyText: '同类分析' },
  { name: 'result-portfolio-works', path: `/discover/result?${portfolioResultQuery}&view=works`, heading: '找到相似作品', readyText: '精确匹配作品' },
  { name: 'result-portfolio-analysis', path: `/discover/result?${portfolioResultQuery}&view=analysis`, heading: '找到相似作品', readyText: '同类分析' },
] as const

async function settleDiscoveryPage(page: Page, scenario: VisualScenario) {
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1, name: scenario.heading })).toBeVisible()
  if (scenario.readyText) await expect(page.getByText(scenario.readyText, { exact: false }).first()).toBeVisible()
  // Browser service data is synchronous under webdriver, but allowing one
  // frame keeps the screenshot boundary after React has committed its final
  // result state.
  await page.waitForTimeout(50)
}

async function clearComparisonBar(page: Page) {
  const compareBar = page.getByRole('complementary', { name: '当前比较栏' })
  if (await compareBar.count() === 0 || !(await compareBar.isVisible())) return

  const clearButton = compareBar.getByRole('button', { name: '清空' })
  if (await clearButton.count() === 0) return
  await clearButton.click()

  const confirmation = page.getByRole('dialog', { name: '清空比较栏？' })
  await expect(confirmation).toBeVisible()
  const confirmClear = confirmation.getByRole('button', { name: '确认清空' })
  await confirmClear.focus()
  await expect(confirmClear).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(compareBar).toHaveCount(0)
}

async function revealFullPage(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < pageHeight; y += 600) {
    await page.evaluate((scrollTop) => window.scrollTo(0, scrollTop), y)
    await page.waitForTimeout(35)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.locator('[data-reveal-state="hidden"]')).toHaveCount(0)
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
        text: element.textContent?.trim().slice(0, 60),
      }))

    return { viewport, pageWidth, offenders }
  })

  expect(layout.pageWidth, `${context}: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(layout.viewport + 1)
}

async function openDiscoveryFilters(page: Page, title: '搜索筛选' | '作品筛选') {
  const trigger = page.getByRole('button', { name: '筛选与排序' })
  if (await trigger.isVisible()) {
    await trigger.focus()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog).toBeVisible()
    return { trigger, container: dialog }
  }

  const container = page.locator('.discovery-shell')
  await expect(container).toBeVisible()
  return { trigger, container }
}

async function closeDiscoveryFiltersIfOpen(page: Page, title: '搜索筛选' | '作品筛选') {
  const dialog = page.getByRole('dialog', { name: title })
  if (await dialog.count() > 0 && await dialog.isVisible()) await page.keyboard.press('Escape')
}

async function submitSearchThroughPageForm(page: Page, query: string) {
  await page.goto('/search')
  await page.waitForLoadState('networkidle')
  const shell = page.locator('.discovery-shell')
  const form = shell.getByRole('search').first()
  const input = form.getByRole('textbox', { name: '搜索作品或输入完整想法' })
  await expect(input).toBeVisible()
  await input.fill(query)
  await form.getByRole('button', { name: /搜索/ }).click()
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/(search|discover)$/)
}

async function assertAxe(page: Page, context: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations, context).toEqual([])
}

test.describe('Slice 3 discovery high fidelity visual baselines', () => {
  for (const scenario of visualScenarios) {
    test(`P02–P07 ${scenario.name} captures 390, 768, and 1440 baselines`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Slice 3 visual baselines are controlled by desktop Chromium; mobile behavior is covered by the functional gates')

      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(scenario.path)
        await settleDiscoveryPage(page, scenario)
        await clearComparisonBar(page)
        await revealFullPage(page)
        await expectNoHorizontalOverflow(page, `${scenario.name} ${viewport.name}px`)
        await expect(page).toHaveScreenshot(`slice3-${scenario.name}-${viewport.name}.png`, {
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
        })
      }
    })
  }
})

test.describe('Slice 3 discovery browser behavior', () => {
  const searchJourneys = [
    { name: 'learning', query: 'PDF', category: 'ai_learning_quiz', resultText: 'Paper to Practice' },
    { name: 'portfolio', query: '开发者作品集', category: 'personal_site_portfolio', resultText: 'Stackfolio' },
  ] as const

  for (const journey of searchJourneys) {
    test(`P05 ${journey.name} submits a query, filters through URL state, and recovers with browser back`, async ({ page }) => {
      await submitSearchThroughPageForm(page, journey.query)
      await expect(page).toHaveURL(new RegExp(`/${'search'}\\?q=`))
      await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${journey.query}`) })).toBeVisible()

      const { container } = await openDiscoveryFilters(page, '搜索筛选')
      const categoryFilter = container.getByLabel('作品品类')
      await expect(categoryFilter).toHaveCount(1)
      await categoryFilter.selectOption(journey.category)
      await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe(journey.category)
      await expect(page.getByText(journey.resultText, { exact: true })).toBeVisible()
      await closeDiscoveryFiltersIfOpen(page, '搜索筛选')

      await page.goBack()
      await expect.poll(() => new URL(page.url()).pathname).toBe('/search')
      await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBeNull()
      await expect(page.locator('.discovery-shell')).toBeVisible()
    })
  }

  test('P03 category filters update immediately and browser back restores the category overview', async ({ page }) => {
    await page.goto('/categories')
    await settleDiscoveryPage(page, visualScenarios[0]!)
    await page.getByRole('link', { name: '进入AI 出题专题' }).click()
    await expect(page).toHaveURL(/\/categories\/ai-question-generation$/)
    await expect(page.getByRole('heading', { level: 1, name: '把已有材料快速变成可练习的问题' })).toBeVisible()

    const { container } = await openDiscoveryFilters(page, '作品筛选')
    const inputFilter = container.getByLabel('材料输入')
    await expect(inputFilter).toHaveCount(1)
    await inputFilter.selectOption('image')
    await expect.poll(() => new URL(page.url()).searchParams.get('input')).toBe('image')
    await expect(page.getByText('1 个结果', { exact: true })).toBeVisible()
    await closeDiscoveryFiltersIfOpen(page, '作品筛选')

    await page.goBack()
    await expect(page).toHaveURL(/\/categories$/)
    await expect(page.getByRole('heading', { level: 1, name: '选择品类，再寻找同类参考' })).toBeVisible()
  })

  test('P03 narrow filters have one control, trap focus, and restore the trigger on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/categories/ai-question-generation')
    await settleDiscoveryPage(page, visualScenarios[2]!)

    const trigger = page.getByRole('button', { name: '筛选与排序' })
    await expect(trigger).toBeVisible()
    await expect(page.getByLabel('材料输入')).toHaveCount(0)
    await trigger.focus()
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: '作品筛选' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('材料输入')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Tab')
    await expect.poll(() => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
  })

  const discoveryJourneys = [
    {
      name: 'learning',
      idea: learningIdea,
      category: 'ai_learning_quiz',
      addLabel: '添加练习形式',
      addValue: 'flashcard',
      tagText: '闪卡',
    },
    {
      name: 'portfolio',
      idea: portfolioIdea,
      category: 'personal_site_portfolio',
      addLabel: '添加视觉方向',
      addValue: 'minimal',
      tagText: '极简',
    },
  ] as const

  for (const journey of discoveryJourneys) {
    test(`P06/P07 ${journey.name} submits a complete idea, edits it, and restores it on browser back`, async ({ page }) => {
      await submitSearchThroughPageForm(page, journey.idea)
      await expect(page).toHaveURL(/\/discover\?idea=/)
      await expect(page.getByRole('heading', { level: 1, name: '一起把想法说清楚' })).toBeVisible()
      const confirm = page.getByRole('button', { name: '确认并查找相似作品' })
      await expect(confirm).toBeEnabled()
      await confirm.click()
      await expect(page).toHaveURL(/\/discover\/result\?/)
      await expect(page.getByRole('heading', { level: 1, name: '找到相似作品' })).toBeVisible()
      await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe(journey.category)

      await page.getByRole('navigation', { name: '面包屑' }).getByRole('link', { name: '确认想法' }).click()
      await expect(page).toHaveURL(/\/discover\?idea=/)
      const addField = page.getByLabel(journey.addLabel)
      await expect(addField).toHaveCount(1)
      await addField.selectOption(journey.addValue)
      await expect(page.getByText(journey.tagText, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '确认并查找相似作品' }).click()
      await expect(page).toHaveURL(/\/discover\/result\?/)
      await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe(journey.category)

      await page.goBack()
      await expect(page).toHaveURL(/\/discover\?idea=/)
      await expect(page.getByRole('textbox', { name: '完整产品想法' })).toHaveValue(journey.idea)
      await expect(page.getByText(journey.tagText, { exact: true })).toBeVisible()
    })
  }

  test('P07 switches between works and analysis while preserving the existing query and low sample honesty', async ({ page }) => {
    await page.goto(`/discover/result?${learningResultQuery}&view=works`)
    await settleDiscoveryPage(page, visualScenarios[8]!)
    await expect(page.getByRole('heading', { name: '精确匹配作品' })).toBeVisible()
    await page.getByRole('tab', { name: '同类分析' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('analysis')
    await expect(page.getByRole('heading', { name: '常见做法' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '作品结果' })).toBeVisible()
    await page.getByRole('tab', { name: '作品结果' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('works')
    await expect(page.getByRole('heading', { name: '精确匹配作品' })).toBeVisible()

    await page.goto(`/discover/result?${portfolioResultQuery}&pageModel=single_page&visual=minimal&assetType=source_code&view=works`)
    await expect(page.getByRole('heading', { level: 1, name: '找到相似作品' })).toBeVisible()
    await expect(page.getByText(/0 个完全匹配的作品/)).toBeVisible()
    await expect(page.getByRole('heading', { name: '最接近的作品' })).toBeVisible()
  })

  test('P06 keeps the original text in the parse fallback and exposes a keyword exit', async ({ page }) => {
    const idea = '一个很特别的东西'
    await page.goto(`/discover?idea=${encodeURIComponent(idea)}`)
    await expect(page.getByRole('heading', { level: 1, name: '一起把想法说清楚' })).toBeVisible()
    await expect(page.getByText('还需要一些信息')).toBeVisible()
    await expect(page.getByRole('button', { name: '确认并查找相似作品' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '查看关键词结果' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '完整产品想法' })).toHaveValue(idea)
  })

  test('P02–P07 preserve honest empty and service error states from the prototype service', async ({ page }) => {
    await page.goto('/categories/ai-question-generation?input=audio')
    await expect(page.getByRole('heading', { name: '没有符合筛选条件的作品' })).toBeVisible()

    await page.goto('/activity?type=ended&category=ai-question-generation')
    await expect(page.getByRole('heading', { name: '没有符合条件的作品动态' })).toBeVisible()

    await page.goto('/search?q=%E5%AE%8C%E5%85%A8%E4%B8%8D%E5%AD%98%E5%9C%A8')
    await expect(page.getByText('没有找到匹配的公开作品')).toBeVisible()

    await page.goto(`/search?q=${encodeURIComponent('PDF')}&prototypeScenario=service_error`)
    await expect(page.getByText('服务暂时不可用。')).toBeVisible()

    await page.goto('/categories/not-real')
    await expect(page.getByRole('heading', { name: '未找到该专题' })).toBeVisible()
  })
})

test.describe('Slice 3 discovery accessibility and responsive gates', () => {
  const auditRoutes = visualScenarios

  for (const scenario of auditRoutes) {
    test(`${scenario.name} has no WCAG A/AA violations, reduced motion gaps, or horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(scenario.path)
      await settleDiscoveryPage(page, scenario)
      await clearComparisonBar(page)
      await revealFullPage(page)
      await expectNoHorizontalOverflow(page, `${scenario.name} reduced motion`)
      await assertAxe(page, scenario.name)
    })
  }
})
