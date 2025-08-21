import { test, expect } from '@playwright/test';

// Contract-level test tying AI run -> Convex baseline (via MOCK_CONVEX)
// Skipped when SKIP_AI_CONTRACTS is set.

test.skip(!!process.env.SKIP_AI_CONTRACTS, 'AI contract tests are skipped when SKIP_AI_CONTRACTS=1');

// Flow:
// 1) POST /api/assessments/run?sessionId=... -> returns { groupId }
// 2) GET /api/assessments/convex/:sessionId -> latestGroupId === groupId

test('contract: after /api/assessments/run, Convex latestGroupId matches groupId', async ({ request }) => {
  const sessionId = `e2e-contract-${Date.now()}`;

  const resRun = await request.post(`/api/assessments/run?sessionId=${encodeURIComponent(sessionId)}`);
  expect(resRun.status()).toBe(200);
  const runJson = await resRun.json();

  expect(runJson).toHaveProperty('groupId');
  const groupId: string = runJson.groupId;
  expect(typeof groupId).toBe('string');

  // Fetch latest summary/baseline from Convex-backed route
  const resGet = await request.get(`/api/assessments/convex/${encodeURIComponent(sessionId)}`);
  // When only baseline exists, route may return 200 with latestGroupId and null summary OR 404 (if baseline write fails).
  expect([200, 404]).toContain(resGet.status());

  if (resGet.status() === 200) {
    const json = await resGet.json();
    expect(json).toHaveProperty('latestGroupId', groupId);
    // Summary can be null here since we didn't finalize yet.
  } else {
    // If 404, surface useful debug
    const body = await resGet.text();
    throw new Error(`Expected Convex latest summary to exist, got 404: ${body}`);
  }
});
