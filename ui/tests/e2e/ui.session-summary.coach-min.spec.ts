import { test, expect } from '@playwright/test';

// E2E: Session Summary generation and display in Coach-min

const summaryApiRoute = '**/api/v1/session-summary**';

test.describe('Session Summary in Coach-min', () => {
  test('displays summary tab and initial state', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Check that summary tab is available
    await expect(page.getByRole('button', { name: 'SUMMARY' })).toBeVisible();

    // Click on summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Check that summary sections are visible
    await expect(page.getByText('[FRESH_SUMMARY]')).toBeVisible();
    await expect(page.getByText('[SUMMARY_HISTORY_LOCAL]')).toBeVisible();

    // Check initial state
    await expect(page.getByText('(none)')).toBeVisible();
    await expect(page.getByRole('button', { name: '[GENERATE]' })).toBeVisible();
    await expect(page.getByRole('button', { name: '[REFRESH]' })).toBeVisible();
  });

  test('generates fresh summary successfully', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Mock the AI API response
    await page.route('**/api/v1/session-summary**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'completed',
            summary: {
              sessionId: 'test-session',
              version: 1,
              updatedAt: Date.now(),
            }
          })
        });
      } else {
        // GET request for fetching summary
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'test-session',
            text: 'This is a generated summary of the conversation.',
            version: 1,
            updatedAt: Date.now(),
            lastMessageTs: Date.now(),
          })
        });
      }
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click generate button
    await page.getByRole('button', { name: '[GENERATE]' }).click();

    // Wait for generation to complete
    await page.waitForTimeout(1000);

    // Verify summary appears
    await expect(page.getByText('This is a generated summary of the conversation.')).toBeVisible();

    // Verify status updates
    await expect(page.getByText(/status=ready|status=completed/)).toBeVisible();

    // Verify version is shown
    await expect(page.getByText(/v1/)).toBeVisible();
  });

  test('displays debug prompt information', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Mock the session summary API
    await page.route(summaryApiRoute, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'test-session',
            text: 'Debug summary text',
            version: 1,
            updatedAt: Date.now(),
            lastMessageTs: Date.now(),
          })
        });
      }
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click generate to trigger debug prompt capture
    await page.getByRole('button', { name: '[GENERATE]' }).click();

    await page.waitForTimeout(500);

    // Show debug prompt
    await page.getByRole('button', { name: /SHOW_LLM_PROMPT_DEBUG/ }).click();

    // Verify debug sections appear
    await expect(page.getByText('> PREV_SUMMARY_PREVIEW:')).toBeVisible();
    await expect(page.getByText('> RECENT_MESSAGES')).toBeVisible();

    // Verify debug content is displayed
    await expect(page.getByText('(none)')).toBeVisible(); // Initially no previous summary
    await expect(page.getByText('RECENT_MESSAGES (0):')).toBeVisible(); // No recent messages initially
  });

  test('handles empty summary generation gracefully', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Mock AI API to return empty response
    await page.route('**/api/v1/session-summary**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'empty' }),
          headers: { 'X-Summary-Empty': '1' }
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'test-session',
            text: '',
            version: 1,
            updatedAt: Date.now(),
          })
        });
      }
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click generate
    await page.getByRole('button', { name: '[GENERATE]' }).click();

    await page.waitForTimeout(500);

    // Verify empty state is handled
    await expect(page.getByText('(none)')).toBeVisible();
  });

  test('shows messages incorporated since last cutoff', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Mock APIs
    await page.route(summaryApiRoute, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'test-session',
            text: 'Summary with cutoff',
            version: 1,
            updatedAt: Date.now(),
            lastMessageTs: Date.now() - 30000, // 30 seconds ago
          })
        });
      }
    });

    // Mock interactions API for transcript
    await page.route('**/api/v1/interactions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            role: 'user',
            text: 'Recent user message',
            createdAt: Date.now() - 10000, // 10 seconds ago
          },
          {
            role: 'assistant',
            text: 'Recent assistant response',
            createdAt: Date.now() - 5000, // 5 seconds ago
          }
        ])
      });
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click generate
    await page.getByRole('button', { name: '[GENERATE]' })).click();

    await page.waitForTimeout(500);

    // Verify messages incorporated section
    await expect(page.getByText('> MESSAGES_INCORPORATED_SINCE_LAST_CUTOFF:')).toBeVisible();
    await expect(page.getByText('user: Recent user message')).toBeVisible();
    await expect(page.getByText('assistant: Recent assistant response')).toBeVisible();
  });

  test('displays summary history with multiple versions', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Set up local storage with history
    await page.addInitScript(() => {
      const history = [
        {
          version: 3,
          text: 'Latest summary version',
          updatedAt: Date.now(),
        },
        {
          version: 2,
          text: 'Previous summary version',
          updatedAt: Date.now() - 60000,
        },
        {
          version: 1,
          text: 'Original summary version',
          updatedAt: Date.now() - 120000,
        }
      ];
      localStorage.setItem('coach-min:summary-history', JSON.stringify(history));
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Verify history is displayed
    await expect(page.getByText('[SUMMARY_HISTORY_LOCAL]')).toBeVisible();
    await expect(page.getByText('3 versions')).toBeVisible();

    // Verify all versions are listed
    await expect(page.getByText('v3')).toBeVisible();
    await expect(page.getByText('v2')).toBeVisible();
    await expect(page.getByText('v1')).toBeVisible();

    // Test expanding a version
    await page.getByRole('button', { name: '[SHOW]' }).first().click();
    await expect(page.getByText('Latest summary version')).toBeVisible();

    // Test collapsing
    await page.getByRole('button', { name: '[HIDE]' }).first().click();
    await expect(page.getByText('Latest summary version')).not.toBeVisible();
  });

  test('handles API errors gracefully', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Mock API failure
    await page.route('**/api/v1/session-summary**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'AI service unavailable' })
        });
      }
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click generate
    await page.getByRole('button', { name: '[GENERATE]' })).click();

    await page.waitForTimeout(500);

    // Verify error is displayed
    await expect(page.getByText('> ERROR: AI service unavailable')).toBeVisible();
  });

  test('refresh button fetches latest summary', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    let callCount = 0;
    await page.route(summaryApiRoute, async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'test-session',
          text: `Refreshed summary ${callCount}`,
          version: 1,
          updatedAt: Date.now(),
        })
      });
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click refresh multiple times
    await page.getByRole('button', { name: '[REFRESH]' })).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: '[REFRESH]' })).click();
    await page.waitForTimeout(500);

    // Verify API was called
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Verify refreshed content is displayed
    await expect(page.getByText(/Refreshed summary/)).toBeVisible();
  });

  test('shows turns until due calculation', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Mock API response with cadence information
    await page.route(summaryApiRoute, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'test-session',
            text: 'Summary with cadence info',
            version: 1,
            updatedAt: Date.now(),
            turnsSince: 2,
            thresholdTurns: 5,
          })
        });
      }
    });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Click refresh to load summary
    await page.getByRole('button', { name: '[REFRESH]' })).click();

    await page.waitForTimeout(500);

    // Verify turns until due is displayed
    await expect(page.getByText(/turns_until_due: 3/)).toBeVisible(); // 5 - 2 = 3
  });

  test('handles debug prompt refresh functionality', async ({ page }) => {
    await page.goto('/coach-min', { waitUntil: 'domcontentloaded' });

    // Navigate to summary tab
    await page.getByRole('button', { name: 'SUMMARY' }).click();

    // Generate a summary first
    await page.getByRole('button', { name: '[GENERATE]' })).click();
    await page.waitForTimeout(500);

    // Navigate to prompt tab and refresh prompt preview
    await page.getByRole('button', { name: 'LLM_PROMPT' }).click();
    await page.getByRole('button', { name: '[REFRESH]' }).click();

    await page.waitForTimeout(500);

    // Verify prompt preview is available
    await expect(page.getByText('STATUS: READY')).toBeVisible();
    await expect(page.getByText('> FULL_PROMPT_TO_LLM:')).toBeVisible();
  });
});

