import { test, expect } from '@playwright/test';

// Simple test to verify the history parameter is passed
test('verifies history parameter is sent to backend', async ({ page }) => {
  // Mock network requests to capture the chat API call
  let capturedUrl = '';

  await page.route('**/api/chat**', (route) => {
    capturedUrl = route.request().url();
    // Mock a simple SSE response
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: Test response\nfrom mock.\ndata: [DONE]\n\n'
    });
  });

  await page.goto('/chat');

  // Wait for page to be ready
  await page.waitForLoadState('networkidle');

  // Check if the input field exists at all
  const promptInput = page.locator('input[placeholder="Type a prompt…"]');
  const isVisible = await promptInput.isVisible().catch(() => false);

  if (!isVisible) {
    console.log('Input field not found, checking page content...');
    const bodyText = await page.locator('body').textContent();
    console.log('Page body:', bodyText?.substring(0, 500));
    throw new Error('Input field not visible - page may not have loaded correctly');
  }

  // Fill and send a message
  await promptInput.fill('Test message');
  const sendButton = page.getByRole('button', { name: 'Send' });
  await sendButton.click();

  // Wait for the network request to be captured
  await page.waitForTimeout(1000);

  // Verify the URL contains a history parameter
  expect(capturedUrl).toBeTruthy();
  expect(capturedUrl).toContain('/api/chat');
  expect(capturedUrl).toContain('history=');

  console.log('Captured URL:', capturedUrl);

  // Decode and verify history
  const url = new URL(capturedUrl);
  const historyParam = url.searchParams.get('history');
  expect(historyParam).toBeTruthy();

  // Decode base64url
  const historyJson = historyParam!.replace(/-/g, '+').replace(/_/g, '/');
  const padded = historyJson + '='.repeat((4 - historyJson.length % 4) % 4);
  const historyText = atob(padded);
  const history = JSON.parse(historyText);

  console.log('Decoded history:', history);

  expect(Array.isArray(history)).toBe(true);
  expect(history.length).toBeGreaterThan(0);
});
