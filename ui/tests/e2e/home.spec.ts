import { test, expect } from '@playwright/test';

// Simple smoke test to ensure the Next.js app serves the home page
// and renders expected content from src/app/page.tsx

test('home page renders and shows docs link', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Read our docs')).toBeVisible();
});
