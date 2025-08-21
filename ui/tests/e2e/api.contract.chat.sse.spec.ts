import { test, expect } from '@playwright/test';

test.skip(!!process.env.SKIP_AI_CONTRACTS, 'AI contract tests are skipped when SKIP_AI_CONTRACTS=1');

// Contract test: Next.js proxy -> FastAPI AI GET /chat/stream (SSE)
// Verifies that streaming works end-to-end and includes a [DONE] marker.

test('contract: GET /api/chat (SSE) streams and completes via Next proxy', async ({ request }) => {
  const res = await request.get(`/api/chat?prompt=${encodeURIComponent('ping')}`, {
    headers: { Accept: 'text/event-stream' },
  });

  expect(res.status(), 'status should be 200 OK').toBe(200);
  const ct = res.headers()['content-type'] || '';
  expect(ct.includes('text/event-stream')).toBeTruthy();

  const body = await res.text();
  expect(body).toContain('data:');
  expect(body).toContain('[DONE]');

  const reqId = res.headers()['x-request-id'];
  expect(reqId, 'X-Request-Id header should be present').toBeTruthy();
});
