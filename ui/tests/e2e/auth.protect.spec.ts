import { test, expect } from '@playwright/test';

// Verifies that when CLERK_PROTECT_ALL=1, unauthenticated users
// are redirected to the custom sign-in page at /sign-in.
// This spec is intended to run under the `chromium:protected` project,
// which starts the UI server with CLERK_PROTECT_ALL=1.

const protectAll = /^(1|true)$/i.test(process.env.CLERK_PROTECT_ALL ?? '');
test.skip(!protectAll, 'CLERK_PROTECT_ALL not enabled');

test('redirects to /sign-in when protection enabled', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/sign-in/);
  // Heuristic: Clerk SignIn component renders a "Sign in" text
  await expect(page.getByText(/sign in/i)).toBeVisible();
});
