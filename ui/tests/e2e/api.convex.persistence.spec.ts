import { test, expect } from '@playwright/test';

// Smoke-level Convex persistence test using MOCK_CONVEX in Next API
// Flow: finalize summary -> fetch latest summary -> verify payload

test('convex: finalize + latest summary returns persisted data', async ({ request }) => {
  const sessionId = `e2e-convex-${Date.now()}`;
  const groupId = `grp-${Math.random().toString(36).slice(2)}`;

  const payload = {
    sessionId,
    groupId,
    summary: {
      highlights: [
        'Strong structure',
        'Good problem framing',
      ],
      recommendations: [
        'Provide more examples',
      ],
      rubricKeyPoints: [
        'clarity',
        'conciseness',
      ],
    },
  };

  const headers: Record<string, string> = {};
  const bearer = process.env.PERSIST_ASSESSMENTS_SECRET as string;
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  const resFinalize = await request.post('/api/assessments/convex/finalize', {
    data: payload,
    headers,
  });
  expect(resFinalize.status()).toBe(200);

  const resGet = await request.get(`/api/assessments/convex/${encodeURIComponent(sessionId)}`);
  expect(resGet.status()).toBe(200);

  const json = await resGet.json();
  expect(json).toHaveProperty('sessionId', sessionId);
  expect(json).toHaveProperty('latestGroupId', groupId);
  expect(json).toHaveProperty('summary');
  expect(Array.isArray(json.summary?.highlights)).toBe(true);
  expect(Array.isArray(json.summary?.recommendations)).toBe(true);
  expect(Array.isArray(json.summary?.rubricKeyPoints)).toBe(true);
});
