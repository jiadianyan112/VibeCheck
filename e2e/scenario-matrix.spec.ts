import { expect, test } from '@playwright/test'

test.describe('T53 生产构建场景参数', () => {
  test('隐藏开发面板，同时保留搜索不足与服务错误参数', async ({ page, isMobile }) => {
    test.skip(isMobile, '参数行为与视口无关；移动场景在 T54 覆盖')
    await page.goto('/search?q=PDF&prototypeScenario=search_insufficient')
    await expect(page.getByRole('heading', { name: '2 个结果' })).toBeVisible()
    await expect(page.locator('.scenario-panel')).toHaveCount(0)

    await page.goto('/search?q=PDF&prototypeScenario=service_error')
    await expect(page.getByRole('alert')).toContainText('模拟服务暂时不可用')
    await page.getByText('查看技术信息').click()
    await expect(page.getByText('VC_SERVICE_UNAVAILABLE')).toBeVisible()
    await page.goto('/search?q=PDF')
    await expect(page.getByRole('heading', { name: '3 个结果' })).toBeVisible()
  })

  test('可信状态和比较不足可由固定参数直接复现', async ({ page, isMobile }) => {
    test.skip(isMobile, '参数行为与视口无关；移动场景在 T54 覆盖')
    await page.goto('/project/project-pdfquizlab?prototypeScenario=platform_included')
    await expect(page.getByText('尚未关联验证作者')).toBeVisible()

    await page.goto('/project/project-learntrack?prototypeScenario=field_unknown')
    await expect(page.getByText('当前状态未知')).toBeVisible()

    await page.goto('/project/project-dailydrill?prototypeScenario=link_anomaly')
    await expect(page.getByText('当前公开链接不可用')).toBeVisible()

    await page.goto('/compare/comparison-anonymous-pdf?prototypeScenario=comparison_insufficient')
    await expect(page.getByText('1/5 个作品')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '还不能开始正式比较' })).toBeVisible()
  })
})
