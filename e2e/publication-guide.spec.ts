import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { installMockAuth } from './support/mock-auth'
import { installPublishMock } from './support/publish-mock'

test('guide metadata, complete preview and explicit submission survive draft recovery', async ({ page, isMobile }, testInfo) => {
  const width = isMobile ? 360 : 1280
  await page.setViewportSize({ width, height: 900 })
  const auth = await installMockAuth(page)
  const mock = await installPublishMock(page)
  await auth.loginAs('mia', '/submit')
  await expect(page.locator('#publish-name')).toBeEditable()
  await page.locator('#publish-name').fill('岛屿作品集')
  await page.locator('#publish-summary').fill('展示公开项目与开发经验。')
  await page.locator('#publish-url').fill('https://example.test/guide-portfolio')
  await page.locator('#publish-category').selectOption('personal_site_portfolio')
  await page.getByRole('link', { name: '最终预览', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '提交预览' })
  await expect(preview.getByRole('button', { name: '确认并提交审核' })).toBeDisabled()
  await expect(preview.getByText('请选择你与作品的关系')).toBeVisible()
  expect(mock.requestsOf('submit')).toHaveLength(0)
  await preview.getByRole('link', { name: /跳转到/ }).first().click()
  await page.locator('#publish-submitterRelation').selectOption('team_member')
  await page.locator('#publish-organizationName').fill('岛屿团队')
  await page.locator('#publish-logoUrl').fill('https://example.test/logo.png')
  await page.locator('#publish-detailedDescription').fill('详细展示公开开发项目及设计背景。')
  const gallery = page.locator('#publish-galleryUrls')
  await gallery.fill('https://example.test/one.png')
  await gallery.press('End')
  await gallery.press('Enter')
  await gallery.pressSequentially('https://example.test/two.png')
  await expect(gallery).toHaveValue('https://example.test/one.png\nhttps://example.test/two.png')
  await page.locator('#publish-videoUrl').fill('https://www.bilibili.com/video/BVexample')
  await page.getByRole('button', { name: '添加致谢' }).click()
  await page.locator('#publish-ack-name-0').pressSequentially('公开组件库')
  await expect(page.locator('#publish-ack-name-0')).toBeFocused()
  await page.locator('#publish-ack-note-0').fill('帮助构建项目展示组件。')
  await expect(page.getByRole('status').filter({ hasText: '草稿已保存到此设备' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('vibecheck-publish', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const drafts = db.transaction('drafts').objectStore('drafts').getAll()
      drafts.onerror = () => { db.close(); reject(drafts.error) }
      drafts.onsuccess = () => {
        const draft = drafts.result.find(item => item.fields?.name === '岛屿作品集')
        db.close(); resolve(draft?.fields?.acknowledgements?.[0]?.note ?? '')
      }
    }
  }))).toBe('帮助构建项目展示组件。')
  await page.reload()
  await expect(page.locator('#publish-detailedDescription')).toHaveValue('详细展示公开开发项目及设计背景。')
  await expect(page.locator('#publish-submitterRelation')).toHaveValue('team_member')
  await expect(page.locator('#publish-galleryUrls')).toHaveValue('https://example.test/one.png\nhttps://example.test/two.png')
  await page.getByRole('link', { name: '最终预览', exact: true }).click()
  await expect(preview.getByText('帮助构建项目展示组件。')).toBeVisible()
  await expect(preview.getByRole('button', { name: '确认并提交审核' })).toBeEnabled()
  expect(mock.requestsOf('submit')).toHaveLength(0)
  const accessibility = await new AxeBuilder({ page }).include('.publish-submit-preview').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('publication-guide-preview.png'), fullPage: true })
  await preview.getByRole('button', { name: '确认并提交审核' }).click()
  await expect(page.getByRole('heading', { name: '已提交审核' })).toBeVisible()
  expect(mock.requestsOf('submit')).toHaveLength(1)
  expect(mock.lastBody('draft-patch')).toMatchObject({ patch: { project_core: { publication_details: { submitterRelation: 'team_member', organizationName: '岛屿团队', detailedDescription: '详细展示公开开发项目及设计背景。', galleryUrls: ['https://example.test/one.png', 'https://example.test/two.png'], acknowledgements: [{ name: '公开组件库', url: '', note: '帮助构建项目展示组件。' }] } } } })
})
