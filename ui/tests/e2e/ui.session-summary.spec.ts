import { test, expect } from '@playwright/test';

// E2E: Session Summary caching, first-load 404, and threshold-triggered refresh

const summaryRoute = '**/api/v1/session-summary?*';

function buildSummary(text: string, updatedAt = Date.now()) {
  return {
    sessionId: 'e2e-session',
    text,
    lastIndex: undefined,
    updatedAt,
    version: 2,
  };
}

test.describe('Session Summary UI behavior', () => {
  test('first-load no-summary shows placeholder', async ({ page }) => {
    await page.route(summaryRoute, async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ sessionId: 'e2e-session', summary: null }) });
    });

    await page.goto('/chat?sessionId=e2e-session', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('session: e2e-session')).toBeVisible();
    await expect(page.getByText('No summary yet.')).toBeVisible();
  });

  test('cached-summary hit avoids refetch on reload', async ({ page }) => {
    let calls = 0;
    await page.route(summaryRoute, async (route) => {
      calls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildSummary('Hello from cache')) });
    });

    await page.goto('/chat?sessionId=e2e-session', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('session: e2e-session')).toBeVisible();
    await expect(page.getByText('Session summary')).toBeVisible();
    await expect(page.getByText('Hello from cache')).toBeVisible();

    // Reload should render from sessionStorage; we assert no additional network call is made
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('session: e2e-session')).toBeVisible();

    // Give time for potential re-fetch; the hook sets status to ready and should not fetch immediately
    await page.waitForTimeout(500);

    expect(calls).toBe(1);
  });

  test('threshold-triggered refresh by ageSec on new turn', async ({ page }) => {
    // Seed cache with an old summary (age > seconds threshold default 120s)
    await page.addInitScript((old) => {
      const key = 'cu.sessionSummary:e2e-session';
      const payload = { text: 'Old summary', version: 2, updatedAt: Date.now() - old, lastIndex: undefined };
      window.sessionStorage.setItem(key, JSON.stringify(payload));
    }, 10 * 60 * 1000 /* 10 minutes */);

    let calls = 0;
    await page.route(summaryRoute, async (route) => {
      calls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildSummary('Refreshed summary')) });
    });

    await page.goto('/chat?sessionId=e2e-session');

    // Send a message to trigger onTurn -> refresh
    const input = page.locator('input[placeholder="Ask something…"]');
    await input.fill('hello');
    await page.getByRole('button', { name: 'Ask' }).click();

    await page.waitForTimeout(500);
    expect(calls, 'should have refreshed once after a turn due to age threshold').toBe(1);
  });
});
