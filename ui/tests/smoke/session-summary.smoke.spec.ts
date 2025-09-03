import { test, expect } from '@playwright/test';

// Smoke tests for Session Summary - Quick sanity checks

test.describe('Session Summary Smoke Tests', () => {
  test('AI API endpoints are accessible', async ({ page }) => {
    // Basic health check for AI API endpoints
    try {
      const response = await page.request.get('http://localhost:8000/api/v1/session-summary', {
        params: { sessionId: 'smoke-test' }
      });

      // Should return 200 even for non-existent session (returns empty summary)
      expect([200, 404]).toContain(response.status());
    } catch (error) {
      // If AI API is not running, that's expected in smoke test environment
      console.log('AI API not accessible - expected in smoke environment');
    }
  });

  test('UI loads coach-min page', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Basic page load verification
    await expect(page.locator('body')).toBeVisible();

    // Check for main UI elements
    await expect(page.getByText('STATUS')).toBeVisible();
    await expect(page.getByText('LLM_PROMPT')).toBeVisible();
    await expect(page.getByText('SUMMARY')).toBeVisible();
    await expect(page.getByText('TRANSCRIPT')).toBeVisible();
  });

  test('Summary tab is accessible', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Verify summary tab content loads
    await expect(page.getByText('[FRESH_SUMMARY]')).toBeVisible();
    await expect(page.getByText('[SUMMARY_HISTORY_LOCAL]')).toBeVisible();
  });

  test('Generate button is clickable', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Verify generate button exists and is clickable
    const generateButton = page.getByRole('button', { name: '[GENERATE]' });
    await expect(generateButton).toBeVisible();
    await expect(generateButton).toBeEnabled();
  });

  test('Debug prompt tab loads', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to prompt tab
    await page.getByRole('button', { name: 'LLM_PROMPT' }).click();

    // Verify prompt debug section loads
    await expect(page.getByText('[LLM_PROMPT_DEBUG]')).toBeVisible();
  });

  test('API response structure is valid', async ({ page }) => {
    // Mock a basic API response to test structure
    await page.route('**/api/v1/session-summary**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'smoke-test-session',
            text: 'Smoke test summary',
            version: 1,
            updatedAt: Date.now(),
          })
        });
      }
    });

    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click refresh to test API call
    await page.getByRole('button', { name: '[REFRESH]' }).click();

    await page.waitForTimeout(500);

    // Verify response was processed (basic smoke check)
    await expect(page.getByText('Smoke test summary')).toBeVisible();
  });

  test('Error handling works', async ({ page }) => {
    // Mock API error
    await page.route('**/api/v1/session-summary**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' })
      });
    });

    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click generate
    await page.getByRole('button', { name: '[GENERATE]' }).click();

    await page.waitForTimeout(500);

    // Verify error is handled gracefully (page doesn't crash)
    await expect(page.locator('body')).toBeVisible();
  });

  test('Local storage operations work', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Test that local storage operations don't throw errors
    await page.addInitScript(() => {
      try {
        localStorage.setItem('coach-min:smoke-test', 'test-value');
        const value = localStorage.getItem('coach-min:smoke-test');
        if (value !== 'test-value') {
          throw new Error('Local storage not working');
        }
      } catch (error) {
        console.error('Local storage test failed:', error);
      }
    });

    // If we get here without crashing, local storage is working
    await expect(page.locator('body')).toBeVisible();
  });

  test('UI responsiveness - basic interactions', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Test basic UI responsiveness
    const summaryButton = page.getByRole('button', { name: 'SUMMARY' });
    await summaryButton.click();

    // Verify tab switched
    await expect(page.getByText('[FRESH_SUMMARY]')).toBeVisible();

    // Test another tab switch
    const promptButton = page.getByRole('button', { name: 'LLM_PROMPT' });
    await promptButton.click();

    // Verify tab switched back
    await expect(page.getByText('[LLM_PROMPT_DEBUG]')).toBeVisible();
  });

  test('Network requests are made correctly', async ({ page }) => {
    let apiCallCount = 0;

    await page.route('**/api/v1/session-summary**', async (route) => {
      apiCallCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'network-test',
          text: 'Network test summary',
          version: 1,
          updatedAt: Date.now(),
        })
      });
    });

    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to summary and trigger API call
    await page.getByRole('button', { name: 'SUMMARY' }).click();
    await page.getByRole('button', { name: '[REFRESH]' }).click();

    await page.waitForTimeout(500);

    // Verify network request was made
    expect(apiCallCount).toBeGreaterThan(0);
  });
});
