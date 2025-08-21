import { test, expect } from '@playwright/test';

test.skip(!!process.env.SKIP_AI_CONTRACTS, 'AI contract tests are skipped when SKIP_AI_CONTRACTS=1');

// Contract test: Next.js proxy -> FastAPI AI /assessments/run
// Verifies that POSTing via the UI proxy returns a groupId and status "accepted".

test('contract: POST /api/assessments/run returns groupId via Next proxy', async ({ request, baseURL }) => {
  expect(baseURL).toBeTruthy();

  const sessionId = `e2e-session-${Date.now()}`;

  // Prefer query string to avoid any ambiguity around JSON encoding across layers.
  const res = await request.post(`/api/assessments/run?sessionId=${encodeURIComponent(sessionId)}`);

  expect(res.status(), 'status should be 200 OK from upstream').toBe(200);
  const json = await res.json();

  expect(json).toHaveProperty('groupId');
  expect(typeof json.groupId).toBe('string');
  expect(json).toHaveProperty('status', 'accepted');

  const reqId = res.headers()['x-request-id'];
  expect(reqId, 'X-Request-Id header should be present').toBeTruthy();
});
