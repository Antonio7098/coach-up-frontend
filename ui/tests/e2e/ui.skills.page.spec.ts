import { test, expect } from '@playwright/test';

test('Skills page renders and loads list', async ({ page }) => {
  await page.goto('/skills', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();

  const count = page.getByTestId('skills-count');
  await expect(count).toBeVisible();
  await expect(count).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(count).toContainText('skills');

  const list = page.getByTestId('skills-list');
  await expect(list).toBeAttached();
  const items = list.locator('li');
  const n = await items.count();
  if (n === 0) {
    await expect(page.getByText('No skills found.')).toBeVisible();
  } else {
    await expect(items.first()).toBeVisible();
  }
});
