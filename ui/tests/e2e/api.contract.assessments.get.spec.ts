import { test, expect } from '@playwright/test';

test.skip(!!process.env.SKIP_AI_CONTRACTS, 'AI contract tests are skipped when SKIP_AI_CONTRACTS=1');

// Contract test: Next.js proxy -> FastAPI AI GET /assessments/{sessionId}
// Verifies that fetching via the UI proxy returns the stub summary with the same sessionId.

test('contract: GET /api/assessments/[sessionId] returns stub summary via Next proxy', async ({ request }) => {
  const sessionId = `e2e-session-${Date.now()}`;

  const res = await request.get(`/api/assessments/${encodeURIComponent(sessionId)}`);
  expect(res.status(), 'status should be 200 OK from upstream').toBe(200);

  const json = await res.json();
  expect(json).toHaveProperty('sessionId', sessionId);
  expect(json).toHaveProperty('summary');
  expect(Array.isArray(json.summary.highlights)).toBe(true);
  expect(Array.isArray(json.summary.recommendations)).toBe(true);
  expect(json.summary).toHaveProperty('rubricVersion', 'v1');
  expect(Array.isArray(json.summary.categories)).toBe(true);

  const reqId = res.headers()['x-request-id'];
  expect(reqId, 'X-Request-Id header should be present').toBeTruthy();
});
