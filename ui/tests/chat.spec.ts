import { test, expect } from '@playwright/test';

// Requires the Next.js dev server running at BASE_URL (default http://localhost:3000)
// Start the server separately: npm run dev
// Run this test: npm run test:e2e

test('streams chat and emits [DONE]', async ({ page }) => {
  await page.goto('/chat');

  // Enter a prompt and send
  const promptInput = page.getByPlaceholder('Type a prompt…');
  await promptInput.fill('hello from e2e test');

  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // Output textarea (first textarea on the page)
  const output = page.locator('textarea').first();
  await expect(output).toBeVisible();

  // Wait for some output to appear
  await expect.poll(async () => {
    const val = await output.inputValue();
    return val.length > 0 ? 'ok' : '';
  }, { timeout: 20000 }).toBe('ok');

  // Expect the terminal [DONE] marker eventually
  await expect.poll(async () => {
    const val = await output.inputValue();
    return val.includes('[DONE]');
  }, { timeout: 20000 }).toBe(true);
});
