import { expect, test, type Page } from '@playwright/test'

async function loginAs(page: Page, displayName: '米娅' | '周可', returnPath: string) {
  await page.goto(`/auth?from=${encodeURIComponent(returnPath)}`)
  await page.getByRole('button', { name: `使用${displayName}账号` }).click()
  await expect(page).toHaveURL(new RegExp(`${returnPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}

test.describe('T52 四条核心用户流程', () => {
  test('作品广场、详情、收藏和比较在返回后保持上下文', async ({ page, isMobile }) => {
    test.skip(isMobile, 'T52 桌面集成流程；移动端在 T54 单独覆盖')
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: '编辑精选' })).toBeVisible()

    const picks = page.locator('#editor-picks')
    const card = picks.locator('article').filter({ has: page.locator('a[href="/project/project-papertopractice"]') })
    await expect(card).toHaveCount(1)
    await card.getByRole('button', { name: '收藏' }).click()
    const loginDialog = page.getByRole('dialog', { name: '登录后继续刚才的操作' })
    await expect(loginDialog).toBeVisible()
    await loginDialog.getByRole('button', { name: /周可/ }).click()
    await expect(card.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true')

    await card.getByRole('button', { name: '加入比较' }).click()
    await expect(card.getByRole('button', { name: '移出比较' })).toHaveAttribute('aria-pressed', 'true')
    await card.scrollIntoViewIfNeeded()
    const scrollBeforeDetail = await page.evaluate(() => window.scrollY)
    await card.getByRole('link', { name: 'Paper to Practice' }).click()
    await expect(page).toHaveURL(/\/project\/project-papertopractice$/)
    await expect(page.getByRole('heading', { name: 'Paper to Practice' })).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/projects$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scrollBeforeDetail)
    await expect(card.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('搜索、意图、分析、比较和行动使用同一来源路径', async ({ page, isMobile }) => {
    test.skip(isMobile, 'T52 桌面集成流程；移动端在 T54 单独覆盖')
    const idea = '我想把大学 PDF 讲义生成选择题'
    await page.goto('/projects')
    const search = page.getByRole('banner').getByRole('search')
    await search.getByRole('textbox', { name: '搜索作品或输入完整想法' }).fill(idea)
    await search.getByRole('button', { name: '搜索' }).click()
    await expect(page).toHaveURL(/\/discover\?idea=/)
    await expect(page.getByRole('heading', { name: '一起把想法说清楚' })).toBeVisible()
    await page.getByRole('button', { name: '确认并查找相似作品' }).click()
    await expect(page.getByRole('heading', { name: '找到相似作品' })).toBeVisible()

    const resultPath = new URL(page.url()).pathname + new URL(page.url()).search
    const candidate = page.locator('article').filter({ has: page.locator('a[href="/project/project-papertopractice"]') })
    await expect(candidate).toHaveCount(1)
    await candidate.getByRole('button', { name: '加入比较' }).click()
    await page.getByRole('link', { name: '开始比较' }).click()
    await expect(page.getByRole('heading', { name: '比较会话' })).toBeVisible()
    await expect(page.getByRole('link', { name: '来源页' })).toHaveAttribute('href', resultPath)

    await page.getByRole('radio', { name: '调整' }).check()
    await page.getByRole('checkbox', { name: '定位' }).check()
    await page.getByLabel('判断理由').fill('根据同类差异调整目标用户与产品定位。')
    await page.getByRole('button', { name: '完成并私密保存' }).click()
    const loginDialog = page.getByRole('dialog', { name: '登录后继续刚才的操作' })
    await expect(loginDialog).toBeVisible()
    await loginDialog.getByRole('button', { name: /周可/ }).click()
    await expect(page.getByRole('heading', { name: '决策记录已保存' })).toBeVisible()
  })

  test('发布查重可进入新建或身份验证且登录回跳不丢参数', async ({ page, isMobile }) => {
    test.skip(isMobile, 'T52 桌面集成流程；移动端在 T54 单独覆盖')
    await loginAs(page, '米娅', '/submit')

    const urlInput = page.getByRole('textbox', { name: /^作品地址/ })
    await urlInput.fill('example.test/new-learning-tool')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('地址检查通过')).toBeVisible()
    await page.getByRole('button', { name: '继续补充作品信息' }).click()
    await expect(page.getByRole('heading', { name: '发布新作品' })).toBeVisible()

    await page.goto('/submit?scenario=duplicate_project')
    await page.getByRole('textbox', { name: /^作品地址/ }).fill('example.test/my-pdf-tool')
    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('发现已有作品档案。')).toBeVisible()
    await page.getByRole('link', { name: '查看已有作品详情' }).click()
    const returnLink = page.getByRole('link', { name: '返回发布查重' })
    await expect(returnLink).toHaveAttribute('href', /resumeUrl=.*scenario=duplicate_project/)
    await returnLink.click()
    await expect(page.getByRole('textbox', { name: /^作品地址/ })).toHaveValue('https://example.test/my-pdf-tool')

    await page.getByRole('button', { name: '检查地址' }).click()
    await expect(page.getByText('发现已有作品档案。')).toBeVisible()
    await page.getByRole('checkbox', { name: /我是该作品作者/ }).check()
    const verificationLink = page.getByRole('link', { name: '继续验证作者身份' })
    await expect(verificationLink).toHaveAttribute('href', /submissionScenario=duplicate_project/)
    await verificationLink.click()
    await expect(page.getByRole('heading', { name: '认领作品' })).toBeVisible()
  })

  test('个人中心更新只生成一个事件并同步详情和动态', async ({ page, isMobile }) => {
    test.skip(isMobile, 'T52 桌面集成流程；移动端在 T54 单独覆盖')
    await loginAs(page, '周可', '/me')
    await expect(page.getByRole('heading', { name: '周可的个人中心' })).toBeVisible()
    await page.goto('/project/project-speakmirror/update?type=version')
    await expect(page.getByRole('heading', { name: '更新 口语回声' })).toBeVisible()

    await page.getByRole('textbox', { name: '新版本名称或编号' }).fill('2.2 · T52 集成验证')
    await page.getByRole('textbox', { name: '来源说明' }).fill('作者公开发布说明')
    await page.getByRole('textbox', { name: '影响范围' }).fill('详情时间线、公开动态与关注者通知')
    await page.getByRole('button', { name: '预览确认并提交更新' }).click()
    await page.getByRole('button', { name: '确认提交更新' }).click()
    await expect(page.getByText('更新已同步到作品详情、作品时间线和最新动态。')).toBeVisible()
    await expect(page.getByRole('button', { name: '本次更新已提交' })).toBeDisabled()

    const detailHref = await page.getByRole('link', { name: '在详情中查看' }).getAttribute('href')
    const activityHref = await page.getByRole('link', { name: '在动态中查看' }).getAttribute('href')
    expect(detailHref).toBeTruthy()
    expect(activityHref).toBeTruthy()
    const eventId = detailHref!.split('#')[1]!
    await page.getByRole('link', { name: '在详情中查看' }).click()
    await expect(page.locator(`[id="${eventId}"]`)).toHaveCount(1)
    await expect(page.locator(`[id="${eventId}"]`)).toContainText('版本更新：2.2 · T52 集成验证')

    await page.goto(activityHref!)
    await expect(page.locator(`[id="${eventId}"]`)).toHaveCount(1)
    await expect(page.locator(`[id="${eventId}"]`)).toContainText('版本更新：2.2 · T52 集成验证')

    await page.goto('/me#update-tasks')
    const updateTasks = page.getByRole('region', { name: '作品更新待办' })
    const speakMirrorTask = updateTasks.getByRole('listitem').filter({ hasText: '口语回声' })
    await expect(speakMirrorTask).toContainText('最近核验')
    await expect(speakMirrorTask).not.toContainText('已有未完成更新')
  })
})
