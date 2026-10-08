import { expect, test } from '@playwright/test'

import { startDeveloperLiveServer, type DeveloperLiveServer } from './support/developer-live-server.js'

test.describe('developer identity live flow', () => {
  test.skip(({ isMobile }) => isMobile, 'the live database flow runs once in the desktop project')
  test.describe.configure({ mode: 'serial' })

  let live: DeveloperLiveServer

  test.beforeAll(async () => {
    live = await startDeveloperLiveServer()
  })

  test.afterAll(async () => {
    await live?.stop()
  })

  test('serves the built app from the same origin as the real API', async ({ request }) => {
    const response = await request.get(`${live.baseUrl}/health/live`)
    expect(response.ok()).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({ service: 'vibecheck-developer-e2e', status: 'ok' })
  })

  test('publishes, verifies, updates, and enforces owner isolation through real services', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const publicUrl = `https://developer-e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}.example.com`
    await page.context().addCookies([
      { name: 'vc_session', value: live.owner.sessionToken, url: live.baseUrl, httpOnly: true, sameSite: 'Lax' },
      { name: 'vc_csrf', value: live.owner.csrfToken, url: live.baseUrl, sameSite: 'Lax' },
    ])

    await page.goto(`${live.baseUrl}/submit`)
    await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()
    await page.locator('#publish-name').fill('Developer Live E2E Project')
    await page.locator('#publish-summary').fill('用于真实数据库端到端验收的本地测试作品。')
    await page.locator('#publish-url').fill(publicUrl)
    await page.locator('#publish-category').selectOption('ai_learning_quiz')
    await page.locator('#publish-developerKind').selectOption('individual')
    await page.locator('#publish-developerName').fill('Developer Live E2E')
    await page.locator('#publish-developerWebsiteUrl').fill(publicUrl)
    await expect(page.locator('.publish-link-status')).toContainText('链接检查已完成', { timeout: 15_000 })

    const submissionResponse = page.waitForResponse(response => (
      response.url().endsWith('/api/v1/submissions') && response.request().method() === 'POST'
    ))
    await page.getByRole('button', { name: '查看提交预览' }).first().click()
    const preview = page.getByRole('dialog', { name: '提交预览' })
    await expect(preview).toBeVisible()
    await preview.getByRole('button', { name: '确认并提交审核' }).click()
    const submitted = await (await submissionResponse).json() as {
      submission_id: string
      review_work_item_id: string
      review_status: string
    }
    expect(submitted.submission_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(submitted.review_status).toBe('pending_review')
    await expect(page.getByRole('heading', { name: '已提交审核' })).toBeVisible({ timeout: 15_000 })

    const reviewerContext = await browser.newContext()
    try {
      await reviewerContext.addCookies([
        { name: 'vc_session', value: live.reviewer.sessionToken, url: live.baseUrl, httpOnly: true, sameSite: 'Lax' },
        { name: 'vc_csrf', value: live.reviewer.csrfToken, url: live.baseUrl, sameSite: 'Lax' },
      ])
      const reviewerPage = await reviewerContext.newPage()
      await reviewerPage.goto(`${live.baseUrl}/admin/reviews`)
      await expect(reviewerPage.getByRole('heading', { name: '发布审核' })).toBeVisible()
      const decisionResponse = reviewerPage.waitForResponse(response => (
        response.url().includes('/api/v1/admin/work-items/') &&
        response.url().endsWith('/decision') && response.request().method() === 'POST'
      ))
      await reviewerPage.getByRole('button', { name: '通过' }).first().click()
      await reviewerPage.getByRole('button', { name: '确认通过' }).click()
      const decision = await (await decisionResponse).json() as { review_decision_id: string }
      expect(decision.review_decision_id).toMatch(/^[0-9a-f-]{36}$/i)
      const published = await live.publishApprovedSubmission({
        submissionId: submitted.submission_id,
        reviewDecisionId: decision.review_decision_id,
      })

      await page.goto(`${live.baseUrl}/project/${published.projectId}`)
      const developerIdentity = page.getByRole('group', { name: '作品开发主体' })
      await expect(developerIdentity).toBeVisible({ timeout: 15_000 })
      await expect(developerIdentity.locator('[aria-label*="未认证"]')).toBeVisible()
      await expect(developerIdentity).toContainText('Developer Live E2E')
      const publicProjectResponse = await live.request(live.other, `/api/v1/projects/${published.projectId}`)
      expect(publicProjectResponse.ok).toBeTruthy()
      const publicProject = await publicProjectResponse.json() as { version_id: string }
      const forbiddenUpdate = await live.request(live.other, '/api/v1/project-updates', {
        method: 'POST',
        body: JSON.stringify({
          project_id: published.projectId,
          update_type: 'version',
          base_version_id: publicProject.version_id,
          client_request_id: `developer-e2e-other-${Date.now()}`,
        }),
      })
      expect(forbiddenUpdate.status).toBe(409)
      expect(await forbiddenUpdate.json()).toMatchObject({ error: { code: 'PROJECT_UPDATE_PROJECT_NOT_AUTHOR_PUBLISHED' } })
      const preVerificationOwnerUpdate = await live.request(live.owner, '/api/v1/project-updates', {
        method: 'POST',
        body: JSON.stringify({
          project_id: published.projectId,
          update_type: 'version',
          base_version_id: publicProject.version_id,
          client_request_id: `developer-e2e-owner-before-verification-${Date.now()}`,
        }),
      })
      expect(preVerificationOwnerUpdate.status).toBe(409)

      await page.goto(`${live.baseUrl}/project/${published.projectId}/verify-author`)
      await expect(page.getByRole('heading', { name: '认领作品' })).toBeVisible()
      await page.getByLabel('材料说明').fill('本地测试材料用于证明开发者与该作品的管理关系。')
      await page.locator('#verification-file').setInputFiles({
        name: 'developer-e2e-proof.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('test'),
      })
      const verificationCreateResponse = page.waitForResponse(response => (
        response.url().endsWith('/api/v1/verification-requests') && response.request().method() === 'POST'
      ))
      await page.getByRole('button', { name: '提交身份审核' }).click()
      const createdVerification = await (await verificationCreateResponse).json() as { verification_id: string }
      expect(createdVerification.verification_id).toMatch(/^[0-9a-f-]{36}$/i)
      await live.seedScannedMaterial({ verificationId: createdVerification.verification_id, ownerUserId: live.owner.userId })
      await expect(page).toHaveURL(new RegExp(`verification_id=${createdVerification.verification_id}`))
      await expect(page.getByText('身份申请未完成')).toBeVisible({ timeout: 15_000 })
      await page.reload()
      await expect(page.getByText('扫描通过', { exact: true })).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: '提交身份审核' }).click()
      await expect(page.getByRole('heading', { name: '待人工审核' })).toBeVisible()

      await reviewerPage.goto(`${live.baseUrl}/admin/author-verification`)
      await expect(reviewerPage.getByRole('heading', { name: '开发者身份审核' })).toBeVisible()
      await reviewerPage.getByRole('button', { name: '打开审核' }).first().click()
      await expect(reviewerPage.getByRole('heading', { name: '审核申请' })).toBeVisible()
      await reviewerPage.getByRole('button', { name: '查看材料' }).click()
      await expect(reviewerPage.getByText('扫描通过', { exact: true })).toBeVisible()
      await expect(reviewerPage.getByRole('link', { name: '打开受控材料' })).toBeVisible()
      await reviewerPage.getByRole('button', { name: '通过并留痕' }).click()
      await expect(reviewerPage.getByText('身份审核决定已保存，作品管理权限将按服务端结果生效。', { exact: true })).toBeVisible({ timeout: 15_000 })

      const approvedProject = await (await live.request(live.owner, `/api/v1/projects/${published.projectId}`)).json()
      expect(approvedProject).toMatchObject({ developer: { verification_status: 'verified' } })

      await page.goto(`${live.baseUrl}/project/${published.projectId}`)
      await expect(page.getByRole('group', { name: '作品开发主体' }).locator('[aria-label*="已认证"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('link', { name: '管理作品' })).toBeVisible()
      const otherProjects = await live.request(live.other, `/api/v1/me/projects?project_id=${published.projectId}`)
      expect(await otherProjects.json()).toMatchObject({ items: [] })
      const otherAfterVerification = await live.request(live.other, '/api/v1/project-updates', {
        method: 'POST', body: JSON.stringify({ project_id: published.projectId, update_type: 'version', base_version_id: publicProject.version_id, client_request_id: `developer-e2e-other-verified-${Date.now()}` }),
      })
      expect(otherAfterVerification.status).toBe(403)

      await page.goto(`${live.baseUrl}/project/${published.projectId}/update?type=version`)
      await expect(page.getByRole('heading', { name: /更新 Developer Live E2E Project/ })).toBeVisible()
      await page.getByLabel('版本说明').fill('Developer Live E2E Project 2.0')
      await page.getByLabel('来源说明').fill('本地真实端到端更新来源说明。')
      await page.getByLabel('影响范围').fill('详情页名称与搜索索引会在审核应用后更新。')
      const updateSubmitResponse = page.waitForResponse(response => (
        response.url().endsWith('/submit') && response.url().includes('/api/v1/project-updates/') &&
        response.request().method() === 'POST'
      ))
      await page.getByRole('button', { name: '预览确认并提交更新' }).click()
      await page.getByRole('button', { name: '确认提交审核' }).click()
      const updateSubmission = await (await updateSubmitResponse).json() as { update_id: string; status: string }
      expect(updateSubmission.status).toBe('update_pending')
      await expect(page.getByText(/更新已提交审核/).first()).toBeVisible()

      await page.goto(`${live.baseUrl}/project/${published.projectId}`)
      await expect(page.getByRole('heading', { name: 'Developer Live E2E Project' })).toBeVisible()
      await expect(page.getByText('Developer Live E2E Project 2.0', { exact: true })).toHaveCount(0)

      const updateDecision = await live.approveQueuedWork({
        targetId: updateSubmission.update_id,
        workType: 'project_update',
        targetType: 'project_update',
        session: live.reviewer,
      })
      await live.applyApprovedUpdate({ updateId: updateSubmission.update_id, reviewDecisionId: updateDecision.reviewDecisionId })
      await page.goto(`${live.baseUrl}/project/${published.projectId}`)
      await expect(page.getByText('Developer Live E2E Project 2.0')).toBeVisible({ timeout: 15_000 })

      // A decision can exist while its update is still waiting for the
      // publisher. Suspending the real owner relation in that window must
      // prevent application and any new update draft.
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(`${live.baseUrl}/project/${published.projectId}/update?type=version`)
      await expect(page.getByRole('heading', { name: /更新 Developer Live E2E Project/ })).toBeVisible()
      await page.getByLabel('版本说明').fill('Developer Live E2E Project 3.0')
      await page.getByLabel('来源说明').fill('本地真实端到端权限撤销场景。')
      await page.getByLabel('影响范围').fill('审核通过但权限暂停时不得应用公开状态。')
      const revokedUpdateSubmitResponse = page.waitForResponse(response => (
        response.url().endsWith('/submit') && response.url().includes('/api/v1/project-updates/') &&
        response.request().method() === 'POST'
      ))
      await page.getByRole('button', { name: '预览确认并提交更新' }).click()
      await page.getByRole('button', { name: '确认提交审核' }).click()
      const revokedUpdate = await (await revokedUpdateSubmitResponse).json() as { update_id: string; status: string }
      expect(revokedUpdate.status).toBe('update_pending')
      const revokedDecision = await live.approveQueuedWork({
        targetId: revokedUpdate.update_id,
        workType: 'project_update',
        targetType: 'project_update',
        session: live.reviewer,
      })
      await live.revokeDeveloperManagement({ projectId: published.projectId, ownerUserId: live.owner.userId })
      await expect(live.applyApprovedUpdate({ updateId: revokedUpdate.update_id, reviewDecisionId: revokedDecision.reviewDecisionId })).rejects.toThrow()
      const revokedCreate = await live.request(live.owner, '/api/v1/project-updates', {
        method: 'POST',
        body: JSON.stringify({
          project_id: published.projectId,
          update_type: 'version',
          base_version_id: (await (await live.request(live.owner, `/api/v1/projects/${published.projectId}`)).json() as { version_id: string }).version_id,
          client_request_id: `developer-e2e-owner-after-revoke-${Date.now()}`,
        }),
      })
      expect(revokedCreate.status).toBe(403)
      await page.goto(`${live.baseUrl}/project/${published.projectId}`)
      await expect(page.getByText('Developer Live E2E Project 2.0')).toBeVisible()
      await expect(page.getByText('Developer Live E2E Project 3.0')).toHaveCount(0)
      await page.setViewportSize({ width: 360, height: 800 })
      await expect(developerIdentity).toBeVisible()
      const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth, elements: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth || el.classList.contains('project-primary-actions')).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right, overflow: getComputedStyle(el).overflow, position: getComputedStyle(el).position, parent: el.parentElement?.className })).slice(0, 20) }))
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: JSON.stringify(overflow) }).toBeLessThanOrEqual(overflow.viewport + 1)
      const greyBadge = developerIdentity.getByRole('button', { name: /归属争议/ })
      await greyBadge.focus()
      await page.keyboard.press('Enter')
      await expect(greyBadge).toHaveAttribute('aria-expanded', 'true')
      await expect(developerIdentity.getByText('当前作品的开发主体归属正在核对。')).toBeVisible()
      await page.setViewportSize({ width: 1280, height: 900 })


    } finally {
      await reviewerContext.close()
    }
  })
})
