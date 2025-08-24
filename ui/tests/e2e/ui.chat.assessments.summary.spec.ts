import { test, expect } from '@playwright/test';

// UI E2E: verifies Assessments Summary panel appears on /chat after running an assessment
// Uses MOCK_CONVEX=1 (default in playwright.config.ts) and AI API stubbed summary via Next proxy

const skipContracts = /^(1|true)$/i.test(process.env.SKIP_AI_CONTRACTS ?? '');
test.skip(skipContracts, 'Requires AI API server to be running');

test('chat: run assessment -> Summary panel shows with categories', async ({ page }) => {
  await page.goto('/chat', { waitUntil: 'domcontentloaded' });

  // Click "Run Assessment"
  const runBtn = page.getByRole('button', { name: 'Run Assessment' });
  await expect(runBtn).toBeVisible();
  await runBtn.click();

  // Expect Summary panel to render
  const summaryPanel = page.getByText('Summary', { exact: true });
  await expect(summaryPanel).toBeVisible({ timeout: 15_000 });

  // Verify key fields render
  await expect(page.getByText('Highlights:')).toBeVisible();
  await expect(page.getByText('Recommendations:')).toBeVisible();
  await expect(page.getByText('Rubric:')).toBeVisible();
  await expect(page.getByText('Categories:')).toBeVisible();

  // Categories should include rubric v1 categories from AI API stub
  const categories = page.getByText(/^Categories:/);
  await expect(categories).toBeVisible();
  await expect(categories).toContainText(/clarity/i);
  await expect(categories).toContainText(/fluency/i);
});
