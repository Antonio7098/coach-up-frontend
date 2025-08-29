import { test, expect } from '@playwright/test';

// E2E: Verify SSE history includes system summary + last M turns

const summaryApi = '**/api/v1/session-summary?*';
const chatStream = '**/chat/stream**';

function toB64UrlDecode(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(pad, 'base64').toString('utf8');
}

test('SSE history contains summary and recent turns', async ({ page }) => {
  // 1) Mock session-summary to return a known summary
  await page.route(summaryApi, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'e2e-session',
        text: 'E2E Summary Text',
        lastIndex: undefined,
        updatedAt: Date.now(),
        version: 2,
      }),
    });
  });

  // 2) Intercept the EventSource URL to capture history param and then return mock SSE
  let capturedUrl = '';
  await page.route(chatStream, async (route) => {
    capturedUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: hello\n\ndata: [DONE]\n\n',
      headers: { 'cache-control': 'no-cache', connection: 'keep-alive' },
    });
  });

  await page.goto('/chat?sessionId=e2e-session', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('session: e2e-session')).toBeVisible();

  // Ensure summary shown in UI
  await expect(page.getByText('Session summary')).toBeVisible();
  await expect(page.getByText('E2E Summary Text')).toBeVisible();

  // Send one message
  const input = page.locator('input[placeholder="Ask something…"]');
  await input.fill('How are you?');
  await page.getByRole('button', { name: 'Ask' }).click();

  // Wait for SSE request to be captured
  await page.waitForTimeout(300);
  expect(capturedUrl).toContain('/chat/stream');

  const u = new URL(capturedUrl);
  const hist = u.searchParams.get('history');
  expect(hist).toBeTruthy();

  const decoded = toB64UrlDecode(hist!);
  const arr = JSON.parse(decoded) as Array<{ role: string; content: string }>;

  // First element should be the system summary
  expect(arr[0].role).toBe('system');
  expect(arr[0].content).toContain('E2E Summary Text');

  // One user turn should be present
  const userTurns = arr.filter((m) => m.role === 'user');
  expect(userTurns.length).toBeGreaterThanOrEqual(1);
});
