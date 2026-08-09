import { expect, test, type Page } from '@playwright/test'

async function loginAs(page: Page, displayName: '米娅' | '周可', returnPath: string) {
  await page.goto(`/auth?from=${encodeURIComponent(returnPath)}`)
  await page.getByRole('button', { name: `使用${displayName}账号` }).click()
  await expect(page).toHaveURL(new RegExp(`${returnPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}

async function completeRequiredSubmissionFields(page: Page) {
  await expect(page.getByRole('heading', { name: '发布新作品' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '作品名称' })).toHaveValue('自动提取的作品名称')
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expect(page.getByRole('heading', { name: '产品定义' })).toBeVisible()
  await page.getByRole('checkbox', { name: '大学生' }).check()
  await page.getByRole('textbox', { name: '核心问题（必填）' }).fill('把 PDF 学习材料快速转成可复习的练习')
  await page.getByRole('checkbox', { name: '生成题目' }).check()
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expect(page.getByRole('heading', { name: '方案与功能' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'PDF' }).check()
  await page.getByRole('checkbox', { name: '题目' }).check()
  await page.getByRole('textbox', { name: '核心流程（必填，每行一步）' }).fill('上传材料\n生成练习\n查看反馈')
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expect(page.getByRole('heading', { name: '开发与资产' })).toBeVisible()
  await page.getByRole('button', { name: '保存并预览' }).click()
  await expect(page.getByRole('heading', { name: '发布预览' })).toBeVisible()
}

test.describe('T56 六个原型测试任务', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, '六项正式验收在桌面运行；移动关键流程由 T54/T55 套件覆盖'))

  test('U01 找到 PDF 生成题目的作品并保存', async ({ page }) => {
    await page.goto('/search?q=PDF&mode=works')
    const result = page.locator('article').filter({ has: page.locator('a[href="/project/project-papertopractice"]') })
    await expect(page.getByRole('heading', { name: '“PDF”的搜索结果' })).toBeVisible()
    await expect(result).toContainText('识别扫描讲义并生成分难度练习')
    await result.getByRole('button', { name: '收藏' }).click()
    const dialog = page.getByRole('dialog', { name: '登录后继续刚才的操作' })
    await dialog.getByRole('button', { name: /周可/ }).click()
    await expect(result.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('U02 比较三个口语模考作品并记录反馈方式', async ({ page }) => {
    await page.goto('/compare/comparison-mia-speaking')
    await expect(page.getByText('3/5 个作品', { exact: true })).toBeVisible()
    await expect(page.getByText('管理比较作品', { exact: true }).first()).toBeVisible()
    const matrix = page.getByLabel('3 个作品的横向比较表')
    await expect(matrix).toContainText('反馈方式')
    await expect(matrix).toContainText('有差异')

    await page.getByRole('radio', { name: '调整' }).check()
    await page.getByRole('checkbox', { name: '功能' }).check()
    await page.getByLabel('判断理由').fill('比较三种口语模考的反馈方式后，采用分项反馈并保留学习建议。')
    await page.getByRole('button', { name: '完成并私密保存' }).click()
    await page.getByRole('dialog', { name: '登录后继续刚才的操作' }).getByRole('button', { name: /周可/ }).click()
    await expect(page.getByRole('heading', { name: '决策记录已保存' })).toBeVisible()
    await expect(page.getByText('比较三种口语模考的反馈方式后，采用分项反馈并保留学习建议。')).toBeVisible()
  })

  test('U03 查看结束作品留下的资产', async ({ page }) => {
    await page.goto('/projects')
    const endedSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '已结束，但仍可复用' }) })
    await endedSection.getByRole('link', { name: 'EchoScore' }).click()
    await expect(page.getByRole('heading', { name: 'EchoScore', level: 1 })).toBeVisible()
    await expect(page.getByText('已结束').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: '复用资产' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '录音波形与回放组件' })).toBeVisible()
    await expect(page.getByText(/作品停止维护后，公开的代码、模板或组件仍可能继续使用/)).toBeVisible()
  })

  test('U04 发布一个新作品并查看首次发布记录', async ({ page }) => {
    await loginAs(page, '米娅', '/submit')
    await page.getByRole('textbox', { name: /^作品地址/ }).fill('https://example.test/u04-published-tool')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('地址检查通过')).toBeVisible()
    await page.getByRole('button', { name: '继续补充作品信息' }).click()
    await completeRequiredSubmissionFields(page)

    const approvedUrl = new URL(page.url())
    approvedUrl.searchParams.set('scenario', 'review_approved')
    await page.goto(approvedUrl.toString())
    await page.getByRole('button', { name: '确认并提交审核' }).click()
    await page.getByRole('button', { name: '确认提交' }).click()
    await expect(page.getByRole('heading', { name: '审核状态：已通过' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '作品已通过并发布' })).toBeVisible()

    const activityHref = await page.getByRole('link', { name: '查看首次发布动态' }).getAttribute('href')
    await page.getByRole('link', { name: '进入作品详情' }).click()
    await expect(page.getByRole('heading', { name: '自动提取的作品名称', level: 1 })).toBeVisible()
    await page.goto(activityHref!)
    await expect(page.getByText('自动提取的作品名称通过审核并首次发布。')).toBeVisible()
  })

  test('U05 发布时发现已有档案并提交身份材料', async ({ page }) => {
    await loginAs(page, '周可', '/submit?scenario=duplicate_project')
    await page.getByRole('textbox', { name: /^作品地址/ }).fill('https://example.test/u05-existing-project')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('发现已有作品档案。')).toBeVisible()
    await page.getByRole('checkbox', { name: /我是该作品作者/ }).check()
    await page.getByRole('link', { name: '继续验证作者身份' }).click()
    await expect(page.getByRole('heading', { name: '认领作品' })).toBeVisible()
    await expect(page.getByText(/不会显示在作品详情、最新动态或作者主页中/)).toBeVisible()
    await page.getByLabel('材料摘要').fill('公开主页展示了本人身份与该作品名称。')
    await page.getByLabel('验证材料').fill('https://example.test/private/u05-proof')
    await page.getByRole('button', { name: '提交人工审核' }).click()
    await expect(page.getByRole('heading', { name: '待人工审核' })).toBeVisible()
    await expect(page.getByText(/没有可靠预计时间/)).toBeVisible()
  })

  test('U06 发布版本更新并查看时间线与动态', async ({ page }) => {
    await loginAs(page, '周可', '/project/project-speakmirror/update?type=version')
    await page.getByRole('textbox', { name: '新版本名称或编号' }).fill('2.3 · U06 回归版本')
    await page.getByRole('textbox', { name: '来源说明' }).fill('作者公开发布说明')
    await page.getByRole('textbox', { name: '影响范围' }).fill('作品详情、公开动态与关注者通知')
    await page.getByRole('button', { name: '预览确认并提交更新' }).click()
    await page.getByRole('button', { name: '确认提交更新' }).click()
    await expect(page.getByText('更新已同步到作品详情、作品时间线和最新动态。')).toBeVisible()

    const detailHref = await page.getByRole('link', { name: '在详情中查看' }).getAttribute('href')
    const activityHref = await page.getByRole('link', { name: '在动态中查看' }).getAttribute('href')
    const eventId = detailHref!.split('#')[1]!
    await page.goto(detailHref!)
    await expect(page.locator(`[id="${eventId}"]`)).toContainText('2.3 · U06 回归版本')
    await page.goto(activityHref!)
    await expect(page.locator(`[id="${eventId}"]`)).toContainText('2.3 · U06 回归版本')
  })
})
