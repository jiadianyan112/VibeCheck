import { expect, test, type Page } from '@playwright/test'

async function loginAsMia(page: Page, returnPath: string) {
  await page.goto(`/auth?from=${encodeURIComponent(returnPath)}`)
  await page.getByRole('button', { name: '使用米娅账号' }).click()
  await expect(page).toHaveURL(new RegExp(`${returnPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}

test.describe('低保真评审修复验收', () => {
  test('完整作品集想法进入对应品类意图与结果', async ({ page, isMobile }) => {
    test.skip(isMobile, '桌面完整流程；移动筛选另行覆盖')
    const idea = '我想做开发者作品集，用一页展示项目，风格极简并提供源代码'
    await page.goto(`/discover?idea=${encodeURIComponent(idea)}`)

    await expect(page.getByRole('heading', { name: '一起把想法说清楚' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '作品品类' })).toHaveValue('personal_site_portfolio')
    await expect(page.getByRole('combobox', { name: '添加网站类型' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '添加作者身份' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '添加建站目的' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '添加视觉方向' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '添加希望复用' })).toBeVisible()
    await expect(page.getByText('单页', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '添加目标用户' })).toHaveCount(0)

    await page.getByRole('button', { name: '确认并查找相似作品' }).click()
    await expect(page).toHaveURL(/category=personal_site_portfolio/)
    await expect(page.getByRole('heading', { name: '找到相似作品' })).toBeVisible()
    await expect(page.getByText('个人主页与作品集').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: '最接近的作品' })).toBeVisible()
    await expect(page.getByRole('button', { name: /清除.*筛选/ })).toHaveCount(0)
  })

  test('桌面筛选始终展开，移动筛选默认收起且可切换', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/search?q=PDF')
    const desktopFilters = page.locator('.filter-panel')
    await expect(desktopFilters).toHaveAttribute('open', '')
    await expect(desktopFilters.getByLabel('当前状态')).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(desktopFilters).not.toHaveAttribute('open', '')
    await expect(desktopFilters.getByLabel('当前状态')).not.toBeVisible()
    await desktopFilters.locator('summary').click()
    await expect(desktopFilters.getByLabel('当前状态')).toBeVisible()
  })

  test('作品集仅需六项核心事实，专注发布流不显示比较栏', async ({ page, isMobile }) => {
    test.skip(isMobile, '桌面表单完整流程；移动入口由响应式套件覆盖')
    await loginAsMia(page, '/submit?category=personal_site_portfolio')
    await expect(page.locator('.compare-bar')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '作品品类' })).toHaveValue('personal_site_portfolio')
    await page.getByRole('textbox', { name: /^作品地址/ }).fill('https://example.test/shape-portfolio')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('地址检查通过')).toBeVisible()
    await page.getByRole('button', { name: '继续补充作品信息' }).click()

    await expect(page.locator('.compare-bar')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '作品名称' })).toHaveValue('自动提取的作品名称')
    await expect(page.getByRole('textbox', { name: '一句话简介' })).not.toHaveValue('')
    await expect(page.getByRole('combobox', { name: '基础访问状态（必填）' })).toHaveCount(0)
    await page.getByRole('button', { name: '保存并继续' }).click()

    await expect(page.getByRole('heading', { name: '定位与用途' })).toBeVisible()
    await expect(page.getByText('网站类型（必填）')).toHaveCount(0)
    await page.getByRole('checkbox', { name: '开发者' }).check()
    await page.getByRole('checkbox', { name: '展示项目' }).check()
    await page.getByRole('button', { name: '保存并继续' }).click()

    await expect(page.getByRole('heading', { name: '核心内容' })).toBeVisible()
    await expect(page.getByText('视觉风格（必填）')).toHaveCount(0)
    await page.getByRole('checkbox', { name: '首屏' }).check()
    await page.getByRole('checkbox', { name: '项目' }).check()
    await page.getByRole('button', { name: '保存并继续' }).click()

    await expect(page.getByRole('heading', { name: '开发与资产' })).toBeVisible()
    await expect(page.getByText('资产归属会单独确认')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /Atlas/ })).toHaveCount(0)
    await page.getByRole('button', { name: '保存并预览' }).click()
    await expect(page.getByRole('heading', { name: '发布预览' })).toBeVisible()
    await expect(page.getByLabel('社区卡片预览')).toContainText('个人主页与作品集')
    await expect(page.getByText('创作者身份').locator('..')).toContainText('开发者')
    await expect(page.getByText('建站目的').locator('..')).toContainText('展示项目')
    await expect(page.getByText('核心内容').locator('..')).toContainText('首屏、项目')
    await expect(page.getByText('作者公开资产').locator('..')).toContainText('发布后可在“管理作品”中添加')
    await expect(page.getByText('目标用户')).toHaveCount(0)
  })

  test('比较作品变化后只比较当前选择的作品', async ({ page, isMobile }) => {
    test.skip(isMobile, '桌面作品替换流程；移动端已覆盖纵向比较')
    await loginAsMia(page, '/compare/comparison-mia-speaking')
    await page.locator('summary').filter({ hasText: '管理比较作品' }).click()
    const selectedList = page.getByRole('list', { name: '已选比较作品' })
    const previousProjectName = (await selectedList.getByRole('listitem').first().locator('strong').textContent()) ?? ''
    await selectedList.getByRole('button', { name: '替换' }).first().click()
    await page.getByLabel(/替换/).selectOption('project-terminal-craft')

    await expect(selectedList).toContainText('Terminal Craft')
    await expect(selectedList).not.toContainText(previousProjectName)
    await expect(page.locator('.comparison-project-header')).toContainText('Terminal Craft')
    await expect(page.getByRole('heading', { name: '记录比较后的行动' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '记录行动' })).toHaveCount(0)
  })

  test('比较先呈现中立摘要，完整矩阵按需展开', async ({ page, isMobile }) => {
    test.skip(isMobile, '桌面矩阵展开；移动端使用纵向比较')
    await page.goto('/compare/comparison-mia-speaking')
    await expect(page.locator('.compare-bar')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '关键差异摘要' })).toBeVisible()
    await expect(page.getByText('摘要只基于当前选择的作品，不要求提交额外判断。')).toBeVisible()

    const details = page.locator('#comparison-detail-matrix')
    await expect(details).not.toHaveAttribute('open', '')
    await expect(page.getByRole('navigation', { name: '比较维度' })).not.toBeVisible()
    await page.getByRole('button', { name: '查看完整字段' }).click()
    await expect(details).toHaveAttribute('open', '')
    await expect(page.getByRole('navigation', { name: '比较维度' })).toBeVisible()
    await expect(page.getByLabel('3 个作品的横向比较表')).toBeVisible()
  })
})
