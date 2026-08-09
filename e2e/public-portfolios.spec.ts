import { expect, test } from '@playwright/test'

test('shows and searches the verified public portfolio records', async ({ page }) => {
  await page.goto('/projects')

  const portfolioSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '个人主页与作品集' }) })
  await expect(portfolioSection.getByRole('link', { name: 'Haoqi Wen' })).toBeVisible()
  await expect(portfolioSection.getByRole('link', { name: '罗丹 Rodin' })).toBeVisible()

  await page.goto('/search?q=Haoqi&mode=works')
  const searchResult = page.getByRole('link', { name: 'Haoqi Wen' })
  await expect(searchResult).toBeVisible()
  await searchResult.click()
  await expect(page).toHaveURL(/\/project\/project-haoqi-design$/)
  await expect(page.getByRole('heading', { name: 'Haoqi Wen', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即体验 ↗' })).toBeVisible()
})
